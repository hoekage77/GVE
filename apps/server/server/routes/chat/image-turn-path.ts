// @ts-nocheck
import {
  appendSessionMessage,
  buildSceneUpdatePayload,
  listSessionMessages,
  recordSceneVersion,
  setSessionStatus,
  updateSessionMessage
} from "../../session-state.js";
import { broadcastEvent, broadcastThought } from "../../ws/streaming.js";
import { buildTurnLifecyclePayload, buildTurnResultSummary } from "./turn-summary.js";

export async function executeImageTurnPath(params: {
  sessionId: string;
  content: string;
  imageUrl: string | null;
  imageData: string | null;
  thoughtContextBase: Record<string, unknown>;
  llmThoughts: unknown;
  effectivePreferences: Record<string, unknown>;
  assistantMessageId: string;
  turnRequestId: string;
  optionsRequestId: string | null | undefined;
  userMessage: unknown;
  generateFromImage: (input: Record<string, unknown>) => Promise<any>;
}) {
  const {
    sessionId,
    content,
    imageUrl,
    imageData,
    thoughtContextBase,
    llmThoughts,
    effectivePreferences,
    assistantMessageId,
    turnRequestId,
    optionsRequestId,
    userMessage,
    generateFromImage
  } = params;

  const resolvedImageUrl = imageUrl || (imageData ? `data:image/png;base64,${imageData}` : null);

  await broadcastThought(sessionId, "image_analyzing", {
    ...thoughtContextBase,
    query: content,
    llmThoughts
  });

  const imageResult = await generateFromImage({
    imageUrl: resolvedImageUrl,
    query: content,
    sessionId,
    preferences: effectivePreferences
  });

  await broadcastThought(sessionId, "image_generating", {
    ...thoughtContextBase,
    query: content,
    skill: imageResult.skill,
    llmThoughts
  });

  const nextSessionState = recordSceneVersion(sessionId, {
    sceneId: imageResult.sceneId,
    code: imageResult.code,
    previewUrl: imageResult.previewUrl,
    skill: imageResult.skill,
    outputKind: imageResult.outputKind ?? imageResult.runtime?.outputKind ?? null,
    mediaType: imageResult.mediaType ?? imageResult.runtime?.mediaType ?? null,
    mediaUrl: imageResult.mediaUrl ?? imageResult.runtime?.mediaUrl ?? null,
    mediaArtifactId: imageResult.mediaArtifactId ?? imageResult.runtime?.mediaArtifactId ?? null,
    mediaDurationMs: imageResult.mediaDurationMs ?? imageResult.runtime?.mediaDurationMs ?? null,
    mediaFps: imageResult.mediaFps ?? imageResult.runtime?.mediaFps ?? null,
    mediaResolution: imageResult.mediaResolution ?? imageResult.runtime?.mediaResolution ?? null,
    mediaBytes: imageResult.mediaBytes ?? imageResult.runtime?.mediaBytes ?? null,
    assetPlan: imageResult.assetPlan ?? null,
    explanation: imageResult.explanation,
    source: "image-to-code",
    messageId: assistantMessageId
  });

  const assistantMessage = updateSessionMessage(sessionId, assistantMessageId, {
    content: imageResult.explanation,
    kind: "generate",
    meta: [`requestId:${turnRequestId}`, `scene:${imageResult.sceneId}`, `skill:${imageResult.skill}`, "source:image"]
  }) ?? appendSessionMessage(sessionId, {
    id: assistantMessageId,
    role: "assistant",
    content: imageResult.explanation,
    kind: "generate",
    meta: [`requestId:${turnRequestId}`, `scene:${imageResult.sceneId}`, `skill:${imageResult.skill}`, "source:image"]
  });

  broadcastEvent("generation:complete", {
    sessionId,
    sceneId: imageResult.sceneId,
    previewUrl: imageResult.previewUrl,
    outputKind: imageResult.outputKind ?? imageResult.runtime?.outputKind ?? null,
    mediaType: imageResult.mediaType ?? imageResult.runtime?.mediaType ?? null,
    mediaUrl: imageResult.mediaUrl ?? imageResult.runtime?.mediaUrl ?? null,
    mediaArtifactId: imageResult.mediaArtifactId ?? imageResult.runtime?.mediaArtifactId ?? null,
    mediaDurationMs: imageResult.mediaDurationMs ?? imageResult.runtime?.mediaDurationMs ?? null,
    mediaFps: imageResult.mediaFps ?? imageResult.runtime?.mediaFps ?? null,
    mediaResolution: imageResult.mediaResolution ?? imageResult.runtime?.mediaResolution ?? null,
    mediaBytes: imageResult.mediaBytes ?? imageResult.runtime?.mediaBytes ?? null,
    skill: imageResult.skill,
    sceneVersion: nextSessionState.currentScene?.version ?? 0,
    mode: "image-to-code"
  });
  broadcastEvent("scene:update", buildSceneUpdatePayload(nextSessionState));
  broadcastEvent("message.append", { sessionId, message: assistantMessage });

  await broadcastThought(sessionId, "turn_complete", { ...thoughtContextBase, query: content, llmThoughts });
  const turnSummary = buildTurnResultSummary("image-to-code", imageResult, nextSessionState);
  broadcastEvent("turn:complete", {
    sessionId,
    requestId: optionsRequestId ?? null,
    mode: "image-to-code",
    messageCount: listSessionMessages(sessionId).length,
    ...buildTurnLifecyclePayload(turnSummary)
  });

  setSessionStatus(sessionId, "idle");
  return {
    sessionId,
    mode: "image-to-code",
    userMessage,
    assistantMessage,
    sceneState: nextSessionState,
    messages: listSessionMessages(sessionId),
    result: imageResult,
    turnSummary
  };
}
