import { createSession, createSessionMessageId, updateSessionMessage } from "../../state/session.js";
import {
  generateThinkingAnalysis, planTasks, generateFromImage, generatePostTurnNarration, resolveChatTurn
} from "../../pipeline/index.js";
import { parseIntentFromQuery, applySessionAwareIntentOverrides } from "../../pipeline/intent-classifier.js";
import { handleTurnExecutionError } from "./turn-execution-helpers.js";
import { bootstrapTurnState, runThinkingAndPlanningBootstrap } from "./turn-bootstrap.js";
import { executeImageTurnPath } from "./image-turn-path.js";
import { executeStandardTurnPath } from "./standard-turn-path.js";
import { executeChatFastPath } from "./chat-fast-path.js";
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

  // Intent-based provider routing: DeepSeek V4 Pro for explanations, Kimi 2.6 for code
  const earlyIntent = parseIntentFromQuery(content);
  const earlyIntentWithOverrides = applySessionAwareIntentOverrides(earlyIntent, content, sessionState);
  if (earlyIntentWithOverrides.recommendedProvider && !effectivePreferences.provider) {
    (effectivePreferences as any).provider = earlyIntentWithOverrides.recommendedProvider;
    console.log(`[Turn] [TRACE] Provider routed via intent: ${earlyIntentWithOverrides.recommendedProvider} (intent=${earlyIntentWithOverrides.intentType})`);
  }

  const { userMessage, assistantMessageId } = await bootstrapTurnState(
    { sessionId, content, userMessageId, asyncThinkingEnabled },
    sessionState,
    generateThinkingAnalysis
  );
  const turnRequestId = options.requestId ?? `${sessionId}:${assistantMessageId}`;
  updateSessionMessage(sessionId, assistantMessageId, {
    meta: [`requestId:${turnRequestId}`]
  });

  // Early intent classification: skip full pipeline for conversational turns.
  const forcedMode = String(effectivePreferences?.mode ?? "").trim().toLowerCase();
  if (!hasImage && forcedMode !== "modify" && forcedMode !== "generate") {
    const isChatMode = earlyIntentWithOverrides.intentType === "chat"
      || earlyIntentWithOverrides.intentType === "explain"
      || earlyIntentWithOverrides.ambiguous;

    if (isChatMode) {
      console.log(`[Turn] [TRACE] Chat fast-path for intent=${earlyIntentWithOverrides.intentType} session=${sessionId}`);
      return executeChatFastPath({
        sessionId,
        content,
        sessionState,
        effectivePreferences,
        assistantMessageId,
        turnRequestId,
        userMessage
      });
    }
  }

  // ── Instant Mode: skip thinking, planning, narration, debug loops ──
  const isInstant = Boolean((effectivePreferences as any)?.instant);
  if (isInstant && !hasImage) {
    console.log(`[Turn] [TRACE] Instant mode — skipping planning/bootstrap for session=${sessionId}`);
    return await runWithTraceContext(
      { requestId: turnRequestId, sessionId, messageId: assistantMessageId },
      async () => {
        try {
          return executeStandardTurnPath({
            sessionId,
            content,
            plan: { planId: "instant", tasks: [], summary: "" },
            effectivePreferences,
            sessionState,
            assistantMessageId,
            turnRequestId,
            thoughtContextBase: { query: content, sessionId, timestamp: Date.now(), llmThoughts: [], skill: (effectivePreferences as any)?.skill ?? "threejs" },
            llmThoughts: [],
            userMessage,
            resolveChatTurn,
            generatePostTurnNarration,
            postTurnNarrationEnabled: false,
            fastModeEnabled: true
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
