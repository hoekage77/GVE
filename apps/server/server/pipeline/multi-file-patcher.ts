import {
  PatchGenerator,
  applyPatches,
  type PatchGoal,
  type GeneratedPatch,
  type ProjectState,
  type PatchGeneratorOptions,
  type AgentMemory,
} from "../quality/patcher.js";
import {
  type Workspace,
  listFiles,
  getFile,
  getDependencyGraph,
  addFile,
  updateFile,
  removeFile,
  extractImports,
} from "./workspace.js";
import type { SkillId } from "./workspace.js";

function primarySkill(skill: SkillId | SkillId[]): SkillId {
  return Array.isArray(skill) ? skill[0]! : skill;
}

// ────────────────────────────────────────────────
//  EXTENDED PATCH TYPES
// ────────────────────────────────────────────────

export type PatchKind = "modify" | "add" | "remove" | "rename";

export interface MultiFilePatch {
  filePath: string;
  kind: PatchKind;
  originalCode?: string;
  patchedCode?: string;
  newPath?: string;
  purpose?: string;
  skill?: SkillId;
  explanation: string;
  expectedScoreImpact: number;
  riskLevel: number;
}

export interface MultiFilePatchResult {
  workspace: Workspace;
  patches: MultiFilePatch[];
  summary: Array<{ file: string; change: string; impact: string; risk: string }>;
}

// ────────────────────────────────────────────────
//  WORSPACE ⇄ PROJECTSTATE CONVERSION
// ────────────────────────────────────────────────

function workspaceToProject(ws: Workspace): ProjectState {
  return {
    entryPoint: ws.entryPoint,
    files: listFiles(ws).map(f => ({ path: f.path, content: f.content }))
  };
}

// ────────────────────────────────────────────────
//  IMPORT REWRITER
// ────────────────────────────────────────────────

function rewriteImports(content: string, mapping: Map<string, string>): string {
  if (mapping.size === 0) return content;
  let result = content;
  for (const [oldPath, newPath] of mapping) {
    const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(["'])(\\.\\/|\.\\.\\/)?${escaped}(\\.js)?(["'])`, 'g');
    result = result.replace(regex, (_, q1, prefix, _js, q2) => {
      const resolved = newPath.replace(/^src\//, '');
      return `${q1}${prefix || ''}${resolved.replace(/\.js$/, '')}${q2}`;
    });
  }
  return result;
}

// ────────────────────────────────────────────────
//  MULTI-FILE PATCH APPLICATION
// ────────────────────────────────────────────────

export function applyMultiFilePatches(ws: Workspace, patches: MultiFilePatch[]): Workspace {
  let current = ws;
  const importMap = new Map<string, string>();

  const modifications = patches.filter(p => p.kind === "modify" && p.patchedCode);
  const additions = patches.filter(p => p.kind === "add" && p.patchedCode);
  const removals = patches.filter(p => p.kind === "remove");
  const renames = patches.filter(p => p.kind === "rename" && p.newPath);

  for (const patch of modifications) {
    try { current = updateFile(current, patch.filePath, patch.patchedCode!); } catch {}
  }

  for (const patch of additions) {
    try {
      current = addFile(current, patch.filePath, patch.patchedCode!, patch.purpose || "Added by quality loop", patch.skill || "threejs");
    } catch {}
  }

  for (const patch of removals) {
    try { current = removeFile(current, patch.filePath); } catch {}
  }

  for (const patch of renames) {
    try {
      const entry = getFile(current, patch.filePath);
      if (entry && patch.newPath) {
        importMap.set(patch.filePath, patch.newPath);
        current = removeFile(current, patch.filePath);
        current = addFile(current, patch.newPath, patch.patchedCode || entry.content, patch.purpose || entry.purpose, patch.skill || primarySkill(entry.skill));
      }
    } catch {}
  }

  if (importMap.size > 0) {
    for (const file of listFiles(current)) {
      const updatedContent = rewriteImports(file.content, importMap);
      if (updatedContent !== file.content) {
        current = updateFile(current, file.path, updatedContent);
      }
    }
  }

  return current;
}

function summarizeMultiFilePatches(patches: MultiFilePatch[]): MultiFilePatchResult["summary"] {
  return patches.map(p => ({
    file: p.kind === "rename" ? `${p.filePath} → ${p.newPath}` : p.filePath,
    change: p.explanation,
    impact: `${p.expectedScoreImpact > 0 ? '+' : ''}${Math.round(p.expectedScoreImpact)} pts`,
    risk: p.riskLevel > 0.7 ? "HIGH" : p.riskLevel > 0.4 ? "MEDIUM" : "LOW"
  }));
}

// ────────────────────────────────────────────────
//  MULTI-FILE PATCH GENERATOR
// ────────────────────────────────────────────────

export class MultiFilePatchGenerator {
  private generator: PatchGenerator;

  constructor(patchGenerator: PatchGenerator) {
    this.generator = patchGenerator;
  }

  async generatePatches(
    ws: Workspace,
    patchGoals: PatchGoal[],
    agentMemory?: AgentMemory,
    context?: { currentScore?: number; skill?: string }
  ): Promise<MultiFilePatchResult> {
    const project = workspaceToProject(ws);
    const goals = patchGoals.map(g => ({
      ...g,
      affectedFile: g.affectedFile || ws.entryPoint
    }));

    const singleFilePatches = await this.generator.generatePatches(
      ws.files[ws.entryPoint]?.content || "",
      project,
      goals as any,
      agentMemory,
      context as any
    );

    const patches: MultiFilePatch[] = singleFilePatches.map(p => ({
      filePath: p.filePath,
      kind: "modify" as const,
      originalCode: p.originalCode,
      patchedCode: p.patchedCode,
      explanation: p.explanation,
      expectedScoreImpact: p.expectedScoreImpact,
      riskLevel: p.riskLevel
    }));

    const resultWs = applyMultiFilePatches(ws, patches);

    return {
      workspace: resultWs,
      patches,
      summary: summarizeMultiFilePatches(patches)
    };
  }
}