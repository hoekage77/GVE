/**
 * Agent Controller — Cursor-style orchestrator for multi-file animation generation.
 *
 * Flow:
 *   1. detectIntent → classify query
 *   2. planFiles → build file tree
 *   3. generateFiles → write files with cross-file context
 *   4. validateWorkspace → sandbox test
 *   5. debugWorkspace → iterate on failures
 *   6. broadcast progress at every step
 */

import { detectIntent, type IntentResult } from "./intent-detector.js";
import { planProject, type WorkPlan } from "./project-planner.js";
import { generateProject, type GenerateProgress } from "./project-generator.js";
import { validateWorkspace, type WorkspaceValidationResult } from "./workspace-validator.js";
import { debugWorkspace, type DebugResult } from "./workspace-debugger.js";
import {
  createWorkspace,
  updateFile,
  toSandboxPayload,
  getSourceTree,
  totalLineCount,
  fromSingleFile,
  type Workspace,
  type SkillId
} from "./workspace.js";
import { broadcastEvent } from "../ws/streaming.js";
import { generateVisual } from "./code-generator.js";

export interface AgentOptions {
  query: string;
  sessionId: string;
  preferredSkill?: SkillId;
  quality?: "draft" | "standard" | "high";
  existingWorkspace?: Workspace | null;
  maxTotalTimeMs?: number;
}

export interface AgentResult {
  success: boolean;
  workspace: Workspace | null;
  intent: IntentResult;
  plan?: WorkPlan;
  validation?: WorkspaceValidationResult;
  debug?: DebugResult;
  singleFileResult?: any; // fallback
  phaseTimings: Record<string, number>;
  error?: string;
}

export async function runAgentController(
  options: AgentOptions,
  onProgress?: (e: any) => void
): Promise<AgentResult> {
  const {
    query,
    sessionId,
    preferredSkill = "threejs",
    quality = "standard",
    existingWorkspace = null,
    maxTotalTimeMs = 300_000
  } = options;

  const phaseTimings: Record<string, number> = {};
  const deadline = Date.now() + maxTotalTimeMs;

  // ── PHASE 1: INTENT DETECTION ──
  onProgress?.({ phase: "intent", status: "started" });
  const intentStart = Date.now();
  let intent: IntentResult;
  try {
    intent = await detectIntent(query);
  } catch (err) {
    console.warn("[AgentController] Intent detection failed, using heuristic:", err);
    const { heuristicDetect } = await import("./intent-detector.js");
    intent = heuristicDetect(query);
  }
  phaseTimings.intent = Date.now() - intentStart;
  onProgress?.({ phase: "intent", status: "complete", intent, durationMs: phaseTimings.intent });

  broadcastEvent("agent:intent_ready", {
    sessionId,
    projectType: intent.projectType,
    complexity: intent.complexity,
    domain: intent.domain,
    confidence: intent.confidence
  });

  // Route: modification → existing single-file path (for now)
  if (intent.projectType === "modification" && !existingWorkspace) {
    // Fall through to single-file path
    return runSingleFileAgent({ query, sessionId, preferredSkill, quality, intent, phaseTimings, deadline }, onProgress);
  }

  // Route: simple single-file
  if (intent.projectType === "single-file" || intent.complexity === "simple") {
    return runSingleFileAgent({ query, sessionId, preferredSkill, quality, intent, phaseTimings, deadline }, onProgress);
  }

  // ── PHASE 2: PLAN ──
  onProgress?.({ phase: "plan", status: "started" });
  const planStart = Date.now();
  let plan: WorkPlan;
  try {
    plan = await planProject({ query, preferredSkill, sessionId });
  } catch (err: any) {
    phaseTimings.plan = Date.now() - planStart;
    return {
      success: false,
      workspace: null,
      intent,
      phaseTimings,
      error: `Planning failed: ${err.message}`
    };
  }
  phaseTimings.plan = Date.now() - planStart;
  onProgress?.({ phase: "plan", status: "complete", plan, durationMs: phaseTimings.plan });

  broadcastEvent("agent:plan_ready", {
    sessionId,
    files: plan.files.map(f => ({ path: f.path, purpose: f.purpose, dependencies: f.npmDependencies })),
    entryPoint: plan.entryPoint
  });

  // ── PHASE 3: GENERATE ──
  onProgress?.({ phase: "generate", status: "started", totalFiles: plan.files.length });
  const genStart = Date.now();
  let workspace: Workspace;
  try {
    workspace = await generateProject(
      { plan, query, sessionId },
      (gp: GenerateProgress) => {
        onProgress?.({
          phase: "generate",
          status: gp.status,
          file: gp.path,
          progress: { current: gp.current, total: gp.total }
        });
        broadcastEvent("agent:file_start", {
          sessionId,
          path: gp.path,
          iteration: gp.current,
          total: gp.total
        });
      }
    );
  } catch (err: any) {
    phaseTimings.generate = Date.now() - genStart;
    return {
      success: false,
      workspace: null,
      intent,
      plan,
      phaseTimings,
      error: `Generation failed: ${err.message}`
    };
  }
  phaseTimings.generate = Date.now() - genStart;
  onProgress?.({
    phase: "generate",
    status: "complete",
    fileCount: Object.keys(workspace.files).length,
    durationMs: phaseTimings.generate
  });

  // Broadcast all files complete
  for (const [path, file] of Object.entries(workspace.files)) {
    broadcastEvent("agent:file_complete", {
      sessionId,
      path,
      lines: file.content.split("\n").length,
      purpose: file.purpose
    });
  }

  // ── PHASE 4: VALIDATE ──
  onProgress?.({ phase: "validate", status: "started" });
  const valStart = Date.now();
  const validation = await validateWorkspace(workspace, sessionId);
  phaseTimings.validate = Date.now() - valStart;
  onProgress?.({
    phase: "validate",
    status: validation.success ? "success" : "failed",
    errors: validation.errors.length,
    durationMs: phaseTimings.validate
  });

  broadcastEvent("agent:validation_result", {
    sessionId,
    success: validation.success,
    errors: validation.errors.map(e => ({ path: e.path, line: e.line, message: e.message }))
  });

  if (validation.success) {
    const totalMs = Object.values(phaseTimings).reduce((a, b) => a + b, 0);
    broadcastEvent("agent:complete", {
      sessionId,
      success: true,
      fileCount: Object.keys(workspace.files).length,
      totalLines: totalLineCount(workspace),
      durationMs: totalMs
    });

    return {
      success: true,
      workspace,
      intent,
      plan,
      validation,
      phaseTimings
    };
  }

  // ── PHASE 5: DEBUG ──
  if (Date.now() > deadline) {
    return {
      success: false,
      workspace,
      intent,
      plan,
      validation,
      phaseTimings,
      error: "Timeout before debug phase"
    };
  }

  onProgress?.({ phase: "debug", status: "started" });
  const debugStart = Date.now();
  const debug = await debugWorkspace(workspace, sessionId, query, {
    maxGlobalIterations: quality === "high" ? 5 : quality === "draft" ? 2 : 3,
    maxPerFileAttempts: 3,
    skill: preferredSkill === "manim" ? "python" : "javascript"
  });
  phaseTimings.debug = Date.now() - debugStart;
  onProgress?.({
    phase: "debug",
    status: debug.success ? "success" : "failed",
    iterations: debug.iterations.length,
    remainingErrors: debug.finalErrors.length,
    durationMs: phaseTimings.debug
  });

  const totalMs = Object.values(phaseTimings).reduce((a, b) => a + b, 0);
  broadcastEvent("agent:complete", {
    sessionId,
    success: debug.success,
    fileCount: Object.keys(debug.workspace.files).length,
    totalLines: totalLineCount(debug.workspace),
    iterations: debug.iterations.length,
    durationMs: totalMs
  });

  return {
    success: debug.success,
    workspace: debug.success ? debug.workspace : workspace,
    intent,
    plan,
    validation,
    debug,
    phaseTimings
  };
}

