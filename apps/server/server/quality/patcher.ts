/**
 * Patch Generator — LLM-powered code modifications for quality loop
 *
 * Synthesizes code patches from quality analysis reports using LLM.
 * Integrates with the quality loop to iteratively improve generated code.
 */

import { createHash } from "crypto";
import { parse as parseAcorn } from "acorn";

// ─── Types ───────────────────────────────────────────────────────────

export interface PatchGoal {
  category: string;
  issue?: string;
  suggestion?: string;
  severity?: number;
  affectedFile?: string;
  description?: string;
}

export interface GeneratedPatch {
  filePath: string;
  originalCode: string;
  patchedCode: string;
  explanation: string;
  expectedScoreImpact: number;
  riskLevel: number;
}

interface ProjectFile {
  path: string;
  content: string;
}

export interface ProjectState {
  entryPoint?: string;
  files: ProjectFile[];
}

export interface PatchGeneratorOptions {
  maxPatchRetries?: number;
  patchTimeoutMs?: number;
  minConfidenceScore?: number;
}

export interface AgentMemory {
  previousAttempts?: Array<{ successful: boolean; description: string }>;
}

export interface LLMProvider {
  generate(prompt: string, options?: { mode?: string }): Promise<string>;
}

// ─── Patch Generator Class ───────────────────────────────────────────

export class PatchGenerator {
  private llm: LLMProvider;
  private maxPatchRetries: number;
  private patchTimeoutMs: number;
  private minConfidenceScore: number;
  private patchCache: Map<string, GeneratedPatch>;

  constructor(llmProvider: LLMProvider, options: PatchGeneratorOptions = {}) {
    this.llm = llmProvider;
    this.maxPatchRetries = options.maxPatchRetries || 2;
    this.patchTimeoutMs = options.patchTimeoutMs || 30000;
    this.minConfidenceScore = options.minConfidenceScore || 0.7;
    this.patchCache = new Map();
  }

  async generatePatches(
    originalCode: string,
    project: ProjectState | null,
    patchGoals: PatchGoal[],
    agentMemory?: AgentMemory,
    context: Record<string, any> = {}
  ): Promise<GeneratedPatch[]> {
    if (!patchGoals || patchGoals.length === 0) {
      return [];
    }

    const goalsByFile = this._groupGoalsByFile(patchGoals, project);
    const patches: GeneratedPatch[] = [];
    const failedFiles: string[] = [];

    for (const [filePath, goals] of Object.entries(goalsByFile)) {
      try {
        const fileContent = this._getFileContent(filePath, project, originalCode);
        const cacheKey = this._buildCacheKey(filePath, fileContent, goals);

        if (this.patchCache.has(cacheKey)) {
          patches.push(this.patchCache.get(cacheKey)!);
          continue;
        }

        const patch = await this._generateFilePatch(filePath, fileContent, goals, agentMemory, project, context);

        if (patch) {
          if (this._validatePatch(patch, project)) {
            patches.push(patch);
            this.patchCache.set(cacheKey, patch);
          }
        }
      } catch (err: any) {
        console.error(`[PatchGenerator] Failed to patch ${filePath}: ${err.message}`);
        failedFiles.push(filePath);
      }
    }

    if (failedFiles.length > 0) {
      console.warn(`[PatchGenerator] Failed to generate patches for: ${failedFiles.join(", ")}`);
    }

    return patches;
  }

