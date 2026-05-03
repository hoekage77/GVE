import { MEDIA_READY_TEXT, MEDIA_SYNCING_TEXT, MEDIA_UNAVAILABLE_TEXT } from "./media-strings";

export interface ResolvedMediaState {
  outputKind: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  mediaExpected: boolean;
  mediaReady: boolean;
  runtimeStatus: string | null;
  runtimeWarning: string;
  generationWarning: string;
}

export function resolveMediaState(payload: Record<string, unknown>): ResolvedMediaState {
  const outputKind = typeof payload.outputKind === "string" ? payload.outputKind : null;
  const mediaType = typeof payload.mediaType === "string" ? payload.mediaType : null;
  const mediaUrl = typeof payload.mediaUrl === "string" ? payload.mediaUrl : null;
  const mediaExpected = outputKind === "media" || (typeof mediaType === "string" && mediaType.startsWith("video/"));
  const mediaReady = Boolean(mediaUrl && mediaUrl !== "about:blank");

  const runtimeStatus = typeof payload.runtimeStatus === "string" ? payload.runtimeStatus : null;
  const runtimeWarning = typeof payload.runtimeWarning === "string" ? payload.runtimeWarning.trim() : "";
  const generationWarning = typeof payload.generationWarning === "string" ? payload.generationWarning.trim() : "";

  return { outputKind, mediaType, mediaUrl, mediaExpected, mediaReady, runtimeStatus, runtimeWarning, generationWarning };
}

export function mediaUnavailable(m: ResolvedMediaState): boolean {
  return (
    m.mediaExpected &&
    !m.mediaReady &&
    (["degraded", "skipped", "error"].includes(m.runtimeStatus!) || m.runtimeWarning.length > 0 || m.generationWarning.length > 0)
  );
}

export function computeMediaStage(
  m: ResolvedMediaState,
  currentStage: string | undefined,
  turnStatus: string | undefined
): string {
  if (!m.mediaExpected) return currentStage ?? "idle";
  if (m.mediaReady) return "ready";
  if (mediaUnavailable(m)) return "error";
  if (turnStatus === "running") return "syncing";
  return "error";
}

export function computeMediaStatusText(
  m: ResolvedMediaState,
  currentText: string | undefined | null,
  turnStatus: string | undefined
): string | null {
  if (!m.mediaExpected) return currentText ?? null;
  if (m.mediaReady) return MEDIA_READY_TEXT;
  if (mediaUnavailable(m)) return m.runtimeWarning || m.generationWarning || MEDIA_UNAVAILABLE_TEXT;
  if (turnStatus === "running") return MEDIA_SYNCING_TEXT;
  return MEDIA_UNAVAILABLE_TEXT;
}

export interface TurnErrorState {
  message: string;
  requestId?: string | null;
  sessionId: string | null;
}

export function buildTurnErrorTaskUpdate(message: string) {
  return {
    isSending: false,
    activeRequestId: null,
    thinkingText: null,
    thinkingStep: "turn_error" as const,
    tasksUpdate: (currentStep: string | undefined) => ({
      tasks: "applyStepStatus" as const,
      targetStep: "turn_error",
      targetStatus: "failed" as const,
    }),
    taskProgressUpdate: {
      currentStep: "turn_error",
      currentStepStatus: "failed" as const,
      turnStatus: "failed" as const,
      activeRequestId: null,
      liveThought: { text: message, step: "turn_error" as const },
      mediaStage: "preserve_ready_or_error" as const,
      mediaStatusText: message,
    },
  };
}