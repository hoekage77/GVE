import { executeWithQualityLoop } from "../sandbox/execution.js";
import { determineModeFromQuality } from "../quality/mode-engine.js";

type RuntimeStatus = "ok" | "error" | "degraded" | "quality-loop";
type RuntimeOutputKind = "code" | "media";

export interface RuntimeExecutionResult {
  success: boolean;
  status: RuntimeStatus;
  previewUrl: string | null;
  outputKind: RuntimeOutputKind;
  mediaType?: string | null;
  mediaUrl?: string | null;
  mediaArtifactId?: string | null;
  mediaDurationMs?: number | null;
  mediaFps?: number | null;
  mediaResolution?: string | null;
  mediaBytes?: number | null;
  skillId: string;
  skillName?: string;
  dependencyCount?: number;
  durationMs: number;
  renderCount?: number;
  frameCount?: number;
  logs?: unknown[];
  summary?: { childCount: number; types: string[] };
  warning?: string | null;
  warningCode?: string | null;
  error?: string | null;
  errorCode?: string | null;
  acquireDiagnostics?: unknown;
  degradedFrom?: {
    status: string;
    error: string | null;
    errorCode: string | null;
  };
  iterations?: unknown[];
  qualityReport?: unknown;
}

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

export function shouldDegradeRuntimeFailure(runtimeResult: RuntimeExecutionResult | null | undefined): boolean {
  if (!runtimeResult || runtimeResult.success) return false;
  const detail = [runtimeResult.errorCode, runtimeResult.error, runtimeResult.warning, runtimeResult.status]
    .filter(Boolean).join(" | ").toLowerCase();
  return /(acquire_budget_exhausted|runtime_budget_exhausted|budget exhausted|daytona|eai_again|getaddrinfo|enotfound|dns|enetunreach|operation timed out|timed out|failed to create and start sandbox|acquire timeout)/i.test(detail);
}

export function buildDegradedRuntimeResult(
  runtimeResult: RuntimeExecutionResult | null | undefined,
  selectedSkill: string,
  fallbackPreviewUrl = "about:blank"
): RuntimeExecutionResult {
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

export function buildRuntimeFailureResult({
  skillId,
  errorMessage,
  errorCode = "RUNTIME_EXEC_TIMEOUT"
}: {
  skillId: string;
  errorMessage: string;
  errorCode?: string;
}): RuntimeExecutionResult {
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


export async function executeSkillRuntimeWithQualityDecision({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs, sessionId = null, quality = "standard", originalQuery = null, onProgress = null, tools = [] }: any): Promise<any> {
  if (!sessionId) {
    const { getTraceContext } = await import("../trace/context.js");
    const traceCtx = getTraceContext();
    if (traceCtx.sessionId) {
      sessionId = traceCtx.sessionId;
    }
  }
  if (!sessionId || !originalQuery) {
    return buildRuntimeFailureResult({
      skillId,
      errorMessage: "Session ID and original query are required for quality-loop execution."
    });
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
    return buildRuntimeFailureResult({
      skillId,
      errorMessage: error instanceof Error ? error.message : "Quality-loop execution failed unexpectedly."
    });
  }
}
