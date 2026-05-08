import { appendSessionMessage, createSessionMessageId } from "../../state/session.js";
import { broadcastEvent } from "../../ws/streaming.js";

type BootstrapParams = {
  sessionId: string;
  content: string;
  userMessageId: string;
  asyncThinkingEnabled: boolean;
};

export async function bootstrapTurnState(
  params: BootstrapParams,
  _sessionState: unknown,
  _generateThinkingAnalysis: unknown
) {
  const { sessionId, content, userMessageId } = params;
  const userMessage = await appendSessionMessage(sessionId, {
    id: userMessageId,
    role: "user",
    content,
    kind: "input"
  });

  broadcastEvent("message:append", { sessionId, message: userMessage });

  const assistantMessageId = createSessionMessageId(sessionId);
  const assistantPlaceholder = await appendSessionMessage(sessionId, {
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
