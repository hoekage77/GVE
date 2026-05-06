export const wsClients = new Set<any>();

import { 
  executeChatTurn, 
  executeSceneCommandMutation, 
  normalizeSceneCommand, 
  normalizeTurnPreferences, 
  normalizeRequestedTurnMode,
  buildAgentActivity,
  buildTurnLifecyclePayload 
} from "../routes/chat.js";
import { runWithTraceContext } from "../trace/context.js";
import { sendSocketPayload, sendSocketEvent, replayEventsSince, broadcastEvent, wsEventSequence } from "./streaming.js";
import { listSessionMessages } from "../state/session.js";
import { checkTokenLimit } from "../state/token-usage.js";
const completedTurnCacheSize = Number.parseInt(String(process.env.WS_COMPLETED_TURN_CACHE_SIZE ?? "300"), 10);

const activeChatTurns = new Map<string, Promise<any>>();
const completedChatTurns = new Map<string, any>();
const activeSceneCommands = new Map<string, Promise<any>>();
const completedSceneCommands = new Map<string, any>();
const abortedChatTurns = new Set<string>();

function pruneCompletedTurnCache() {
  if (completedChatTurns.size <= completedTurnCacheSize) return;
  const keys = [...completedChatTurns.keys()];
  const overflow = completedChatTurns.size - completedTurnCacheSize;
  for (let index = 0; index < overflow; index += 1) {
    const key = keys[index];
    if (key) completedChatTurns.delete(key);
  }
}

function rememberCompletedTurn(turnKey: string, payload: any) {
  if (!turnKey || !payload) return;
  completedChatTurns.set(turnKey, { ...payload, completedAt: new Date().toISOString() });
  pruneCompletedTurnCache();
}

function rememberCompletedSceneCommand(commandKey: string, payload: any) {
  if (!commandKey || !payload) return;
  completedSceneCommands.set(commandKey, { ...payload, completedAt: new Date().toISOString() });
  if (completedSceneCommands.size <= completedTurnCacheSize) return;
  const keys = [...completedSceneCommands.keys()];
  const overflow = completedSceneCommands.size - completedTurnCacheSize;
  for (let index = 0; index < overflow; index += 1) {
    const key = keys[index];
    if (key) completedSceneCommands.delete(key);
  }
}

