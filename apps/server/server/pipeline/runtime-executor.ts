// @ts-nocheck
import { executeSkillRuntime } from "../skill-runtime.js";
import { executeWithQualityLoop } from "../sandbox-execution.js";
import { determineModeFromQuality } from "../mode-decision-engine.js";

// Constants
export const runtimeExecutionMaxFrames = Number.parseInt(String(process.env.RUNTIME_EXEC_MAX_FRAMES ?? "48"), 10);
const runtimeExecutionTimeoutMs = Number.parseInt(String(process.env.RUNTIME_EXEC_TIMEOUT_MS ?? "2200"), 10);
const manimRuntimeExecutionTimeoutMs = Number.parseInt(String(process.env.RUNTIME_EXEC_TIMEOUT_MANIM_MS ?? "90000"), 10);
const runtimeExecutionReserveMs = Number.parseInt(String(process.env.RUNTIME_EXEC_RESERVE_MS ?? "10000"), 10);
const manimRuntimeExecutionReserveMs = Number.parseInt(String(process.env.RUNTIME_EXEC_RESERVE_MANIM_MS ?? "90000"), 10);
const turnBudgetMs = Number.parseInt(String(process.env.TURN_BUDGET_MS ?? "300000"), 10);

export const ITERATION_CONFIG_BY_QUALITY: Record<string, any> = {
  draft: { maxIterations: 1, qualityThreshold: 50, enableAutoPatch: false },
  standard: { maxIterations: 2, qualityThreshold: 75, enableAutoPatch: true },
  high: { maxIterations: 3, qualityThreshold: 85, enableAutoPatch: true }
};

export function resolveIterationConfig(quality: string): any {
  return ITERATION_CONFIG_BY_QUALITY[quality] ?? ITERATION_CONFIG_BY_QUALITY.standard;
}

export function resolveRuntimeExecutionTimeoutMs(skillId: string): number {
  return skillId === "manim" ? manimRuntimeExecutionTimeoutMs : runtimeExecutionTimeoutMs;
}

export function resolveRuntimeExecutionReserveMs(skillId: string): number {
  return skillId === "manim" ? manimRuntimeExecutionReserveMs : runtimeExecutionReserveMs;
}

export function getTurnDeadlineAtMs(turnStartedAtMs?: number): number {
  if (typeof turnStartedAtMs === "number" && Number.isFinite(turnStartedAtMs)) {
    return turnStartedAtMs + turnBudgetMs;
  }
  return Date.now() + turnBudgetMs;
}

