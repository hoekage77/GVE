import { getPool } from "../llm/pool.js";
import { fetchChatCompletion } from "./utils.js";
import { recordTokenUsage } from "../state/token-usage.js";
import { broadcastEvent } from "../ws/streaming.js";
import { validateCode } from "../quality/validator.js";
import {
  addFile,
  createWorkspace,
  hasFile,
  type FileEntry,
  type SkillId,
  type Workspace
} from "./workspace.js";
import type { PlannedFile, WorkPlan } from "./project-planner.js";

/** Normalize a potentially multi-skill value to a single SkillId for legacy functions. */
function primarySkill(skill: SkillId | SkillId[]): SkillId {
  return Array.isArray(skill) ? skill[0]! : skill;
}

// ────────────────────────────────────────────────
//  EXPORT SIGNATURE EXTRACTION
// ────────────────────────────────────────────────

function extractExports(content: string): string[] {
  const signatures: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("function ") ||
      trimmed.startsWith("class ") ||
      trimmed.startsWith("export function ") ||
      trimmed.startsWith("export class ") ||
      trimmed.startsWith("const ") ||
      trimmed.startsWith("let ") ||
      trimmed.match(/^(export\s+)?(async\s+)?(function|class|const|let|var)\s/)
    ) {
      const sig = trimmed.replace(/^export\s+/, "").replace(/\s*\{[\s\S]*$/, "").trim();
      if (sig.length > 3 && sig.length < 200) signatures.push(sig);
    }
  }
  return signatures.slice(0, 20);
}

// ────────────────────────────────────────────────
//  CONTEXT WINDOW BUILDER
// ────────────────────────────────────────────────

