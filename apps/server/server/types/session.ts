/**
 * Session domain types — the source of truth for session/artifact/version shapes.
 */

export interface SceneVersion {
  versionId: string;
  version: number;
  artifactId: string;
  artifactVersion: number;
  source: "generate" | "modify" | "image-to-code" | "fallback";
  sceneId: string;
  code: string | null;
  previewUrl: string | null;
  skill: string | null;
  outputKind: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  artifactId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revisions: SceneVersion[];
  revisionPointer: number;
}

export type SessionStatus = "idle" | "generating" | "modifying" | "error";

export interface SessionMessage {
  messageId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface TraceEntry {
  step: string;
  detail?: string;
  timestamp: string;
  duration?: number;
}

export interface SessionState {
  sessionId: string;
  status: SessionStatus;
  artifacts: Artifact[];
  artifactPointer: number;
  currentScene: SceneVersion | null;
  messages: SessionMessage[];
  orchestrationTrace: TraceEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionResponse {
  session: SessionState;
  websocketUrl: string;
}

export interface SceneUpdatePayload {
  type: "scene_update";
  sessionId: string;
  scene: SceneVersion | null;
  versions: SceneVersion[];
  currentVersionIndex: number;
}

export interface CodeUpdatePayload {
  type: "code_update";
  sessionId: string;
  code: string | null;
  skill: string | null;
  outputKind: string | null;
}
