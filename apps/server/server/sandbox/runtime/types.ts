/**
 * Skill Runtime — Abstraction layer over sandbox backends (Docker, Daytona, etc.)
 *
 * Provides a uniform interface so the quality loop and pipeline nodes
 * can execute code without caring which sandbox provider is active.
 */

export interface SandboxHandle {
  id: string;
  kind: "docker" | "daytona";
  // Opaque backend-specific data
  _backend: any;
}

export interface AcquireRequest {
  sessionId: string;
  skillId: string;
  tools?: string[];
  timeoutMs?: number;
  keepAlive?: boolean;
  turnDeadlineAtMs?: number | null;
}

export interface ExecutionPayload {
  code: string | Record<string, string> | { files: any[]; entryPoint: string };
  skillId: string;
  timeoutMs?: number;
  maxFrames?: number;
  sessionId?: string | null;
}

export interface RuntimeExecutionResult {
  success: boolean;
  status: "completed" | "error" | "degraded";
  previewUrl?: string | null;
  outputKind?: string;
  mediaType?: string | null;
  mediaUrl?: string | null;
  mediaArtifactId?: string | null;
  mediaDurationMs?: number | null;
  mediaFps?: number | null;
  mediaResolution?: string | null;
  mediaBytes?: number | null;
  error?: string | null;
  errorCode?: string | null;
  durationMs?: number;
  renderCount?: number;
  frameCount?: number;
  logs?: string[];
  summary?: { childCount: number; types: string[] };
  warning?: string | null;
  warningCode?: string | null;
  buildArtifacts?: any;
  acquireDiagnostics?: any;
  _source?: string;
}

export interface HealthStatus {
  healthy: boolean;
  provider: string;
  details?: any;
}

export interface RuntimeMetrics {
  provider: string;
  acquireAttempts?: number;
  acquireSuccess?: number;
  acquireFailures?: number;
  averageAcquireMs?: number;
  activeHandles?: number;
}

export interface SkillRuntime {
  readonly provider: string;

  acquire(request: AcquireRequest): Promise<SandboxHandle>;
  execute(handle: SandboxHandle, payload: ExecutionPayload): Promise<RuntimeExecutionResult>;
  release(handle: SandboxHandle): Promise<void>;
  prewarm(skillId: string): void;
  health(): Promise<HealthStatus>;
  metrics(): RuntimeMetrics;
}

export interface QualityLoopConfig {
  maxIterations: number;
  qualityThreshold: number;
  enableAutoPatch: boolean;
  timeoutPerIterationMs: number;
  mode?: string;
}

export interface QualityLoopRequest {
  sessionId: string;
  code: string | any;
  skillId: string;
  prompt: string;
  tools?: string[];
  config?: Partial<QualityLoopConfig>;
  workspace?: any;
}

export interface IterationResult {
  iterationNumber: number;
  code: string;
  quality: any;
  score: number;
  patchGoals: any[];
  durationMs: number;
}

export interface QualityLoopResult {
  success: boolean;
  sessionId: string;
  finalIteration: number;
  finalScore?: number;
  stopReason: string;
  iterations: IterationResult[];
  prePatchedCode?: string;
  workspace?: any;
  previewUrl?: string | null;
  outputKind?: string;
  mediaUrl?: string | null;
  error?: string;
  qualityReport?: any;
}