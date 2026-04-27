import { createSession, createSessionMessageId, updateSessionMessage } from "../../state/session.js";
import {
  generateThinkingAnalysis, planTasks, generateFromImage, generatePostTurnNarration, resolveChatTurn
} from "../../pipeline/index.js";
import { handleTurnExecutionError } from "./turn-execution-helpers.js";
import { bootstrapTurnState, runThinkingAndPlanningBootstrap } from "./turn-bootstrap.js";
import { executeImageTurnPath } from "./image-turn-path.js";
import { executeStandardTurnPath } from "./standard-turn-path.js";
import { runWithTraceContext } from "../../trace/context.js";

const fastModeEnabled = process.env.FAST_MODE !== "false" && process.env.FAST_MODE !== "0";
const asyncThinkingEnabled = process.env.ENABLE_ASYNC_THINKING !== "false" && process.env.ENABLE_ASYNC_THINKING !== "0";
const postTurnNarrationEnabled = process.env.ENABLE_POST_TURN_NARRATION !== "false" && process.env.ENABLE_POST_TURN_NARRATION !== "0";

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
    { sessionId, content, userMessageId, asyncThinkingEnabled },
    sessionState,
    generateThinkingAnalysis
  );
  const turnRequestId = options.requestId ?? `${sessionId}:${assistantMessageId}`;
  updateSessionMessage(sessionId, assistantMessageId, {
    meta: [`requestId:${turnRequestId}`]
  });

  return await runWithTraceContext(
    { requestId: turnRequestId, sessionId, messageId: assistantMessageId },
    async () => {
      try {
        const { plan, llmThoughts, thoughtContextBase } = await runThinkingAndPlanningBootstrap({
          sessionId,
          content,
          turnRequestId,
          assistantMessageId,
          sessionState,
          planTasks,
          effectivePreferences,
          asyncThinkingEnabled,
          generateThinkingAnalysis,
          userMessageId
        });

        if (hasImage) {
          return executeImageTurnPath({
            sessionId,
            content,
            imageUrl,
            imageData,
            thoughtContextBase,
            llmThoughts,
            effectivePreferences,
            assistantMessageId,
            turnRequestId,
            optionsRequestId: options.requestId,
            userMessage,
            generateFromImage
          });
        }

        return executeStandardTurnPath({
          sessionId,
          content,
          plan,
          effectivePreferences,
          sessionState,
          assistantMessageId,
          turnRequestId,
          thoughtContextBase,
          llmThoughts,
          userMessage,
          resolveChatTurn,
          generatePostTurnNarration,
          postTurnNarrationEnabled,
          fastModeEnabled
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
