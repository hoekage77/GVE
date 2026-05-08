/**
 * ClientRenderingRuntime — SkillRuntime implementation that skips backend sandbox
 * for JavaScript skills and defers real execution/validation to the browser.
 *
 * For JS skills (threejs, p5js, d3js, animejs), the browser already renders
 * generated code in an iframe with real WebGL/Canvas libraries. Running the
 * same code through a Node.js VM that mocks browser APIs is slower and less
 * accurate. This runtime returns an optimistic result immediately, letting the
 * browser do the real validation and report back asynchronously.
 *
 * For non-JS skills (e.g., manim), this runtime throws — use Daytona/Docker instead.
 */

import type {
  SkillRuntime,
  SandboxHandle,
  AcquireRequest,
  ExecutionPayload,
  RuntimeExecutionResult,
  HealthStatus,
  RuntimeMetrics
} from "./types.js";

import {
  getLatestClientValidationResult,
  hasClientValidationFailed
} from "./client-validation-cache.js";

const JS_SKILL_IDS = new Set(["threejs", "p5js", "p5.js", "d3js", "d3", "animejs", "anime.js"]);

function isJsSkill(skillId: string): boolean {
  return JS_SKILL_IDS.has(skillId);
}

export class ClientRenderingRuntime implements SkillRuntime {
  readonly provider = "client-rendering";

  private activeHandles = new Map<string, SandboxHandle>();
  private handleCounter = 0;

  async acquire(request: AcquireRequest): Promise<SandboxHandle> {
    if (!isJsSkill(request.skillId)) {
      throw new Error(
        `ClientRenderingRuntime does not support skill '${request.skillId}'. ` +
        `Use DaytonaSkillRuntime or DockerSkillRuntime instead.`
      );
    }

    const handle: SandboxHandle = {
      id: `client-${request.sessionId}-${++this.handleCounter}`,
      kind: "docker", // Reuse docker kind so downstream code doesn't need to know
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
    const skillId = payload.skillId ?? ctx.skillId;
    const sessionId = payload.sessionId ?? ctx.sessionId;

    if (!isJsSkill(skillId)) {
      throw new Error(
        `ClientRenderingRuntime.execute() called with unsupported skill '${skillId}'.`
      );
    }

    // Check if we already have a failed client validation for this session
    const priorFailed = sessionId ? hasClientValidationFailed(sessionId, skillId) : false;
    const priorResult = sessionId ? getLatestClientValidationResult(sessionId, skillId) : null;

    const startedAt = Date.now();

    // Return optimistic result — the browser will do real rendering
    // If a prior validation failed, we propagate that as a warning
    return {
      success: !priorFailed,
      status: priorFailed ? "error" : "completed",
      previewUrl: null, // Browser constructs its own preview
      outputKind: "code",
      mediaType: null,
      mediaUrl: null,
      error: priorFailed ? (priorResult?.error ?? "Previous client-side validation failed") : null,
      errorCode: priorFailed ? "CLIENT_VALIDATION_FAILED" : null,
      durationMs: 0, // No backend execution time
      renderCount: priorResult?.renderCount ?? 0,
      frameCount: priorResult?.frameCount ?? 0,
      logs: priorResult?.logs.map((l) => `[${l.level}] ${l.message}`) ?? [],
      summary: priorResult?.summary ?? { childCount: 0, types: [] },
      warning: priorFailed
        ? `Client rendering previously failed for ${skillId}: ${priorResult?.error ?? "unknown error"}`
        : "Execution deferred to client browser (edge rendering).",
      warningCode: priorFailed ? "CLIENT_RENDERING_PRIOR_FAILURE" : "CLIENT_RENDERING_ENABLED",
      _source: "client-rendering"
    };
  }

  async release(handle: SandboxHandle): Promise<void> {
    this.activeHandles.delete(handle.id);
  }

  prewarm(skillId: string): void {
    // No-op: client rendering has no backend sandbox to warm
    if (isJsSkill(skillId)) {
      console.log(`[ClientRenderingRuntime] Prewarm requested for ${skillId} — no-op (browser-side).`);
    }
  }

  async health(): Promise<HealthStatus> {
    return {
      healthy: true,
      provider: this.provider,
      details: { activeHandles: this.activeHandles.size }
    };
  }

  metrics(): RuntimeMetrics {
    return {
      provider: this.provider,
      activeHandles: this.activeHandles.size
    };
  }
}