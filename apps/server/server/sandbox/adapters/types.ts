/**
 * Skill Adapter — Executes skill-specific code inside an acquired sandbox.
 *
 * Each adapter knows how to prepare and execute code for a specific
 * runtime kind (JavaScript scene, Python/Manim, etc.).
 */

export interface SandboxWorkspace {
  fs: {
    uploadFile(buffer: Buffer, path: string): Promise<void>;
    downloadFile(path: string): Promise<Buffer | Uint8Array>;
  };
  process: {
    executeCommand(command: string): Promise<any>;
  };
}

export interface ExecutionContext {
  /** The sandbox workspace object (Daytona SDK style) */
  workspace: SandboxWorkspace;
  /** Executes a JSON payload via the sandbox runner script */
  execute(payload: string): Promise<any>;
}

export interface AdapterPrepareOptions {
  skillId: string;
  tools?: string[];
}

export interface AdapterExecuteOptions {
  timeoutMs: number;
  maxFrames?: number;
  sessionId?: string | null;
}

export interface AdapterExecutionResult {
  success: boolean;
  status: "completed" | "error" | "degraded";
  previewUrl?: string | null;
  outputKind?: string;
  mediaType?: string | null;
  mediaUrl?: string | null;
  mediaArtifactId?: string | null;
  error?: string | null;
  errorCode?: string | null;
  renderCount?: number;
  frameCount?: number;
  durationMs?: number;
  logs?: string[];
}

export interface SkillAdapter {
  readonly kind: string;

  /** Execute code inside the sandbox. All adapter-specific logic lives here. */
  execute(
    context: ExecutionContext,
    code: string | { files: any[]; entryPoint: string },
    options: AdapterExecuteOptions
  ): Promise<AdapterExecutionResult>;
}