export function setupWebSocketHandler(wsServer: any) {
  wsServer.on("connection", (socket: any) => {
  wsClients.add(socket);

  sendSocketEvent(socket, "connection:ready", {
    backend: "js",
    orchestration: "langgraph",
    latestSeq: wsEventSequence
  });

  socket.on("close", () => {
    wsClients.delete(socket);
  });

  socket.on("message", (rawMessage: any) => {
    void (async () => {
      try {
        const parsedMessage = JSON.parse(rawMessage.toString());

        if (parsedMessage?.type === "turn.abort") {
          const abortSessionId = String(parsedMessage?.payload?.sessionId ?? "").trim();
          const abortRequestId = String(parsedMessage?.payload?.requestId ?? "").trim() || null;

          if (abortRequestId && abortSessionId) {
            // Remove from active so duplicate requests can start fresh
            for (const [key, _promise] of activeChatTurns.entries()) {
              if (key.startsWith(`${abortSessionId}:`) && key.endsWith(`:${abortRequestId}`)) {
                activeChatTurns.delete(key);
                abortedChatTurns.add(key);
                break;
              }
            }
          }

          sendSocketEvent(socket, "turn:aborted", {
            sessionId: abortSessionId,
            requestId: abortRequestId
          });
          return;
        }

        if (parsedMessage?.type === "session.resume") {
          const lastSeq = Number(parsedMessage?.payload?.lastSeq ?? 0);
          const sessionId = String(parsedMessage?.payload?.sessionId ?? "").trim();
          replayEventsSince(socket, lastSeq, sessionId);
          return;
        }

        if (parsedMessage?.type === "user:approve" || parsedMessage?.type === "user:reject") {
          const { resolveApproval, rejectApproval } = await import("../pipeline/approval-store.js");
          const sessionId = String(parsedMessage?.payload?.sessionId ?? "").trim();
          const stepId = String(parsedMessage?.payload?.stepId ?? "").trim();
          const approved = parsedMessage?.type === "user:approve";

          if (!sessionId || !stepId) {
            sendSocketEvent(socket, "agent:approval_result", {
              sessionId: sessionId || null,
              stepId: stepId || null,
              approved: false,
              error: "sessionId and stepId are required"
            });
            return;
          }

          const resolved = approved
            ? resolveApproval(sessionId, stepId, true)
            : rejectApproval(sessionId, stepId, "User rejected");

          sendSocketEvent(socket, "agent:approval_result", {
            sessionId,
            stepId,
            approved,
            resolved
          });
          return;
        }

        if (parsedMessage?.type === "scene.command") {
          const sessionId = String(parsedMessage?.payload?.sessionId ?? "").trim();
          const command = normalizeSceneCommand(parsedMessage?.payload?.command);
          const requestId = String(parsedMessage?.payload?.requestId ?? "").trim();
          const idempotencyKey = String(parsedMessage?.payload?.idempotencyKey ?? requestId ?? "").trim();

          if (!sessionId || !command) {
            sendSocketEvent(socket, "scene:command_result", {
              requestId: requestId || null,
              idempotencyKey: idempotencyKey || null,
              sessionId: sessionId || null,
              command: command || null,
              success: false,
              errorCode: "VALIDATION_ERROR",
              message: "sessionId and command are required for scene.command",
              sceneState: null
            });
            return;
          }

          sendSocketEvent(socket, "scene:command_ack", {
            requestId: requestId || null,
            idempotencyKey: idempotencyKey || null,
            sessionId,
            command,
            status: "received"
          });

          const commandKey = idempotencyKey
            ? `${sessionId}:${command}:${idempotencyKey}`
            : `${sessionId}:${command}:${requestId || Date.now()}`;

          if (commandKey && completedSceneCommands.has(commandKey)) {
            const completed = completedSceneCommands.get(commandKey);

            sendSocketEvent(socket, "scene:command_ack", {
              requestId: requestId || null,
              idempotencyKey: idempotencyKey || null,
              sessionId,
              command,
              status: "duplicate"
            });

            sendSocketEvent(socket, "scene:command_result", {
              requestId: requestId || null,
              idempotencyKey: idempotencyKey || null,
              sessionId,
              command,
              success: completed?.success ?? false,
              duplicate: true,
              errorCode: completed?.errorCode ?? null,
              message: completed?.message ?? null,
              sceneState: completed?.sceneState ?? null
            });
            return;
          }

          if (activeSceneCommands.has(commandKey)) {
            sendSocketEvent(socket, "scene:command_ack", {
              requestId: requestId || null,
              idempotencyKey: idempotencyKey || null,
              sessionId,
              command,
              status: "in_progress"
            });

            const completed = await activeSceneCommands.get(commandKey);
            sendSocketEvent(socket, "scene:command_result", {
              requestId: requestId || null,
              idempotencyKey: idempotencyKey || null,
              sessionId,
              command,
              success: completed?.success ?? false,
              duplicate: true,
              errorCode: completed?.errorCode ?? null,
              message: completed?.message ?? null,
              sceneState: completed?.sceneState ?? null
            });
            return;
          }

          sendSocketEvent(socket, "scene:command_ack", {
            requestId: requestId || null,
            idempotencyKey: idempotencyKey || null,
            sessionId,
            command,
            status: "processing"
          });

          const commandPromise = (async () => {
            try {
              return executeSceneCommandMutation(sessionId, command);
            } finally {
              activeSceneCommands.delete(commandKey);
            }
          })();
          activeSceneCommands.set(commandKey, commandPromise);

          const commandResult = await commandPromise;
          rememberCompletedSceneCommand(commandKey, commandResult);

          sendSocketEvent(socket, "scene:command_ack", {
            requestId: requestId || null,
            idempotencyKey: idempotencyKey || null,
            sessionId,
            command,
            status: "accepted"
          });

          sendSocketEvent(socket, "scene:command_result", {
            requestId: requestId || null,
            idempotencyKey: idempotencyKey || null,
            sessionId,
            command,
            success: commandResult.success,
            duplicate: false,
            errorCode: commandResult.errorCode,
            message: commandResult.message,
            sceneState: commandResult.sceneState
          });
          return;
        }

        if (parsedMessage?.type !== "message.send") {
          return;
        }

        console.log(`[WS] [TRACE] Received message from ${parsedMessage?.payload?.sessionId}: "${parsedMessage?.payload?.content}"`);

        const sessionId = String(parsedMessage?.payload?.sessionId ?? "").trim();
        const content = String(parsedMessage?.payload?.content ?? parsedMessage?.payload?.query ?? "").trim();
        const imageUrl = String(parsedMessage?.payload?.imageUrl ?? "").trim();
        const imageData = String(parsedMessage?.payload?.imageData ?? "").trim();
        const hasImage = Boolean(imageUrl || imageData);
        const clientMessageId = String(parsedMessage?.payload?.clientMessageId ?? "").trim();
        const requestId = String(parsedMessage?.payload?.requestId ?? clientMessageId ?? "").trim();
        const idempotencyKey = String(parsedMessage?.payload?.idempotencyKey ?? requestId ?? clientMessageId ?? "").trim();
        const forcedMode: string | null = normalizeRequestedTurnMode(
          parsedMessage?.payload?.mode ?? parsedMessage?.payload?.preferences?.mode
        );
        const normalizedPreferences = normalizeTurnPreferences(parsedMessage?.payload?.preferences, forcedMode as any);

        if (!sessionId || (!content && !hasImage)) {
          sendSocketEvent(socket, "message:error", {
            requestId: requestId || null,
            message: "sessionId and at least one of content or image is required for message.send"
          });
          return;
        }

        sendSocketEvent(socket, "message:ack", {
          sessionId,
          requestId: requestId || null,
          clientMessageId: clientMessageId || null,
          idempotencyKey: idempotencyKey || null,
          status: "received"
        });

        const turnModeKey = forcedMode ?? "auto";
        const payloadFingerprint = content || imageUrl || imageData.slice(0, 64) || String(Date.now());
        const turnKey = idempotencyKey
          ? `${sessionId}:${turnModeKey}:${idempotencyKey}`
          : `${sessionId}:${turnModeKey}:${payloadFingerprint}`;

        if (turnKey && completedChatTurns.has(turnKey)) {
          const completed = completedChatTurns.get(turnKey);

          sendSocketEvent(socket, "message:ack", {
            sessionId,
            requestId: requestId || null,
            clientMessageId: clientMessageId || null,
            idempotencyKey: idempotencyKey || null,
            status: "duplicate"
          });

          if (completed?.assistantMessage) {
            sendSocketEvent(socket, "message.append", {
              sessionId,
              message: completed.assistantMessage
            });
          }

          sendSocketEvent(socket, "message:accepted", {
            sessionId,
            requestId: requestId || null,
            clientMessageId: clientMessageId || null,
            mode: completed?.mode ?? null,
            messageId: completed?.messageId ?? null,
            duplicate: true
          });

          sendSocketEvent(socket, "turn:complete", {
            sessionId,
            mode: completed?.mode ?? null,
            messageCount: listSessionMessages(sessionId).length,
            duplicate: true,
            requestId: requestId || null,
            ...buildTurnLifecyclePayload(completed?.turnSummary)
          });
          return;
        }

        if (activeChatTurns.has(turnKey)) {
          sendSocketEvent(socket, "message:ack", {
            sessionId,
            requestId: requestId || null,
            clientMessageId: clientMessageId || null,
            idempotencyKey: idempotencyKey || null,
            status: "in_progress"
          });

          await activeChatTurns.get(turnKey);

          const completed = completedChatTurns.get(turnKey);
          if (completed) {
            if (completed.assistantMessage) {
              sendSocketEvent(socket, "message.append", {
                sessionId,
                message: completed.assistantMessage
              });
            }

            sendSocketEvent(socket, "message:accepted", {
              sessionId,
              requestId: requestId || null,
              clientMessageId: clientMessageId || null,
              mode: completed.mode,
              messageId: completed.messageId,
              duplicate: true
            });

            sendSocketEvent(socket, "turn:complete", {
              sessionId,
              mode: completed.mode,
              messageCount: listSessionMessages(sessionId).length,
              duplicate: true,
              requestId: requestId || null,
              ...buildTurnLifecyclePayload(completed?.turnSummary)
            });
          }
          return;
        }

        sendSocketEvent(socket, "message:ack", {
          sessionId,
          requestId: requestId || null,
          clientMessageId: clientMessageId || null,
          idempotencyKey: idempotencyKey || null,
          status: "processing"
        });

        const turnPromise = (async () => {
          try {
            const userId = String(parsedMessage?.payload?.userId ?? parsedMessage?.payload?.auth?.userId ?? "").trim() || null;

            // Token limit enforcement.
            const limitCheck = checkTokenLimit(sessionId, userId);
            if (!limitCheck.allowed) {
              sendSocketEvent(socket, "token:limit_exceeded", {
                sessionId,
                requestId: requestId || null,
                scope: limitCheck.scope,
                currentUsage: limitCheck.currentUsage,
                limit: limitCheck.limit,
                remaining: 0
              });
              return;
            }

            return await runWithTraceContext(
              { sessionId, userId, requestId: requestId || null },
              () =>
                executeChatTurn(sessionId, content, normalizedPreferences, {
                  clientMessageId: clientMessageId || null,
                  requestId: requestId || null,
                  idempotencyKey: idempotencyKey || null,
                  transport: "websocket",
                  forcedMode,
                  imageUrl: imageUrl || null,
                  imageData: imageData || null
                })
            );
          } finally {
            activeChatTurns.delete(turnKey);
          }
        })();
        activeChatTurns.set(turnKey, turnPromise);

        const result = await turnPromise;

        // If the turn was aborted while running, skip completion events
        if (abortedChatTurns.has(turnKey)) {
          abortedChatTurns.delete(turnKey);
          sendSocketEvent(socket, "turn:aborted", {
            sessionId,
            requestId: requestId || null,
            reason: "client_aborted"
          });
          return;
        }
        
        if (!result) {
          // Promise returned undefined (e.g. rate limited early return)
          return;
        }

        rememberCompletedTurn(turnKey, {
          sessionId,
          mode: result.mode,
          messageId: (result.assistantMessage as any)?.messageId ?? (result.assistantMessage as any)?.id ?? null,
          assistantMessage: result.assistantMessage ?? null,
          turnSummary: result.turnSummary ?? null
        });

        sendSocketEvent(socket, "message:ack", {
          sessionId,
          requestId: requestId || null,
          clientMessageId: clientMessageId || null,
          idempotencyKey: idempotencyKey || null,
          status: "accepted"
        });

        sendSocketEvent(socket, "message:accepted", {
          sessionId,
          requestId: requestId || null,
          clientMessageId: clientMessageId || null,
          mode: result.mode,
          messageId: (result.assistantMessage as any)?.messageId ?? (result.assistantMessage as any)?.id,
          duplicate: false
        });
      } catch (error) {
        sendSocketEvent(socket, "message:error", {
          message: error instanceof Error ? error.message : "Unknown websocket message error"
        });
      }
    })();
  });
});

}