export function getRemainingBudgetMs(deadlineAtMs: number): number {
  if (!Number.isFinite(deadlineAtMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, deadlineAtMs - Date.now());
}

export function computeBoundedTimeoutMs(deadlineAtMs: number, configuredTimeoutMs: number, minimumTimeoutMs = 300): number {
  const remainingMs = getRemainingBudgetMs(deadlineAtMs);
  if (!Number.isFinite(remainingMs)) return configuredTimeoutMs;
  if (remainingMs <= 0) return 0;
  const minimum = Math.min(minimumTimeoutMs, remainingMs);
  return Math.max(minimum, Math.min(configuredTimeoutMs, remainingMs));
}

export function shouldDegradeRuntimeFailure(runtimeResult: any): boolean {
  if (!runtimeResult || runtimeResult.success) return false;
  const detail = [runtimeResult.errorCode, runtimeResult.error, runtimeResult.warning, runtimeResult.status]
    .filter(Boolean).join(" | ").toLowerCase();
  return /(acquire_budget_exhausted|runtime_budget_exhausted|budget exhausted|daytona|eai_again|getaddrinfo|enotfound|dns|enetunreach|operation timed out|timed out|failed to create and start sandbox|acquire timeout)/i.test(detail);
}

export function buildDegradedRuntimeResult(runtimeResult: any, selectedSkill: string, fallbackPreviewUrl = "about:blank"): any {
  const originalDetail = runtimeResult?.error || runtimeResult?.warning || "Sandbox runtime unavailable.";
  const resolvedOutputKind = runtimeResult?.outputKind ?? (selectedSkill === "manim" ? "media" : "code");
  const resolvedMediaType = runtimeResult?.mediaType ?? (resolvedOutputKind === "media" ? "video/mp4" : null);
  const resolvedPreviewUrl = runtimeResult?.previewUrl ?? fallbackPreviewUrl;
  const resolvedMediaUrl = runtimeResult?.mediaUrl ?? (resolvedOutputKind === "media" ? resolvedPreviewUrl : null);

  return {
    success: true,
    status: "degraded",
    previewUrl: resolvedPreviewUrl,
    outputKind: resolvedOutputKind,
    mediaType: resolvedMediaType,
    mediaUrl: resolvedMediaUrl,
    mediaArtifactId: runtimeResult?.mediaArtifactId ?? null,
    mediaDurationMs: runtimeResult?.mediaDurationMs ?? null,
    mediaFps: runtimeResult?.mediaFps ?? null,
    mediaResolution: runtimeResult?.mediaResolution ?? null,
    mediaBytes: runtimeResult?.mediaBytes ?? null,
    skillId: runtimeResult?.skillId ?? selectedSkill,
    skillName: runtimeResult?.skillName ?? selectedSkill,
    dependencyCount: runtimeResult?.dependencyCount ?? 0,
    durationMs: runtimeResult?.durationMs ?? 0,
    renderCount: runtimeResult?.renderCount ?? 0,
    frameCount: runtimeResult?.frameCount ?? 0,
    logs: runtimeResult?.logs ?? [],
    summary: runtimeResult?.summary ?? { childCount: 0, types: [] },
    warning: `Runtime degraded due to sandbox provisioning constraints: ${originalDetail}`,
    warningCode: runtimeResult?.warningCode ?? "RUNTIME_DEGRADED_PROVISIONING",
    error: null,
    errorCode: null,
    acquireDiagnostics: runtimeResult?.acquireDiagnostics ?? null,
    degradedFrom: {
      status: runtimeResult?.status ?? "error",
      error: runtimeResult?.error ?? null,
      errorCode: runtimeResult?.errorCode ?? null
    }
  };
}

export function buildRuntimeFailureResult({ skillId, errorMessage, errorCode = "RUNTIME_EXEC_TIMEOUT" }: any): any {
  const outputKind = skillId === "manim" ? "media" : "code";
  return {
    success: false,
    status: "error",
    previewUrl: null,
    outputKind,
    mediaType: outputKind === "media" ? "video/mp4" : null,
    mediaUrl: null,
    skillId,
    skillName: skillId,
    dependencyCount: 0,
    durationMs: 0,
    renderCount: 0,
    frameCount: 0,
    logs: [],
    summary: { childCount: 0, types: [] },
    error: errorMessage,
    errorCode
  };
}

async function withTimeout(promise: Promise<any>, timeoutMs: number, timeoutMessage: string): Promise<any> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(timeoutMessage);
  let timeoutHandle: any;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function executeSkillRuntimeBounded({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs, sessionId = null, tools = [] }: any): Promise<any> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return buildRuntimeFailureResult({ skillId, errorMessage: "Turn budget exhausted before runtime execution.", errorCode: "RUNTIME_BUDGET_EXHAUSTED" });
  }
  const envelopeTimeoutMs = timeoutMs + 1500;
  try {
    return await withTimeout(
      executeSkillRuntime({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs, sessionId, tools }),
      envelopeTimeoutMs,
      `Runtime execution timed out after ${envelopeTimeoutMs}ms.`
    );
  } catch (error: any) {
    return buildRuntimeFailureResult({ skillId, errorMessage: error instanceof Error ? error.message : "Unknown runtime execution timeout", errorCode: error?.code ? String(error.code) : "RUNTIME_EXEC_TIMEOUT" });
  }
}

export async function executeSkillRuntimeWithQualityDecision({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs, sessionId = null, quality = "standard", originalQuery = null, onProgress = null, tools = [] }: any): Promise<any> {
  const shouldUseQualityLoop = quality !== "draft" && sessionId && originalQuery;
  if (!shouldUseQualityLoop) {
    return executeSkillRuntimeBounded({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs, sessionId, tools });
  }

  try {
    const iterationConfig = resolveIterationConfig(quality);
    const executionMode = determineModeFromQuality(quality);
    
    const sandboxExecutionRequest = {
      sessionId, code, skill: skillId, prompt: originalQuery, tools, mode: executionMode,
      config: { ...iterationConfig, timeoutPerIterationMs: timeoutMs }
    };

    const qualityLoopResult: any = await executeWithQualityLoop(sandboxExecutionRequest, onProgress as any);

    if (!qualityLoopResult.success) {
      return {
        success: false, status: "error", previewUrl: null, outputKind: skillId === "manim" ? "media" : "code",
        skillId, durationMs: qualityLoopResult.error ? 0 : (qualityLoopResult.iterations?.[0]?.durationMs ?? 0),
        warning: `Quality loop encountered error: ${qualityLoopResult.error}`, error: qualityLoopResult.error,
        iterations: qualityLoopResult.iterations ?? [], qualityReport: qualityLoopResult.qualityReport ?? null
      };
    }

    const finalIteration = qualityLoopResult.iterations?.[qualityLoopResult.finalIteration - 1];
    return {
      success: true, status: "quality-loop", previewUrl: qualityLoopResult.previewUrl,
      outputKind: skillId === "manim" ? "media" : "code", mediaUrl: qualityLoopResult.previewUrl,
      skillId, durationMs: finalIteration?.durationMs ?? 0,
      iterations: qualityLoopResult.iterations ?? [], qualityReport: qualityLoopResult.qualityReport
    };
  } catch (error) {
    return executeSkillRuntimeBounded({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs, sessionId });
  }
}