  private async _generateFilePatch(
    filePath: string,
    fileContent: string,
    goals: PatchGoal[],
    agentMemory?: AgentMemory,
    project?: ProjectState | null,
    context?: Record<string, any>
  ): Promise<GeneratedPatch | null> {
    for (let attempt = 0; attempt <= this.maxPatchRetries; attempt++) {
      try {
        const prompt = this._buildPatchPrompt(filePath, fileContent, goals, agentMemory, project, context, attempt);

        const responseText = await Promise.race([
          this.llm.generate(prompt, { mode: "Thinking" }),
          this._withTimeout(this.patchTimeoutMs)
        ]) as string;

        const patchedCode = this._extractCode(responseText);

        if (!this._isValidCode(patchedCode, context?.skill)) {
          if (attempt < this.maxPatchRetries) {
            console.warn(`[PatchGenerator] Invalid syntax on attempt ${attempt + 1}, retrying...`);
            continue;
          }
          throw new Error("Generated code has invalid syntax");
        }

        return {
          filePath,
          originalCode: fileContent,
          patchedCode,
          explanation: this._extractExplanation(responseText),
          expectedScoreImpact: this._estimateImpact(goals),
          riskLevel: this._estimateRisk(fileContent, patchedCode)
        };
      } catch (err: any) {
        if (attempt === this.maxPatchRetries) {
          throw err;
        }
        console.warn(`[PatchGenerator] Attempt ${attempt + 1} failed: ${err.message}, retrying...`);
      }
    }

    return null;
  }

  private _buildPatchPrompt(
    filePath: string,
    fileContent: string,
    goals: PatchGoal[],
    agentMemory?: AgentMemory,
    project?: ProjectState | null,
    context?: Record<string, any>,
    attempt = 0
  ): string {
    const lines = fileContent.split("\n");
    const lineCount = lines.length;
    const estimatedScore = context?.currentScore || 50;

    const skill = context?.skill || "threejs";
    const isPython = skill === "manim";
    const languageStr = isPython ? "Python (Manim)" : "JavaScript/TypeScript";
    const blockStr = isPython ? "python" : "javascript";
    
    let prompt = `You are an expert ${languageStr} code enhancer for 3D/visual generation.

Your task: Fix the quality issues below to improve the code from score ${estimatedScore}/100.

File: ${filePath}
Lines: ${lineCount}

Quality Issues to Fix:
${goals.map((g, i) => `${i + 1}. [${g.category}] ${g.issue || g.description}\n   Fix: ${g.suggestion || "Apply fix"}`).join("\n")}`;

    if (agentMemory?.previousAttempts && agentMemory.previousAttempts.length > 0) {
      const successfulFixes = agentMemory.previousAttempts
        .filter((a) => a.successful)
        .map((a) => a.description);

      if (successfulFixes.length > 0) {
        prompt += `\n\nPreviously successful approaches:\n${successfulFixes.map((f) => `- ${f}`).join("\n")}`;
      }
    }

    prompt += `\n\nImportant:
1. Fix ONLY the issues listed above
2. Preserve all imports, exports, and function/class signatures
3. Keep initial setup code intact
4. Maintain animation smoothness
5. Don't remove any core functionality
6. Output ONLY valid ${languageStr} code

Current code:
\`\`\`${blockStr}
${fileContent}
\`\`\`

Provide the complete patched file (start with \`\`\`${blockStr}, end with \`\`\`).
After code, add: "EXPLANATION: [one sentence describing changes]"`;

    if (attempt > 0) {
      prompt += `\n\nNote: This is attempt ${attempt + 1}. Previous attempt had issues, so be extra careful with syntax and logic.`;
    }

    return prompt;
  }

  private _extractCode(text: string): string {
    const match = text.match(/```(?:javascript|typescript|js|ts|python|py)?\n([\s\S]*?)\n```/);
    if (match) return match[1]!.trim();

    const lines = text.split("\n");
    const codeLines: string[] = [];
    let inCode = false;

    for (const line of lines) {
      if (line.includes("```")) {
        inCode = !inCode;
      } else if (inCode) {
        codeLines.push(line);
      }
    }

    return codeLines.join("\n").trim() || text;
  }

  private _extractExplanation(text: string): string {
    const match = text.match(/EXPLANATION:\s*(.+?)(?:\n|$)/i);
    if (match) return match[1]!.trim();

    const parts = text.split("```");
    if (parts.length > 1) {
      return parts[parts.length - 1]!.trim().substring(0, 100);
    }

    return "Patch applied for quality improvement";
  }