function buildFileContext(
  planned: PlannedFile,
  query: string,
  existing: Workspace,
  plan: WorkPlan
): string {
  const parts: string[] = [];
  parts.push(`Project: ${plan.summary}`);
  parts.push(`User prompt: "${query}"`);
  parts.push("");
  parts.push(`--- YOUR FILE ---`);
  parts.push(`Path: ${planned.path}`);
  parts.push(`Purpose: ${planned.purpose}`);
  parts.push(`Engine: ${renderEngineConstraints(primarySkill(planned.skill))}`);

  if (planned.qualityContract) {
    parts.push("");
    parts.push("QUALITY CONTRACT — you MUST satisfy these requirements:");
    for (const req of planned.qualityContract.split(/[.;]\s*/).filter(Boolean)) {
      parts.push(`  → ${req.trim()}`);
    }
  }
  parts.push("");

  const imports = planned.importsFromLocal || [];
  if (imports.length > 0) {
    parts.push("--- FILES YOU IMPORT ---");
    for (const imp of imports) {
      const normalized = imp.replace(/^\.?\/?/, "");
      const entry = existing.files[normalized]
        || existing.files[`${normalized}.js`]
        || existing.files[`src/${normalized}`];

      if (entry) {
        const exports = extractExports(entry.content);
        parts.push(`File: ${entry.path} — ${entry.purpose}`);
        if (exports.length > 0) {
          parts.push(`  Available exports: ${exports.join(", ")}`);
        }
        parts.push("");
      } else {
        parts.push(`File: ${imp} — (not yet generated, use placeholder interface)`);
        parts.push("");
      }
    }
  }

  const npmDeps = planned.npmDependencies || [];
  if (npmDeps.length > 0) {
    parts.push(`NPM dependencies available: ${npmDeps.join(", ")}`);
    parts.push("");
  }

  const otherFiles = Object.values(existing.files)
    .filter(f => f.path !== planned.path && !imports.includes(f.path));
  if (otherFiles.length > 0) {
    parts.push("--- OTHER PROJECT FILES ---");
    for (const f of otherFiles.slice(0, 5)) {
      parts.push(`${f.path} — ${f.purpose}`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

function renderEngineConstraints(skill: SkillId): string {
  switch (skill) {
    case "threejs":
      return [
        "Three.js WebGL 3D. Globals: scene, camera, renderer, THREE, OrbitControls.",
        "Do NOT recreate scene/camera/renderer — import and use the pre-existing globals.",
        "Available npm: postprocessing (EffectComposer, BloomPass, ShaderPass), simplex-noise, chroma-js, gsap.",
        "Prefer MeshPhysicalMaterial over MeshStandardMaterial for premium surfaces.",
        "Use InstancedMesh for repeated geometry (>20 copies).",
        "Enable shadows on renderer and at least one light."
      ].join(" ");
    case "p5js":
      return [
        "p5.js creative canvas. Define setup()/draw(). createCanvas(), background(), fill() available.",
        "Use p5.Vector for position/velocity calculations.",
        "Prefer WEBGL renderer (createCanvas(w, h, WEBGL)) for 3D primitives."
      ].join(" ");
    case "d3js":
      return [
        "D3.js data-driven SVG. d3 namespace available. Manipulate DOM/SVG directly.",
        "Use d3-scale and d3-axis for clean chart primitives.",
        "Prefer enter/update/exit pattern for transitions."
      ].join(" ");
    case "animejs":
      return [
        "Anime.js motion design. anime() and anime.timeline() available.",
        "Target DOM/SVG nodes. Build targets before animating.",
        "Use staggered delays and spring easing for organic feel.",
        "Available npm: gsap as alternative animation engine."
      ].join(" ");
    case "manim":
      return "Manim Python. Define one Scene class named GVERichScene. from manim import * available. Target 1080p/60fps.";
  }
}

// ────────────────────────────────────────────────
//  PER-FILE PROMPT BUILDER
// ────────────────────────────────────────────────

function buildFilePrompt(context: string, skill: SkillId, hasQualityContract: boolean): { system: string; user: string } {
  const isPython = skill === "manim";

  const qualityDirectives = hasQualityContract ? [
    "",
    "CRITICAL: This file has a QUALITY CONTRACT in the context below.",
    "The contract lists specific requirements prefixed with →.",
    "Your code MUST satisfy every contract requirement.",
    "If a contract says USE PhysicalMaterial, do not use MeshBasicMaterial.",
    "If a contract says INCLUDE 3 light sources, include exactly 3.",
    "Treat the quality contract as a spec document — deliver to spec."
  ] : [];

  return {
    system: [
      isPython
        ? "You are a senior Python software engineer generating Manim visualization code."
        : "You are a senior JavaScript creative technologist generating premium visualization code.",
      "Generate runnable code for one file in a multi-file creative project.",
      "The code must work with the imports, globals, engine constraints, and quality contract described.",
      "",
      "RULES:",
      isPython
        ? "- Output runnable Python code ONLY. No markdown fences, no prose."
        : "- Output runnable JavaScript code ONLY. No markdown fences, no prose.",
      isPython
        ? "- Do NOT use filesystem, subprocess, shell, or network APIs."
        : "- Do NOT use eval(), Function constructor, fetch(), require(), or import().",
      "- Do NOT recreate globals that are pre-initialized.",
      "- Write code a senior engineer would ship — clean structure, meaningful names, no dead code.",
      "- Prioritize visual impact: rich materials, cinematic lighting, smooth motion.",
      ...qualityDirectives
    ].join("\n"),
    user: [
      "Generate the code for this file:",
      "",
      context,
      "",
      "Output ONLY the code. No markdown fences, no explanation."
    ].join("\n")
  };
}

// ────────────────────────────────────────────────
//  GENERATION
// ────────────────────────────────────────────────

export interface GenerateProjectOptions {
  plan: WorkPlan;
  query: string;
  sessionId?: string;
  existingWorkspace?: Workspace;
}

export interface GenerateProgress {
  current: number;
  total: number;
  path: string;
  status: "generating" | "validating" | "done" | "failed";
  error?: string;
}

export async function generateProject(
  options: GenerateProjectOptions,
  onProgress?: (p: GenerateProgress) => void
): Promise<Workspace> {
  const { plan, query, sessionId } = options;
  let ws = options.existingWorkspace ?? createWorkspace(plan.entryPoint);
  ws = { ...ws, dependencies: [...new Set([...ws.dependencies, ...(plan.suggestedDependencies || [])])] };

  const pool = getPool();

  const filesToGenerate = plan.files.filter(pf => !hasFile(ws, pf.path));
  if (filesToGenerate.length === 0) return ws;

  const topoFiles = sortByDependencyOrder(filesToGenerate, ws, plan);

  broadcastEvent("project:generation:started", {
    sessionId,
    totalFiles: filesToGenerate.length,
    files: filesToGenerate.map(f => f.path)
  });

  let generated = 0;
  const errors: string[] = [];

  for (const planned of topoFiles) {
    generated++;
    onProgress?.({ current: generated, total: filesToGenerate.length, path: planned.path, status: "generating" });
    broadcastEvent("file:generation:started", {
      sessionId,
      path: planned.path,
      purpose: planned.purpose,
      progress: { current: generated, total: filesToGenerate.length }
    });

    try {
      const acquired = pool.acquire({ requireCodeGeneration: true });
      if (!acquired) throw new Error("No LLM providers available.");

      const { provider } = acquired;
      const context = buildFileContext(planned, query, ws, plan);
      const { system, user } = buildFilePrompt(context, primarySkill(planned.skill), !!planned.qualityContract);

      const response = await fetchChatCompletion(provider, {
        model: provider.model,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      }, { mode: "instant" });

      const payload = await response.json();
      recordTokenUsage(
        { sessionId: sessionId ?? null, providerId: provider.id, model: provider.model },
        payload.usage ?? {}
      );

      const raw = (payload.choices?.[0]?.message?.content ?? "").trim();
      const code = cleanCodeResponse(raw, primarySkill(planned.skill));

      const validation = await validateCode(code, primarySkill(planned.skill));
      if (!validation.passable && !validation.valid) {
        errors.push(`${planned.path}: ${validation.errors.map(e => e.message).join("; ")}`);
      }

      ws = addFile(ws, planned.path, code, planned.purpose, primarySkill(planned.skill));

      onProgress?.({ current: generated, total: filesToGenerate.length, path: planned.path, status: "done" });
      broadcastEvent("file:generation:complete", {
        sessionId,
        path: planned.path,
        lineCount: code.split("\n").length,
        valid: validation.valid || validation.passable,
        progress: { current: generated, total: filesToGenerate.length }
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${planned.path}: ${msg}`);
      onProgress?.({ current: generated, total: filesToGenerate.length, path: planned.path, status: "failed", error: msg });
      broadcastEvent("file:generation:error", {
        sessionId,
        path: planned.path,
        error: msg,
        progress: { current: generated, total: filesToGenerate.length }
      });
    }
  }

  broadcastEvent("project:generation:complete", {
    sessionId,
    totalFiles: ws.files ? Object.keys(ws.files).length : 0,
    filePaths: Object.keys(ws.files || {}),
    errorCount: errors.length,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined
  });

  return ws;
}

// ────────────────────────────────────────────────
//  CODE CLEANUP
// ────────────────────────────────────────────────

function cleanCodeResponse(raw: string, skill: SkillId): string {
  const fence = skill === "manim" ? "python" : "javascript";
  let code = raw
    .replace(new RegExp(`^\`\`\`(?:${fence}|js|python)?\\s*`, "i"), "")
    .replace(/\s*```$/, "")
    .trim();
  return code;
}

// ────────────────────────────────────────────────
//  DEPENDENCY-ORDER SORTING
// ────────────────────────────────────────────────

function sortByDependencyOrder(
  files: PlannedFile[],
  existingWs: Workspace,
  plan: WorkPlan
): PlannedFile[] {
  const existingPaths = new Set(Object.keys(existingWs.files));
  const scores = new Map<string, number>();

  const getDepCount = (f: PlannedFile): number => {
    let count = 0;
    for (const imp of f.importsFromLocal || []) {
      const resolved = resolveLocal(imp, plan.files);
      if (resolved && !existingPaths.has(resolved.path)) count++;
    }
    return count;
  };

  return [...files].sort((a, b) => {
    const scoreA = getDepCount(a);
    const scoreB = getDepCount(b);
    return scoreA - scoreB;
  });
}

function resolveLocal(importSpec: string, files: PlannedFile[]): PlannedFile | undefined {
  const clean = importSpec.replace(/^\.?\/?/, "");
  return files.find(f => f.path === clean || f.path === `${clean}.js` || f.path === `src/${clean}` || f.path === `src/${clean}.js`);
}