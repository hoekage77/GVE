/**
 * DaytonaSkillRuntime — Daytona pool sandbox adapter implementing SkillRuntime.
 *
 * Wraps skill-runtime.ts (pool-based acquisition, tool installation,
 * multi-file builds, Manim/Python execution) into the uniform
 * SkillRuntime interface.
 */

import {
  executeSkillRuntime,
  getSandboxRuntimeMetrics,
  warmupSandboxForSkill,
  shutdownSandboxRuntime
} from "../skill-runtime.js";

import type {
  SkillRuntime,
  SandboxHandle,
  AcquireRequest,
  ExecutionPayload,
  RuntimeExecutionResult,
  HealthStatus,
  RuntimeMetrics
} from "./types.js";

export class DaytonaSkillRuntime implements SkillRuntime {
  readonly provider = "daytona";

  private activeHandles = new Map<string, SandboxHandle>();

  async acquire(request: AcquireRequest): Promise<SandboxHandle> {
    // Daytona acquire + tool installation happens inside executeSkillRuntime.
    // For the SkillRuntime interface we do a lightweight acquire by requesting
    // a warmed sandbox and storing the context for later execution.
    warmupSandboxForSkill(request.skillId);

    const handle: SandboxHandle = {
      id: `daytona-${request.sessionId}-${Date.now()}`,
      kind: "daytona",
      _backend: {
        sessionId: request.sessionId,
        skillId: request.skillId,
        tools: request.tools ?? [],
        turnDeadlineAtMs: request.turnDeadlineAtMs ?? null
      }
    };

    this.activeHandles.set(handle.id, handle);
    return handle;
  }

  async execute(handle: SandboxHandle, payload: ExecutionPayload): Promise<RuntimeExecutionResult> {
    const ctx = handle._backend;

    const rawResult: any = await executeSkillRuntime({
      skillId: payload.skillId,
      code: payload.code,
      timeoutMs: payload.timeoutMs,
      maxFrames: payload.maxFrames,
      turnDeadlineAtMs: ctx.turnDeadlineAtMs,
      sessionId: payload.sessionId ?? ctx.sessionId,
      tools: ctx.tools
    });

    return {
      success: rawResult.success,
      status: rawResult.status ?? (rawResult.success ? "completed" : "error"),
      previewUrl: rawResult.previewUrl ?? null,
      outputKind: rawResult.outputKind ?? "code",
      mediaType: rawResult.mediaType ?? null,
      mediaUrl: rawResult.mediaUrl ?? null,
      mediaArtifactId: rawResult.mediaArtifactId ?? null,
      mediaDurationMs: rawResult.mediaDurationMs ?? null,
      mediaFps: rawResult.mediaFps ?? null,
      mediaResolution: rawResult.mediaResolution ?? null,
      mediaBytes: rawResult.mediaBytes ?? null,
      error: rawResult.error ?? null,
      errorCode: rawResult.errorCode ?? null,
      durationMs: rawResult.durationMs ?? 0,
      renderCount: rawResult.renderCount ?? 0,
      frameCount: rawResult.frameCount ?? 0,
      logs: rawResult.logs ?? [],
      summary: rawResult.summary ?? { childCount: 0, types: [] },
      warning: rawResult.warning ?? null,
      warningCode: rawResult.warningCode ?? null,
      buildArtifacts: rawResult.buildArtifacts,
      acquireDiagnostics: rawResult.acquireDiagnostics,
      _source: rawResult._source ?? "daytona"
    };
  }

  async release(handle: SandboxHandle): Promise<void> {
    // executeSkillRuntime already releases the sandbox internally.
    // This is a no-op for Daytona since cleanup is handled per-call.
    this.activeHandles.delete(handle.id);
  }

  prewarm(skillId: string): void {
    warmupSandboxForSkill(skillId);
  }

  async health(): Promise<HealthStatus> {
    // Daytona health is implicit via pool metrics
    const metrics = getSandboxRuntimeMetrics();
    return {
      healthy: metrics.acquireFailuresTotal === 0 || metrics.acquireSuccessTotal > 0,
      provider: this.provider,
      details: metrics
    };
  }

  metrics(): RuntimeMetrics {
    const raw = getSandboxRuntimeMetrics();
    return {
      provider: this.provider,
      activeHandles: this.activeHandles.size,
      acquireAttempts: raw.acquireAttemptsTotal,
      acquireSuccess: raw.acquireSuccessTotal,
      acquireFailures: raw.acquireFailuresTotal,
      averageAcquireMs: (raw as any).allAcquireDurationsMs?.length
        ? (raw as any).allAcquireDurationsMs.reduce((a: number, b: number) => a + b, 0) / (raw as any).allAcquireDurationsMs.length
        : 0
    };
  }
}

export { shutdownSandboxRuntime };