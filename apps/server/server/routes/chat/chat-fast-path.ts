import {
  appendOrchestrationTrace,
  appendSessionMessage,
  listSessionMessages,
  setSessionStatus,
  updateSessionMessage
} from "../../state/session.js";
import { broadcastEvent, broadcastThought } from "../../ws/streaming.js";
import { buildAgentActivity } from "./agent-activity.js";
import { buildAssistantMessageMeta } from "./turn-execution-helpers.js";
import { buildTurnLifecyclePayload, buildTurnResultSummary } from "./turn-summary.js";
import { resolveChatTurn } from "../../pipeline/index.js";

export type ChatFastPathParams = {
  sessionId: string;
  content: string;
  sessionState: any;
  effectivePreferences: Record<string, unknown>;
  assistantMessageId: string;
  turnRequestId: string;
  userMessage: unknown;
};

/**
 * Lightweight turn executor for conversational messages (chat, explain, clarify).
 *
 * Skips the full 7-stage pipeline (planTasks, thinking analysis, orchestration broadcasts)
 * and calls resolveChatTurn directly, which handles streaming via onAssistantChunk.
 */
export async function executeChatFastPath(params: ChatFastPathParams) {
  const {
    sessionId,
    content,
    sessionState,
    effectivePreferences,
    assistantMessageId,
    turnRequestId,
    userMessage
  } = params;

  const thoughtContextBase = { requestId: turnRequestId, messageId: assistantMessageId };

  // Signal turn start — but no pipeline plan or orchestration steps.
  broadcastEvent("turn:started", { sessionId, content, mode: "chat" });
  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "chat_reply",
    status: "running",
    payload: { content }
  }));

  await broadcastThought(sessionId, "turn_started", {
    ...thoughtContextBase,
    query: content,
    llmThoughts: null
  });

  setSessionStatus(sessionId, "parsing");

  let assistantContent = "";

  const turn = await resolveChatTurn(
    { query: content, sessionId, preferences: effectivePreferences },
    sessionState,
    {
      onAssistantChunk: async (_: unknown, runningText: string) => {
        assistantContent = runningText;
        const streamedMessage = updateSessionMessage(sessionId, assistantMessageId, {
          content: assistantContent,
          kind: "streaming"
        });
        if (streamedMessage) {
          broadcastEvent("message:update", { sessionId, message: streamedMessage });
        }
      }
    }
  );

  // Finalize the assistant message.
  const assistantMessage = updateSessionMessage(sessionId, assistantMessageId, {
    content: turn.assistantText,
    kind: turn.mode,
    error: null,
    meta: buildAssistantMessageMeta(turnRequestId, turn, null)
  }) ?? appendSessionMessage(sessionId, {
    id: assistantMessageId,
    role: "assistant",
    content: turn.assistantText,
    kind: turn.mode,
    error: null,
    meta: buildAssistantMessageMeta(turnRequestId, turn, null)
  });

  broadcastEvent("message.append", { sessionId, message: assistantMessage });

  const turnSummary = buildTurnResultSummary(turn.mode, null, sessionState, {
    assistantSource: turn.assistantSource ?? null,
    assistantWarning: turn.assistantWarning ?? null,
    assistantLlm: turn.assistantLlm ?? null
  });

  await broadcastThought(sessionId, "turn_complete", {
    ...thoughtContextBase,
    query: content,
    llmThoughts: null
  });

  appendOrchestrationTrace(sessionId, {
    step: "turn_complete",
    payload: {
      sessionId,
      mode: turn.mode,
      messageCount: listSessionMessages(sessionId).length
    }
  });

  setSessionStatus(sessionId, "idle");

  broadcastEvent("turn:complete", {
    sessionId,
    requestId: turnRequestId,
    mode: turn.mode,
    messageCount: listSessionMessages(sessionId).length,
    ...buildTurnLifecyclePayload(turnSummary)
  });

  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "turn_complete",
    status: "completed"
  }));

  return {
    sessionId,
    mode: turn.mode,
    intent: turn.parsedIntent,
    assistantSource: turn.assistantSource ?? null,
    assistantWarning: turn.assistantWarning ?? null,
    assistantLlm: turn.assistantLlm ?? null,
    userMessage,
    assistantMessage,
    sceneState: sessionState,
    messages: listSessionMessages(sessionId),
    result: null,
    turnSummary,
    stepDurationsMs: {}
  };
}