async function runSingleFileAgent(
  params: {
    query: string;
    sessionId: string;
    preferredSkill: SkillId;
    quality: "draft" | "standard" | "high";
    intent: IntentResult;
    phaseTimings: Record<string, number>;
    deadline: number;
  },
  onProgress?: (e: any) => void
): Promise<AgentResult> {
  const { query, sessionId, preferredSkill, quality, intent, phaseTimings, deadline } = params;

  onProgress?.({ phase: "generate", status: "started", mode: "single-file" });
  const genStart = Date.now();

  let result: any;
  try {
    result = await generateVisual({
      prompt: query,
      skill: preferredSkill,
      quality,
      sessionId
    });
  } catch (err: any) {
    phaseTimings.generate = Date.now() - genStart;
    return {
      success: false,
      workspace: null,
      intent,
      phaseTimings,
      error: `Single-file generation failed: ${err.message}`
    };
  }

  phaseTimings.generate = Date.now() - genStart;
  onProgress?.({ phase: "generate", status: "complete", mode: "single-file", durationMs: phaseTimings.generate });

  const workspace = fromSingleFile(result.code ?? "", preferredSkill);

  // Try to validate even single-file
  onProgress?.({ phase: "validate", status: "started" });
  const valStart = Date.now();
  const validation = await validateWorkspace(workspace, sessionId);
  phaseTimings.validate = Date.now() - valStart;

  if (!validation.success && Date.now() < deadline) {
    onProgress?.({ phase: "debug", status: "started" });
    const debugStart = Date.now();
    const debug = await debugWorkspace(workspace, sessionId, query, {
      maxGlobalIterations: 2,
      maxPerFileAttempts: 2,
      skill: preferredSkill === "manim" ? "python" : "javascript"
    });
    phaseTimings.debug = Date.now() - debugStart;

    return {
      success: debug.success,
      workspace: debug.success ? debug.workspace : workspace,
      intent,
      singleFileResult: result,
      validation,
      debug,
      phaseTimings
    };
  }

  return {
    success: validation.success,
    workspace,
    intent,
    singleFileResult: result,
    validation,
    phaseTimings
  };
}