  private _groupGoalsByFile(goals: PatchGoal[], project: ProjectState | null): Record<string, PatchGoal[]> {
    const grouped: Record<string, PatchGoal[]> = {};

    for (const goal of goals) {
      let file = goal.affectedFile;

      if (!file) {
        if (goal.category === "visual") file = "materials.js";
        else if (goal.category === "animation") file = "animations.js";
        else file = project?.entryPoint || "index.js";
      }

      if (!grouped[file]) grouped[file] = [];
      grouped[file]!.push(goal);
    }

    return grouped;
  }

  private _getFileContent(filePath: string, project: ProjectState | null, originalCode: string): string {
    if (project?.files) {
      const file = project.files.find((f) => f.path === filePath);
      if (file) return file.content;
    }
    return originalCode;
  }

  private _estimateImpact(goals: PatchGoal[]): number {
    if (!goals || goals.length === 0) return 0;
    const totalSeverity = goals.reduce((sum, g) => {
      let val = 0.5;
      if (typeof g.severity === "number") val = g.severity;
      else if (g.severity === "critical" || g.severity === "high") val = 3;
      else if (g.severity === "medium") val = 2;
      else if (g.severity === "low") val = 1;
      return sum + val;
    }, 0);
    return Math.min(totalSeverity * 10, 30);
  }

  private _estimateRisk(originalCode: string, patchedCode: string): number {
    const originalLines = originalCode.split("\n").length;
    const patchedLines = patchedCode.split("\n").length;

    const lineDiff = Math.abs(patchedLines - originalLines);
    const changeRatio = lineDiff / Math.max(originalLines, 1);

    let risk = Math.min(changeRatio * 2, 1.0);

    const originalImports = (originalCode.match(/^import /gm) || []).length;
    const patchedImports = (patchedCode.match(/^import /gm) || []).length;
    if (originalImports !== patchedImports) {
      risk = Math.min(risk + 0.2, 1.0);
    }

    return risk;
  }

  private _validatePatch(patch: GeneratedPatch, _project?: ProjectState | null): boolean {
    const dangerousPatterns = [/eval\s*\(/i, /Function\s*\(/i, /process\.exit/i, /require\s*\(\s*['"`].*user.*/i];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(patch.patchedCode)) {
        console.warn(`[PatchGenerator] Patch blocked: contains dangerous pattern ${pattern}`);
        return false;
      }
    }

    const hasOriginalExport = /^export|^module\.exports/m.test(patch.originalCode);
    const hasNewExport = /^export|^module\.exports/m.test(patch.patchedCode);

    if (hasOriginalExport && !hasNewExport) {
      console.warn("[PatchGenerator] Patch blocked: removes exports");
      return false;
    }

    return true;
  }

  private _isValidCode(code: string, skill?: string): boolean {
    if (skill === "manim") {
      return true;
    }
    
    try {
      parseAcorn(code, { ecmaVersion: "latest", sourceType: "module" });
      return true;
    } catch {
      return false;
    }
  }

  private _buildCacheKey(filePath: string, content: string, goals: PatchGoal[]): string {
    const hash = createHash("sha256")
      .update(content)
      .update(JSON.stringify(goals))
      .digest("hex");
    return `${filePath}:${hash}`;
  }

  private _withTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error("Patch generation timeout")), ms));
  }

  clearCache(): void {
    this.patchCache.clear();
  }
}

// ─── Utilities ───────────────────────────────────────────────────────

export function applyPatches(project: ProjectState, patches: GeneratedPatch[]): ProjectState {
  if (!patches || patches.length === 0) return project;

  const updatedFiles = project.files.map((file) => {
    const patch = patches.find((p) => p.filePath === file.path);
    return patch ? { ...file, content: patch.patchedCode } : file;
  });

  return { ...project, files: updatedFiles };
}

export function rollbackPatches(originalProject: ProjectState): ProjectState {
  return originalProject;
}

export function summarizePatches(patches: GeneratedPatch[]): Array<{ file: string; change: string; impact: string; risk: string }> {
  return patches.map((p) => ({
    file: p.filePath,
    change: p.explanation,
    impact: `+${Math.round(p.expectedScoreImpact)} pts`,
    risk: p.riskLevel > 0.7 ? "HIGH" : p.riskLevel > 0.4 ? "MEDIUM" : "LOW"
  }));
}
