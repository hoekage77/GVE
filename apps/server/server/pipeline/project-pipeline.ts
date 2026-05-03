import { planProject, type WorkPlan } from "./project-planner.js";
import { generateProject, type GenerateProgress } from "./project-generator.js";
import { executeWithQualityLoop } from "../sandbox/execution.js";
import {
  createWorkspace,
  fromSingleFile,
  toSandboxPayload,
  getSourceTree,
  totalLineCount,
  type Workspace,
  type SkillId
} from "./workspace.js";
import { broadcastEvent } from "../ws/streaming.js";

export interface MultiFileGenerateOptions {
  query: string;
  preferredSkill?: SkillId;
  sessionId?: string;
  quality?: "draft" | "standard" | "high";
  enableUserReview?: boolean;
  maxTotalTimeMs?: number;
}

export interface MultiFileGenerateResult {
  success: boolean;
  workspace: Workspace;
  plan: WorkPlan;
  fileList: string[];
  totalLines: number;
  sourceTree: string;
  qualityReport?: any;
  iterations?: any[];
  error?: string;
}

export async function generateMultiFileVisual(
  options: MultiFileGenerateOptions,
  onProgress?: (e: any) => void
): Promise<MultiFileGenerateResult> {
  const {
    query,
    preferredSkill = "threejs",
    sessionId,
    quality = "standard",
    maxTotalTimeMs = 300000
  } = options;

  const phaseTimings: Record<string, number> = {};

  // ── PHASE 1: PLAN ──
  let planStart = Date.now();
  onProgress?.({ phase: "planning", status: "started" });

  let plan: WorkPlan;
  try {
    plan = await planProject({
      query,
      preferredSkill,
      sessionId
    });
  } catch (err) {
    return {
      success: false,
      workspace: createWorkspace(),
      plan: { entryPoint: "", files: [], summary: "", reasoning: "", suggestedDependencies: [] },
      fileList: [],
      totalLines: 0,
      sourceTree: "",
      error: `Project planning failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  phaseTimings.plan = Date.now() - planStart;
  onProgress?.({ phase: "planning", status: "complete", plan, durationMs: phaseTimings.plan });
  broadcastEvent("plan:completed", { sessionId, fileCount: plan.files.length, summary: plan.summary });

  // ── PHASE 2: GENERATE ──
  let genStart = Date.now();
  onProgress?.({ phase: "generating", status: "started", totalFiles: plan.files.length });

  let workspace: Workspace;
  try {
    workspace = await generateProject(
      { plan, query, sessionId },
      (gp: GenerateProgress) => {
        onProgress?.({
          phase: "generating",
          status: gp.status,
          file: gp.path,
          progress: { current: gp.current, total: gp.total }
        });
      }
    );
  } catch (err) {
    return {
      success: false,
      workspace: createWorkspace(),
      plan,
      fileList: [],
      totalLines: 0,
      sourceTree: "",
      error: `File generation failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  phaseTimings.generate = Date.now() - genStart;
  onProgress?.({ phase: "generating", status: "complete", fileCount: Object.keys(workspace.files).length, durationMs: phaseTimings.generate });

  // ── PHASE 3: EXECUTE WITH QUALITY LOOP ──
  let execStart = Date.now();
  onProgress?.({ phase: "executing", status: "started" });

  const entry = workspace.files[workspace.entryPoint];
  if (!entry) {
    return {
      success: false,
      workspace,
      plan,
      fileList: Object.keys(workspace.files),
      totalLines: totalLineCount(workspace),
      sourceTree: getSourceTree(workspace),
      error: `Entry point "${workspace.entryPoint}" not found in generated files.`
    };
  }

  let qualityResult: any;
  try {
    qualityResult = await executeWithQualityLoop(
      {
        sessionId: sessionId ?? "",
        code: entry.content,
        skill: entry.skill,
        prompt: query,
        tools: [],
        workspace,
        config: {
          quality,
          maxIterations: quality === "high" ? 3 : quality === "draft" ? 1 : 2,
          qualityThreshold: quality === "high" ? 85 : quality === "draft" ? 50 : 75,
          enableAutoPatch: quality !== "draft"
        }
      },
      (e) => onProgress?.({ phase: "executing", status: "running", event: e })
    );

    // Prefer the workspace returned by the quality loop (reflects multi-file patches)
    if (qualityResult.workspace) {
      workspace = qualityResult.workspace;
    } else if (qualityResult.prePatchedCode && qualityResult.prePatchedCode !== entry.content) {
      workspace = {
        ...workspace,
        files: {
          ...workspace.files,
          [workspace.entryPoint]: {
            ...entry,
            content: qualityResult.prePatchedCode || entry.content,
            generatedAt: new Date().toISOString()
          }
        },
        updatedAt: new Date().toISOString()
      };
    }
  } catch (err) {
    phaseTimings.execute = Date.now() - execStart;
    return {
      success: false,
      workspace,
      plan,
      fileList: Object.keys(workspace.files),
      totalLines: totalLineCount(workspace),
      sourceTree: getSourceTree(workspace),
      qualityReport: qualityResult?.qualityReport ?? null,
      iterations: qualityResult?.iterations ?? [],
      error: `Quality-loop execution failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  phaseTimings.execute = Date.now() - execStart;
  onProgress?.({ phase: "executing", status: "complete", durationMs: phaseTimings.execute });

  const totalMs = phaseTimings.plan + phaseTimings.generate + phaseTimings.execute;

  broadcastEvent("project:multi-file:complete", {
    sessionId,
    success: qualityResult.success,
    fileCount: Object.keys(workspace.files).length,
    totalLines: totalLineCount(workspace),
    durationMs: totalMs,
    phaseTimings
  });

  return {
    success: qualityResult.success ?? false,
    workspace,
    plan,
    fileList: Object.keys(workspace.files),
    totalLines: totalLineCount(workspace),
    sourceTree: getSourceTree(workspace),
    qualityReport: qualityResult?.qualityReport ?? null,
    iterations: qualityResult?.iterations ?? [],
    error: qualityResult.error ?? undefined
  };
}