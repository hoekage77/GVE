import { appendOrchestrationTrace, appendSessionMessage, createSessionMessageId, setSessionStatus } from "../../state/session.js";
import { broadcastEvent, broadcastThought } from "../../ws/streaming.js";
import { buildAgentActivity } from "./agent-activity.js";
import { extractErrorDiagnostics } from "./error-normalization.js";

type BootstrapParams = {
  sessionId: string;
  content: string;
  userMessageId: string;
  asyncThinkingEnabled: boolean;
};

type ThinkingAnalysisFn = (
  content: string,
  sessionState: unknown,
  options: { onError: (diagnostics: unknown) => void }
) => Promise<unknown>;

export async function bootstrapTurnState(
  params: BootstrapParams,
  _sessionState: unknown,
  _generateThinkingAnalysis: ThinkingAnalysisFn
) {
  const { sessionId, content, userMessageId, asyncThinkingEnabled } = params;
  const userMessage = appendSessionMessage(sessionId, {
    id: userMessageId,
    role: "user",
    content,
    kind: "input"
  });

  broadcastEvent("message:created", { sessionId, message: userMessage });
  broadcastEvent("message.append", { sessionId, message: userMessage });

  const assistantMessageId = createSessionMessageId(sessionId);
  const assistantPlaceholder = appendSessionMessage(sessionId, {
    id: assistantMessageId,
    role: "assistant",
    content: "",
    kind: "streaming",
    meta: []
  });
  broadcastEvent("message:created", { sessionId, message: assistantPlaceholder });
  const thoughtContextBase = { messageId: assistantMessageId };

  return { userMessage, assistantMessageId, thoughtContextBase };
}

export async function runThinkingAndPlanningBootstrap(params: {
  sessionId: string;
  content: string;
  turnRequestId: string;
  assistantMessageId: string;
  sessionState: unknown;
  planTasks: (input: { query: string; preferences: Record<string, unknown> }) => Promise<any>;
  effectivePreferences: Record<string, unknown>;
  asyncThinkingEnabled: boolean;
  generateThinkingAnalysis: ThinkingAnalysisFn;
  userMessageId: string;
}) {
  const {
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
  } = params;

  let llmThoughts: unknown = null;
  const thoughtContextBase = { requestId: turnRequestId, messageId: assistantMessageId };

  broadcastEvent("turn:started", { sessionId, content });
  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "parse_intent",
    status: "running"
  }));

  try {
    const analysis = await generateThinkingAnalysis(content, sessionState, {
      onError: (diagnostics) => {
        appendOrchestrationTrace(sessionId, {
          step: "thinking_analysis_failed",
          payload: { sessionId, requestId: turnRequestId, diagnostics }
        });
        broadcastEvent("thinking:analysis_failed", {
          sessionId,
          requestId: turnRequestId,
          messageId: assistantMessageId,
          error: diagnostics
        });
      }
    });
    if (analysis) llmThoughts = analysis;
  } catch (error) {
    const diagnostics = extractErrorDiagnostics(error, {
      stage: "thinking_analysis",
      requestId: turnRequestId,
      sessionId,
      messageId: assistantMessageId
    });
    appendOrchestrationTrace(sessionId, {
      step: "thinking_analysis_failed",
      payload: { sessionId, requestId: turnRequestId, diagnostics }
    });
    broadcastEvent("thinking:analysis_failed", {
      sessionId,
      requestId: turnRequestId,
      messageId: assistantMessageId,
      error: diagnostics
    });
  }

  await broadcastThought(sessionId, "turn_started", { ...thoughtContextBase, query: content, llmThoughts });

  appendOrchestrationTrace(sessionId, { step: "intent_parsed", payload: { sessionId, content } });
  setSessionStatus(sessionId, "parsing");
  broadcastEvent("orchestration:step", {
    requestId: `${sessionId}:${userMessageId}`,
    step: "intent_parsed",
    status: "running",
    payload: { sessionId, content }
  });
  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "intent_parsed",
    status: "completed",
    payload: { content }
  }));

  const plan = await planTasks({ query: content, preferences: effectivePreferences });
  return { plan, llmThoughts, thoughtContextBase };
}
