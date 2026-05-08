import { createSession, createSessionMessageId, updateSessionMessage } from "../../state/session.js";
import { handleTurnExecutionError } from "./turn-execution-helpers.js";
import { bootstrapTurnState } from "./turn-bootstrap.js";
import { executeAgentTurnPath } from "./agent-turn-path.js";
import { runWithTraceContext } from "../../trace/context.js";

export type RequestedTurnMode = "modify" | "generate" | null;
export type ChatTurnOptions = {
  clientMessageId?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  imageUrl?: string | null;
  imageData?: string | null;
  forcedMode?: RequestedTurnMode | string;
  transport?: "rest" | "ws" | string;
};

export function normalizeRequestedTurnMode(rawMode: unknown): RequestedTurnMode {
  const normalized = String(rawMode ?? "").trim().toLowerCase();
  if (normalized === "modify" || normalized === "generate") return normalized;
  return null;
}

export function normalizeTurnPreferences(
  preferences: unknown,
  forcedMode: Exclude<RequestedTurnMode, null> | null = null
): Record<string, unknown> {
  const basePreferences: Record<string, unknown> =
    preferences && typeof preferences === "object" && !Array.isArray(preferences)
      ? (preferences as Record<string, unknown>)
      : {};
  if (!forcedMode) return basePreferences;
  return { ...basePreferences, mode: forcedMode };
}

export async function executeChatTurn(
  sessionId: string,
  content: string,
  preferences: unknown,
  options: ChatTurnOptions = {}
) {
  const sessionState = createSession(sessionId);
  const userMessageId = options.clientMessageId || createSessionMessageId(sessionId);
  const imageUrl = options.imageUrl || null;
  const imageData = options.imageData || null;
  const hasImage = Boolean(imageUrl || imageData);
  const normalizedContent = String(content ?? "").trim();
  const turnContent = normalizedContent || (hasImage ? "Generate a scene from the attached image." : "");

  if (!turnContent && !hasImage) {
    throw new Error("Message content or image is required.");
  }

  content = turnContent;
  const effectivePreferences = normalizeTurnPreferences(preferences, normalizeRequestedTurnMode(options.forcedMode));

  const { userMessage, assistantMessageId } = await bootstrapTurnState(
    { sessionId, content, userMessageId, asyncThinkingEnabled: false },
    sessionState,
    async () => null as any
  );
  const turnRequestId = options.requestId ?? `${sessionId}:${assistantMessageId}`;
  await updateSessionMessage(sessionId, assistantMessageId, {
    meta: [`requestId:${turnRequestId}`]
  });

  console.log(`[Turn] [TRACE] Agent mode — routing to tool coordinator for session=${sessionId}`);

  return await runWithTraceContext(
    { requestId: turnRequestId, sessionId, messageId: assistantMessageId },
    async () => {
      try {
        return executeAgentTurnPath({
          sessionId,
          content,
          imageUrl,
          imageData,
          sessionState,
          effectivePreferences,
          assistantMessageId,
          turnRequestId,
          userMessage
        });
      } catch (error) {
        handleTurnExecutionError({
          error,
          sessionId,
          turnRequestId,
          assistantMessageId,
          stepDurationsMs: {}
        });
        throw error;
      }
    }
  );
}
