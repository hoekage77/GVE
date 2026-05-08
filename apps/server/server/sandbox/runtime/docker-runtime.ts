/**
 * DockerSkillRuntime — Local Docker sandbox adapter implementing SkillRuntime.
 *
 * Wraps the legacy manager.ts functions (createSandbox, executeInSandbox,
 * cleanupSessionSandbox) into the uniform SkillRuntime interface.
 */

import {
  createSandbox,
  executeInSandbox,
  cleanupSessionSandbox,
  getSandboxMetrics,
  healthCheck as dockerHealthCheck
} from "../manager.js";

import type {
  SkillRuntime,
  SandboxHandle,
  AcquireRequest,
  ExecutionPayload,
  RuntimeExecutionResult,
  HealthStatus,
  RuntimeMetrics
} from "./types.js";

export class DockerSkillRuntime implements SkillRuntime {
  readonly provider = "docker-local";

  private activeHandles = new Map<string, SandboxHandle>();

  async acquire(request: AcquireRequest): Promise<SandboxHandle> {
    const containerInfo = await createSandbox({
      sessionId: request.sessionId,
      tools: request.tools ?? [],
      timeoutMs: request.timeoutMs,
      keepAlive: request.keepAlive ?? true
    });

    const handle: SandboxHandle = {
      id: containerInfo.containerId,
      kind: "docker",
      _backend: containerInfo
    };

    this.activeHandles.set(handle.id, handle);
    return handle;
  }

  async execute(handle: SandboxHandle, payload: ExecutionPayload): Promise<RuntimeExecutionResult> {
    const containerInfo = handle._backend;
    const isString = typeof payload.code === "string";
    const rawResult = await executeInSandbox({
      sessionId: payload.sessionId ?? containerInfo.sessionId,
      code: isString ? (payload.code as string) : "",
      skill: payload.skillId,
      timeoutMs: payload.timeoutMs,
      files: isString ? undefined : (payload.code as Record<string, string>)
    });

    return {
      success: rawResult.success,
      status: rawResult.success ? "completed" : "error",
      previewUrl: rawResult.success ? undefined : null,
      outputKind: "code",
      mediaType: null,
      mediaUrl: null,
      error: rawResult.error ?? null,
      durationMs: rawResult.durationMs ?? 0,
      renderCount: rawResult.success ? 1 : 0,
      frameCount: 0,
      logs: rawResult.logs ?? [],
      summary: { childCount: 0, types: [] },
      _source: "docker-local"
    };
  }

  async release(handle: SandboxHandle): Promise<void> {
    const containerInfo = handle._backend;
    await cleanupSessionSandbox(containerInfo.sessionId);
    this.activeHandles.delete(handle.id);
  }

  prewarm(_skillId: string): void {
    // Local Docker has no prewarm capability
  }

  async health(): Promise<HealthStatus> {
    const status = await dockerHealthCheck();
    return {
      healthy: status.dockerAvailable,
      provider: this.provider,
      details: status
    };
  }

  metrics(): RuntimeMetrics {
    return {
      provider: this.provider,
      activeHandles: this.activeHandles.size
    };
  }
}