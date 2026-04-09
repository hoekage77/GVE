import { createServer } from "node:http";

import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { ZodError } from "zod";

import { getDaytonaEnvPreflight, runDaytonaEnvPreflight } from "./env.js";
import { executeTask, generateVisual, generateFromImage, planTasks, resolveChatTurn, generateThinkingAnalysis, generatePostTurnNarration } from "./orchestrator.js";
import { getSandboxRuntimeMetrics, shutdownSandboxRuntime } from "./skill-runtime.js";
import { getPool } from "./llm-pool.js";
import { generateThought, tokenizeThought } from "./thought-generator.js";
import { getSkillCatalog } from "./skill-registry.js";
import { streamMediaArtifact } from "./media-artifacts.js";
import {
  appendSessionMessage,
  appendOrchestrationTrace,
  buildCodeUpdatePayload,
  buildSceneUpdatePayload,
  buildSessionResponse,
  buildWebSocketUrl,
  createSessionMessageId,
  createSession,
  listSessions,
  listSessionMessages,
  updateSessionMessage,
  setSessionStatus,
  recordSceneVersion,
  undoSceneVersion,
  redoSceneVersion,
  previousRevision,
  nextRevision,
  previousSceneVersion,
  nextSceneVersion,
  selectSceneVersion,
  previousArtifactVersion,
  nextArtifactVersion,
  listSceneVersions,
  initializeSessions,
  shutdownSessions
} from "./session-state.js";
import { getCacheStats } from "./cache-manager.js";

const app = express();
const port = Number(process.env.PORT ?? 8000);
const server = createServer(app);
const wsServer = new WebSocketServer({ noServer: true });
const wsClients = new Set();
const metrics = {
  sessionsCreated: 0,
  plansCreated: 0,
  tasksExecuted: 0,
  generations: 0,
  modifications: 0,
  undos: 0,
  redos: 0,
  revisionNavigations: 0,
  versionNavigations: 0,
  artifactNavigations: 0,
  errors: 0,
  latencies: []
};
const startupDaytonaPreflight = runDaytonaEnvPreflight(console);

function parseBooleanEnv(rawValue, fallbackValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

function parseNumberEnv(rawValue, fallbackValue, minimum = 0) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.max(minimum, parsed);
}

function normalizeRequestedTurnMode(rawMode) {
  const normalized = String(rawMode ?? "").trim().toLowerCase();
  if (normalized === "modify" || normalized === "generate") {
    return normalized;
  }

  return null;
}

function normalizeSceneCommand(rawCommand) {
  const normalized = String(rawCommand ?? "").trim().toLowerCase();
  if ([
    "undo",
    "redo",
    "revision.previous",
    "revision.next",
    "version.previous",
    "version.next",
    "artifact.previous",
    "artifact.next"
  ].includes(normalized)) {
    return normalized;
  }

  return null;
}

function normalizeTurnPreferences(preferences, forcedMode = null) {
  const basePreferences = preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? preferences
    : {};

  if (!forcedMode) {
    return basePreferences;
  }

  return {
    ...basePreferences,
    mode: forcedMode
  };
}

function compactModifyDiff(diff) {
  if (!diff || typeof diff !== "object") {
    return null;
  }

  return {
    instruction: diff.instruction ?? null,
    currentVersion: Number.isFinite(diff.currentVersion) ? diff.currentVersion : null,
    changed: typeof diff.changed === "boolean" ? diff.changed : null,
    changeSummary: diff.changeSummary ?? null,
    source: diff.source ?? null,
    addedLines: Number.isFinite(diff.addedLines) ? diff.addedLines : null,
    removedLines: Number.isFinite(diff.removedLines) ? diff.removedLines : null,
    changedLines: Number.isFinite(diff.changedLines) ? diff.changedLines : null
  };
}

function buildTurnLifecyclePayload(turnSummary) {
  return {
    sceneId: turnSummary?.sceneId ?? null,
    sceneVersion: turnSummary?.sceneVersion ?? null,
    skill: turnSummary?.skill ?? null,
    explanation: turnSummary?.explanation ?? null,
    modifyOutcome: turnSummary?.modifyOutcome ?? null,
    noopReason: turnSummary?.noopReason ?? null,
    diff: turnSummary?.diff ?? null,
    runtimeStatus: turnSummary?.runtimeStatus ?? null,
    runtimeWarning: turnSummary?.runtimeWarning ?? null,
    runtimeWarningCode: turnSummary?.runtimeWarningCode ?? null,
    runtimeErrorCode: turnSummary?.runtimeErrorCode ?? null,
    runtimeAcquireDiagnostics: turnSummary?.runtimeAcquireDiagnostics ?? null,
    outputKind: turnSummary?.outputKind ?? null,
    mediaType: turnSummary?.mediaType ?? null,
    mediaUrl: turnSummary?.mediaUrl ?? null,
    mediaArtifactId: turnSummary?.mediaArtifactId ?? null,
    mediaDurationMs: turnSummary?.mediaDurationMs ?? null,
    mediaFps: turnSummary?.mediaFps ?? null,
    mediaResolution: turnSummary?.mediaResolution ?? null,
    mediaBytes: turnSummary?.mediaBytes ?? null,
    generationSource: turnSummary?.generationSource ?? null,
    generationWarning: turnSummary?.generationWarning ?? null,
    assistantSource: turnSummary?.assistantSource ?? null,
    assistantWarning: turnSummary?.assistantWarning ?? null,
    assistantLlm: turnSummary?.assistantLlm ?? null,
    llmTrace: turnSummary?.llmTrace ?? null
  };
}

function buildTurnResultSummary(mode, result, sceneState, metadata = {}) {
  const currentScene = sceneState?.currentScene ?? null;
  const assistantSource = metadata?.assistantSource ?? null;
  const assistantWarning = metadata?.assistantWarning ?? null;
  const assistantLlm = metadata?.assistantLlm ?? null;

  if (!result || (mode !== "generate" && mode !== "modify" && mode !== "image-to-code")) {
    return {
      sceneId: null,
      sceneVersion: null,
      skill: null,
      explanation: null,
      modifyOutcome: null,
      noopReason: null,
      diff: null,
      runtimeStatus: null,
      runtimeWarning: null,
      runtimeWarningCode: null,
      runtimeErrorCode: null,
      runtimeAcquireDiagnostics: null,
      outputKind: null,
      mediaType: null,
      mediaUrl: null,
      mediaArtifactId: null,
      mediaDurationMs: null,
      mediaFps: null,
      mediaResolution: null,
      mediaBytes: null,
      generationSource: null,
      generationWarning: null,
      assistantSource,
      assistantWarning,
      assistantLlm,
      llmTrace: null
    };
  }

  const resolvedOutputKind =
    result.outputKind
    ?? result.runtime?.outputKind
    ?? currentScene?.outputKind
    ?? null;
  const resolvedMediaUrl =
    result.mediaUrl
    ?? result.runtime?.mediaUrl
    ?? currentScene?.mediaUrl
    ?? (resolvedOutputKind === "media" ? (result.previewUrl ?? currentScene?.previewUrl ?? null) : null);

  return {
    sceneId: result.sceneId ?? null,
    sceneVersion: sceneState?.currentScene?.version ?? result.sceneVersion ?? null,
    skill: result.skill ?? result.runtime?.skillId ?? null,
    explanation: result.explanation ?? null,
    modifyOutcome: result.modifyOutcome ?? null,
    noopReason: result.noopReason ?? null,
    diff: compactModifyDiff(result.diff),
    runtimeStatus: result.runtime?.status ?? null,
    runtimeWarning: result.runtime?.warning ?? null,
    runtimeWarningCode: result.runtime?.warningCode ?? null,
    runtimeErrorCode: result.runtime?.errorCode ?? null,
    runtimeAcquireDiagnostics: result.runtime?.acquireDiagnostics ?? null,
    outputKind: resolvedOutputKind,
    mediaType: result.mediaType ?? result.runtime?.mediaType ?? currentScene?.mediaType ?? null,
    mediaUrl: resolvedMediaUrl,
    mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? currentScene?.mediaArtifactId ?? null,
    mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? currentScene?.mediaDurationMs ?? null,
    mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? currentScene?.mediaFps ?? null,
    mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? currentScene?.mediaResolution ?? null,
    mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? currentScene?.mediaBytes ?? null,
    generationSource: result.generationSource ?? null,
    generationWarning: result.generationWarning ?? null,
    assistantSource,
    assistantWarning,
    assistantLlm,
    llmTrace: result.llmTrace ?? null
  };
}

const fastModeEnabled = parseBooleanEnv(process.env.FAST_MODE, true);
const asyncThinkingEnabled = parseBooleanEnv(process.env.ENABLE_ASYNC_THINKING, true);
const postTurnNarrationEnabled = parseBooleanEnv(process.env.ENABLE_POST_TURN_NARRATION, true);
const thoughtStreamingMode = (process.env.THOUGHT_STREAM_MODE ?? (fastModeEnabled ? "compact" : "token")).toLowerCase();
const thoughtTokenDelayMs = parseNumberEnv(
  process.env.THOUGHT_TOKEN_DELAY_MS,
  fastModeEnabled ? 0 : 35,
  0
);
const codeStreamChunkSize = parseNumberEnv(
  process.env.CODE_STREAM_CHUNK_SIZE,
  fastModeEnabled ? 480 : 220,
  24
);
const codeStreamChunkDelayMs = parseNumberEnv(
  process.env.CODE_STREAM_CHUNK_DELAY_MS,
  fastModeEnabled ? 0 : 8,
  0
);
const wsReplayBufferSize = parseNumberEnv(process.env.WS_REPLAY_BUFFER_SIZE, 2000, 200);
const completedTurnCacheSize = parseNumberEnv(process.env.WS_COMPLETED_TURN_CACHE_SIZE, 300, 50);

function recordLatency(durationMs) {
  metrics.latencies.push(durationMs);
  if (metrics.latencies.length > 500) {
    metrics.latencies = metrics.latencies.slice(-500);
  }
}

function computeP95Latency() {
  if (metrics.latencies.length === 0) return 0;
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(index, sorted.length - 1)];
}
const activeChatTurns = new Map();
const completedChatTurns = new Map();
const activeSceneCommands = new Map();
const completedSceneCommands = new Map();
const eventReplayBuffer = [];
let wsEventSequence = 0;

function pruneCompletedTurnCache() {
  if (completedChatTurns.size <= completedTurnCacheSize) {
    return;
  }

  const keys = [...completedChatTurns.keys()];
  const overflow = completedChatTurns.size - completedTurnCacheSize;
  for (let index = 0; index < overflow; index += 1) {
    completedChatTurns.delete(keys[index]);
  }
}

function rememberCompletedTurn(turnKey, payload) {
  if (!turnKey || !payload) {
    return;
  }

  completedChatTurns.set(turnKey, {
    ...payload,
    completedAt: new Date().toISOString()
  });
  pruneCompletedTurnCache();
}

function rememberCompletedSceneCommand(commandKey, payload) {
  if (!commandKey || !payload) {
    return;
  }

  completedSceneCommands.set(commandKey, {
    ...payload,
    completedAt: new Date().toISOString()
  });

  if (completedSceneCommands.size <= completedTurnCacheSize) {
    return;
  }

  const keys = [...completedSceneCommands.keys()];
  const overflow = completedSceneCommands.size - completedTurnCacheSize;
  for (let index = 0; index < overflow; index += 1) {
    completedSceneCommands.delete(keys[index]);
  }
}

function createReplayableEvent(type, payload) {
  const event = {
    type,
    seq: ++wsEventSequence,
    timestamp: new Date().toISOString(),
    payload
  };

  eventReplayBuffer.push(event);
  if (eventReplayBuffer.length > wsReplayBufferSize) {
    eventReplayBuffer.splice(0, eventReplayBuffer.length - wsReplayBufferSize);
  }

  return event;
}

function sendSocketPayload(socket, payload) {
  if (!socket || socket.readyState !== 1) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function sendSocketEvent(socket, type, payload) {
  sendSocketPayload(socket, {
    type,
    timestamp: new Date().toISOString(),
    payload
  });
}

function eventMatchesSession(eventPayload, targetSessionId) {
  if (!targetSessionId) {
    return true;
  }

  const eventSessionId = String(
    eventPayload?.sessionId ?? eventPayload?.payload?.sessionId ?? eventPayload?.message?.sessionId ?? ""
  ).trim();
  if (!eventSessionId) {
    return true;
  }

  return eventSessionId === targetSessionId;
}

function replayEventsSince(socket, lastSeq, sessionId = "") {
  const normalizedLastSeq = Number.isFinite(lastSeq) ? Math.max(0, Number(lastSeq)) : 0;
  const normalizedSessionId = String(sessionId ?? "").trim();
  const missedEvents = eventReplayBuffer.filter(
    (event) => event.seq > normalizedLastSeq && eventMatchesSession(event.payload, normalizedSessionId)
  );

  for (const event of missedEvents) {
    sendSocketPayload(socket, event);
  }

  sendSocketEvent(socket, "session:resumed", {
    sessionId: normalizedSessionId || null,
    lastSeq: normalizedLastSeq,
    replayedCount: missedEvents.length,
    latestSeq: wsEventSequence
  });
}

app.use(cors());
app.use(express.json({ limit: "8mb" }));

wsServer.on("connection", (socket) => {
  wsClients.add(socket);

  sendSocketEvent(socket, "connection:ready", {
    backend: "js",
    orchestration: "langgraph",
    latestSeq: wsEventSequence
  });

  socket.on("close", () => {
    wsClients.delete(socket);
  });

  socket.on("message", (rawMessage) => {
    void (async () => {
      try {
        const parsedMessage = JSON.parse(rawMessage.toString());

        if (parsedMessage?.type === "turn.abort") {
          sendSocketEvent(socket, "turn:aborted", {
            sessionId: String(parsedMessage?.payload?.sessionId ?? "").trim(),
            requestId: String(parsedMessage?.payload?.requestId ?? "").trim() || null
          });
          return;
        }

        if (parsedMessage?.type === "session.resume") {
          const lastSeq = Number(parsedMessage?.payload?.lastSeq ?? 0);
          const sessionId = String(parsedMessage?.payload?.sessionId ?? "").trim();
          replayEventsSince(socket, lastSeq, sessionId);
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
        const forcedMode = normalizeRequestedTurnMode(
          parsedMessage?.payload?.mode ?? parsedMessage?.payload?.preferences?.mode
        );
        const normalizedPreferences = normalizeTurnPreferences(parsedMessage?.payload?.preferences, forcedMode);

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
            return await executeChatTurn(sessionId, content, normalizedPreferences, {
              clientMessageId: clientMessageId || null,
              requestId: requestId || null,
              idempotencyKey: idempotencyKey || null,
              transport: "websocket",
              forcedMode,
              imageUrl: imageUrl || null,
              imageData: imageData || null
            });
          } finally {
            activeChatTurns.delete(turnKey);
          }
        })();
        activeChatTurns.set(turnKey, turnPromise);

        const result = await turnPromise;

        rememberCompletedTurn(turnKey, {
          sessionId,
          mode: result.mode,
          messageId: result.assistantMessage?.id ?? null,
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
          messageId: result.assistantMessage.id,
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

server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") {
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(request, socket, head, (websocket) => {
    wsServer.emit("connection", websocket, request);
  });
});

function broadcastEvent(type, payload) {
  const event = createReplayableEvent(type, payload);
  const message = JSON.stringify(event);

  for (const client of wsClients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

async function broadcastThought(sessionId, step, context = {}) {
  const thought = generateThought(step, context);
  const tokens = tokenizeThought(thought);
  const requestId = typeof context.requestId === "string" && context.requestId.trim()
    ? context.requestId.trim()
    : null;
  const messageId = typeof context.messageId === "string" && context.messageId.trim()
    ? context.messageId.trim()
    : null;

  const thoughtPayloadBase = {
    sessionId,
    step,
    requestId,
    messageId
  };

  if (thoughtStreamingMode === "token") {
    let accumulated = "";
    for (let i = 0; i < tokens.length; i++) {
      accumulated += tokens[i];
      broadcastEvent("thought:stream", {
        ...thoughtPayloadBase,
        thought: accumulated,
        token: tokens[i],
        isFinal: i === tokens.length - 1
      });

      if (thoughtTokenDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, thoughtTokenDelayMs));
      }
    }
  } else {
    const previewLength = Math.min(thought.length, Math.max(24, Math.floor(thought.length * 0.42)));
    const previewThought = thought.slice(0, previewLength).trimEnd();

    if (previewThought && previewThought.length < thought.length) {
      broadcastEvent("thought:stream", {
        ...thoughtPayloadBase,
        thought: previewThought,
        token: previewThought,
        isFinal: false
      });
    }

    broadcastEvent("thought:stream", {
      ...thoughtPayloadBase,
      thought,
      token: thought,
      isFinal: true
    });
  }

  // Persist thought as a session message with kind: "thought"
  appendSessionMessage(sessionId, {
    id: `thought-${step}-${Date.now()}`,
    role: "thought",
    content: thought,
    kind: "thought",
    meta: [
      step,
      requestId ? `requestId:${requestId}` : null,
      messageId ? `messageId:${messageId}` : null
    ].filter(Boolean)
  });

  return thought;
}

async function broadcastCodeStream(sessionId, code, options = {}) {
  const normalizedCode = String(code ?? "");
  const messageId = options.messageId ?? null;
  const mode = options.mode ?? "generate";
  const diff = options.diff ?? null;
  const chunkSize = Number.isFinite(options.chunkSize) ? Math.max(24, options.chunkSize) : codeStreamChunkSize;
  const chunkDelayMs = Number.isFinite(options.chunkDelayMs) ? Math.max(0, options.chunkDelayMs) : codeStreamChunkDelayMs;

  broadcastEvent("code:stream", {
    sessionId,
    messageId,
    mode,
    reset: true,
    done: false,
    delta: "",
    code: ""
  });

  if (!normalizedCode) {
    broadcastEvent("code:stream", {
      sessionId,
      messageId,
      mode,
      reset: false,
      done: true,
      delta: "",
      code: "",
      diff
    });
    return;
  }

  let runningCode = "";

  for (let offset = 0; offset < normalizedCode.length; offset += chunkSize) {
    const delta = normalizedCode.slice(offset, offset + chunkSize);
    runningCode += delta;

    broadcastEvent("code:stream", {
      sessionId,
      messageId,
      mode,
      reset: false,
      done: false,
      delta,
      code: runningCode
    });

    if (chunkDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
    }
  }

  broadcastEvent("code:stream", {
    sessionId,
    messageId,
    mode,
    reset: false,
    done: true,
    delta: "",
    code: runningCode,
    diff
  });
}

function truncateDiagnosticText(value, maxLength = 320) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function extractErrorDiagnostics(error, context = {}) {
  const diagnostics = {
    stage: context.stage ?? null,
    requestId: context.requestId ?? null,
    sessionId: context.sessionId ?? null,
    messageId: context.messageId ?? null,
    message: "Unknown error",
    name: null,
    code: null,
    status: null,
    cause: null,
    stack: null,
    timestamp: new Date().toISOString()
  };

  if (error instanceof Error) {
    diagnostics.message = truncateDiagnosticText(error.message) ?? diagnostics.message;
    diagnostics.name = truncateDiagnosticText(error.name, 80);
    diagnostics.code = truncateDiagnosticText(error.code, 96);
    diagnostics.status = Number.isFinite(error.status) ? Number(error.status) : null;
    diagnostics.cause = truncateDiagnosticText(
      error.cause instanceof Error ? error.cause.message : error.cause,
      240
    );
    diagnostics.stack = truncateDiagnosticText(error.stack?.split("\n").slice(0, 3).join(" | "), 500);
    return diagnostics;
  }

  diagnostics.message = truncateDiagnosticText(error, 320) ?? diagnostics.message;
  return diagnostics;
}

function buildStructuredTurnError({
  stage = "execution",
  errorMessage = "Unknown error",
  runtime = null,
  error = null,
  diagnostics = null
}) {
  const normalizedDiagnostics = diagnostics ?? extractErrorDiagnostics(error, { stage });
  const baseDetail = String(
    errorMessage || runtime?.error || runtime?.warning || normalizedDiagnostics?.message || "Unknown error"
  );

  const diagnosticFragments = [baseDetail];
  if (normalizedDiagnostics?.code) {
    diagnosticFragments.push(`code:${normalizedDiagnostics.code}`);
  }
  if (normalizedDiagnostics?.status) {
    diagnosticFragments.push(`status:${normalizedDiagnostics.status}`);
  }
  if (normalizedDiagnostics?.cause) {
    diagnosticFragments.push(`cause:${normalizedDiagnostics.cause}`);
  }

  const technicalDetail = diagnosticFragments.join(" | ");
  const technicalDetailLower = technicalDetail.toLowerCase();

  let code = "EXECUTION_FAILED";
  let title = "Scene execution failed";
  let userMessage = "I could not run this generated scene successfully.";
  let retryable = false;
  let suggestedAction = "Try generating again with a slightly simpler request.";

  if (/(acquire budget exhausted|runtime budget exhausted|budget exhausted before)/i.test(technicalDetailLower)) {
    code = "SANDBOX_ACQUIRE_BUDGET_EXHAUSTED";
    title = "Turn budget exhausted during sandbox setup";
    userMessage = "I ran out of turn budget while preparing the execution sandbox.";
    retryable = false;
    suggestedAction = "Retry with a simpler request or start a fresh turn.";
  } else if (/(eai_again|getaddrinfo|enotfound|dns|resolver|enetunreach)/i.test(technicalDetailLower)) {
    code = "SANDBOX_DNS_UNAVAILABLE";
    title = "Sandbox DNS issue";
    userMessage = "I could not resolve the sandbox endpoint due to a temporary DNS issue.";
    retryable = true;
    suggestedAction = "Retry in a few seconds.";
  } else if (/(timed out|timeout|504|503|service unavailable|failed to create and start sandbox within)/i.test(technicalDetailLower)) {
    code = "SANDBOX_ACQUIRE_TIMEOUT";
    title = "Sandbox startup timed out";
    userMessage = "The execution sandbox did not become ready before the timeout.";
    retryable = true;
    suggestedAction = "Retry now or simplify the request to reduce setup time.";
  } else if (/(econnreset|econnrefused|network)/i.test(technicalDetailLower)) {
    code = "SANDBOX_NETWORK_UNAVAILABLE";
    title = "Sandbox network issue";
    userMessage = "I could not reach the execution sandbox due to a temporary network issue.";
    retryable = true;
    suggestedAction = "Retry now.";
  } else if (/(validation failed|whitelist|syntax|parse error|unsafe)/i.test(technicalDetailLower)) {
    code = "CODE_VALIDATION_FAILED";
    title = "Generated code failed validation";
    userMessage = "The generated code did not pass safety or syntax checks.";
    retryable = true;
    suggestedAction = "Try regenerating with tighter constraints.";
  } else if (/(is not a function|is not a constructor|undefined)/i.test(technicalDetailLower)) {
    code = "RUNTIME_API_MISMATCH";
    title = "Runtime API mismatch";
    userMessage = "The generated scene called an API that failed at runtime.";
    retryable = true;
    suggestedAction = "Retry generation or ask for a compatibility-safe version.";
  } else if (/(moonshot.*429|engine is currently overloaded|overloaded)/i.test(technicalDetailLower)) {
    code = "MODEL_OVERLOADED";
    title = "Model is overloaded";
    userMessage = "The model is temporarily overloaded and could not complete this turn.";
    retryable = true;
    suggestedAction = "Retry in a few seconds.";
  }

  return {
    code,
    title,
    userMessage,
    retryable,
    suggestedAction,
    technicalDetail,
    stage,
    diagnostics: normalizedDiagnostics
  };
}

function mapAgentActivityText(step, status, payload = {}) {
  const runningTexts = {
    parse_intent: "I am understanding your request and extracting intent.",
    select_skill: "I am selecting the best rendering skill for this scene.",
    build_prompt: "I am composing the generation prompt and constraints.",
    generate_code: "I am writing executable scene code.",
    validate_code: "I am validating the generated code for safety and correctness.",
    execute_code: "I am executing the scene in the sandbox runtime.",
    sync_state: "I am syncing the latest scene state to this session.",
    intent_parsed: "I parsed your intent and generated a plan."
  };

  const completedTexts = {
    parse_intent: "I finished parsing your intent.",
    select_skill: "I selected the rendering skill.",
    build_prompt: "I finished building the prompt.",
    generate_code: "I finished code generation.",
    validate_code: "Validation completed successfully.",
    execute_code: "Execution completed successfully.",
    sync_state: "State sync completed.",
    turn_complete: "Your request completed successfully."
  };

  const failedTexts = {
    validate_code: "I found validation issues in the generated code.",
    execute_code: "I hit an execution issue in the sandbox.",
    sync_state: "I could not sync the latest state.",
    turn_error: "I could not complete this turn due to an error."
  };

  const technicalError = payload?.error ? ` ${String(payload.error)}` : "";

  if (status === "failed") {
    return `${failedTexts[step] ?? "I encountered an error during this step."}${technicalError}`.trim();
  }

  if (status === "completed") {
    return completedTexts[step] ?? "I completed this step.";
  }

  return runningTexts[step] ?? "I am processing this request.";
}

function buildAgentActivity({ sessionId, messageId, step, status = "running", payload = {} }) {
  const tone = status === "failed" ? "error" : status === "completed" ? "success" : "progress";
  return {
    id: `activity-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    sessionId,
    messageId,
    step,
    status,
    tone,
    text: mapAgentActivityText(step, status, payload),
    technicalDetail: payload?.error ? String(payload.error) : null,
    createdAt: new Date().toISOString()
  };
}

function executeSceneCommandMutation(sessionId, command) {
  const normalizedSessionId = String(sessionId ?? "").trim();
  const normalizedCommand = normalizeSceneCommand(command);

  if (!normalizedSessionId || !normalizedCommand) {
    return {
      success: false,
      errorCode: "VALIDATION_ERROR",
      message: "Valid sessionId and command are required.",
      command: normalizedCommand ?? null,
      sceneState: null
    };
  }

  let result;

  switch (normalizedCommand) {
    case "undo": {
      metrics.undos += 1;
      result = undoSceneVersion(normalizedSessionId);
      break;
    }
    case "redo": {
      metrics.redos += 1;
      result = redoSceneVersion(normalizedSessionId);
      break;
    }
    case "revision.previous": {
      metrics.revisionNavigations += 1;
      result = previousRevision(normalizedSessionId);
      break;
    }
    case "revision.next": {
      metrics.revisionNavigations += 1;
      result = nextRevision(normalizedSessionId);
      break;
    }
    case "version.previous": {
      metrics.versionNavigations += 1;
      result = previousSceneVersion(normalizedSessionId);
      break;
    }
    case "version.next": {
      metrics.versionNavigations += 1;
      result = nextSceneVersion(normalizedSessionId);
      break;
    }
    case "artifact.previous": {
      metrics.artifactNavigations += 1;
      result = previousArtifactVersion(normalizedSessionId);
      break;
    }
    case "artifact.next": {
      metrics.artifactNavigations += 1;
      result = nextArtifactVersion(normalizedSessionId);
      break;
    }
    default:
      result = {
        success: false,
        reason: "Unsupported scene command",
        state: createSession(normalizedSessionId)
      };
  }

  if (!result.success) {
    return {
      success: false,
      errorCode: "SCENE_COMMAND_FAILED",
      message: result.reason ?? "Scene command failed.",
      command: normalizedCommand,
      sceneState: result.state ?? null
    };
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));

  if (normalizedCommand === "undo" || normalizedCommand === "revision.previous") {
    broadcastEvent("version:undo", {
      sessionId: normalizedSessionId,
      versionPointer: result.state.versionPointer,
      versionCount: result.state.versionCount
    });
  } else if (normalizedCommand === "redo" || normalizedCommand === "revision.next") {
    broadcastEvent("version:redo", {
      sessionId: normalizedSessionId,
      versionPointer: result.state.versionPointer,
      versionCount: result.state.versionCount
    });
  } else if (normalizedCommand === "version.previous" || normalizedCommand === "version.next") {
    broadcastEvent("version:navigate", {
      sessionId: normalizedSessionId,
      direction: normalizedCommand === "version.previous" ? "previous" : "next",
      versionPointer: result.state.versionPointer,
      versionCount: result.state.versionCount,
      artifactPointer: result.state.artifactPointer,
      artifactCount: result.state.artifactCount,
      currentArtifactId: result.state.currentArtifactId
    });
  } else {
    broadcastEvent("artifact:navigate", {
      sessionId: normalizedSessionId,
      direction: normalizedCommand === "artifact.previous" ? "previous" : "next",
      artifactPointer: result.state.artifactPointer,
      artifactCount: result.state.artifactCount,
      currentArtifactId: result.state.currentArtifactId
    });
  }

  return {
    success: true,
    errorCode: null,
    message: null,
    command: normalizedCommand,
    sceneState: result.state
  };
}

async function executeChatTurn(sessionId, content, preferences, options = {}) {
  const sessionState = createSession(sessionId);
  const userMessageId = options.clientMessageId || createSessionMessageId(sessionId);
  let assistantContent = "";
  let streamedCodePromise = Promise.resolve();
  let hasStreamedCode = false;
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

  const userMessage = appendSessionMessage(sessionId, {
    id: userMessageId,
    role: "user",
    content,
    kind: "input"
  });

  broadcastEvent("message:created", {
    sessionId,
    message: userMessage
  });

  broadcastEvent("message.append", {
    sessionId,
    message: userMessage
  });

  // Generate the assistant ID only after the user message has been persisted.
  // This prevents ID collisions when clientMessageId is not provided.
  const assistantMessageId = createSessionMessageId(sessionId);
  const turnRequestId = options.requestId ?? `${sessionId}:${assistantMessageId}`;
  const stepStartedAtMs = new Map();
  const stepDurationsMs = {};

  const assistantPlaceholder = appendSessionMessage(sessionId, {
    id: assistantMessageId,
    role: "assistant",
    content: "",
    kind: "streaming",
    meta: [`requestId:${turnRequestId}`]
  });

  const thoughtContextBase = {
    requestId: turnRequestId,
    messageId: assistantMessageId
  };

  broadcastEvent("message:created", {
    sessionId,
    message: assistantPlaceholder
  });

  broadcastEvent("turn:started", {
    sessionId,
    content
  });

  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "parse_intent",
    status: "running"
  }));

  console.log(`[Turn] [TRACE] Started chat turn for session ${sessionId}.`);

  // ── Pre-turn LLM thinking analysis (background) ──
  // Start the analysis asynchronously so user-visible pipeline steps are not blocked.
  let llmThoughts = null;
  if (asyncThinkingEnabled) {
    console.log(`[Turn] [TRACE] Starting async thinking analysis for "${content.slice(0, 60)}"...`);
    void generateThinkingAnalysis(content, sessionState, {
      onError: (diagnostics) => {
        appendOrchestrationTrace(sessionId, {
          step: "thinking_analysis_failed",
          payload: {
            sessionId,
            requestId: turnRequestId,
            diagnostics
          }
        });

        broadcastEvent("thinking:analysis_failed", {
          sessionId,
          requestId: turnRequestId,
          messageId: assistantMessageId,
          error: diagnostics
        });
      }
    })
      .then((analysis) => {
        if (analysis) {
          llmThoughts = analysis;
          console.log("[Turn] [TRACE] Async thinking analysis completed.");
        }
      })
      .catch((error) => {
        const diagnostics = extractErrorDiagnostics(error, {
          stage: "thinking_analysis",
          requestId: turnRequestId,
          sessionId,
          messageId: assistantMessageId
        });

        console.warn(
          `[Turn] [TRACE] Async thinking analysis failed: ${diagnostics.message}`
        );

        appendOrchestrationTrace(sessionId, {
          step: "thinking_analysis_failed",
          payload: {
            sessionId,
            requestId: turnRequestId,
            diagnostics
          }
        });

        broadcastEvent("thinking:analysis_failed", {
          sessionId,
          requestId: turnRequestId,
          messageId: assistantMessageId,
          error: diagnostics
        });
      });
  }

  // Stream initial thinking thought (uses LLM-generated if available)
  await broadcastThought(sessionId, "turn_started", { ...thoughtContextBase, query: content, llmThoughts });

  appendOrchestrationTrace(sessionId, {
    step: "intent_parsed",
    payload: { sessionId, content }
  });
  setSessionStatus(sessionId, "parsing");

  console.log(`[Turn] [TRACE] Formatting intent parse for ${sessionId}.`);
  broadcastEvent("orchestration:step", {
    requestId: `${sessionId}:${userMessage.id}`,
    step: "intent_parsed",
    status: "running",
    payload: {
      sessionId,
      content
    }
  });

  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "intent_parsed",
    status: "completed",
    payload: { content }
  }));

  try {
    const plan = await planTasks({ query: content, preferences: effectivePreferences });
    console.log(`[Turn] [TRACE] Task plan generated with ${plan.tasks.length} tasks.`);

    // ── Image-to-code route ──
    // If the user attached an image, route to the image generation pipeline.
    if (hasImage) {
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

      // Record the scene version
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
        explanation: imageResult.explanation,
        source: "image-to-code",
        messageId: assistantMessageId
      });

      const assistantMessage = updateSessionMessage(sessionId, assistantMessageId, {
        content: imageResult.explanation,
        kind: "generate",
        meta: [
          `requestId:${turnRequestId}`,
          `scene:${imageResult.sceneId}`,
          `skill:${imageResult.skill}`,
          "source:image"
        ]
      }) ?? appendSessionMessage(sessionId, {
        id: assistantMessageId,
        role: "assistant",
        content: imageResult.explanation,
        kind: "generate",
        meta: [
          `requestId:${turnRequestId}`,
          `scene:${imageResult.sceneId}`,
          `skill:${imageResult.skill}`,
          "source:image"
        ]
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

      broadcastEvent("message.append", {
        sessionId,
        message: assistantMessage
      });

      await broadcastThought(sessionId, "turn_complete", { ...thoughtContextBase, query: content, llmThoughts });

      const turnSummary = buildTurnResultSummary("image-to-code", imageResult, nextSessionState);

      broadcastEvent("turn:complete", {
        sessionId,
        requestId: options.requestId ?? null,
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


    // Stream intent-parsed thought with context
    const parsedIntentPreview = plan.summary?.includes("threejs")
      ? "threejs"
      : plan.summary?.includes("p5js")
        ? "p5js"
        : plan.summary?.includes("d3js")
          ? "d3js"
          : plan.summary?.includes("animejs")
            ? "animejs"
            : "threejs";
    await broadcastThought(sessionId, "intent_parsed", {
      ...thoughtContextBase,
      query: content,
      domain: plan.summary?.includes("3d") || plan.summary?.includes("3D") ? "3D" : "visual",
      intentType: "create",
      skill: parsedIntentPreview,
      llmThoughts
    });

    // Stream plan-created thought
    await broadcastThought(sessionId, "plan_created", {
      ...thoughtContextBase,
      taskCount: plan.tasks.length,
      query: content,
      llmThoughts
    });

    broadcastEvent("orchestration:plan", {
      sessionId,
      planId: plan.planId,
      tasks: plan.tasks
    });

    const turn = await resolveChatTurn(
      {
        query: content,
        sessionId,
        preferences: effectivePreferences
      },
      sessionState,
      {
        onAssistantChunk: async (_, runningText) => {
          assistantContent = runningText;
          const streamedMessage = updateSessionMessage(sessionId, assistantMessageId, {
            content: assistantContent,
            kind: "streaming"
          });

          if (streamedMessage) {
            broadcastEvent("message:update", {
              sessionId,
              message: streamedMessage
            });
          }
        },
        onStep: ({ step, status = "running", payload = {} }) => {
          const now = Date.now();
          if (status === "running") {
            stepStartedAtMs.set(step, now);
          }

          const startedAt = stepStartedAtMs.get(step);
          const stageDurationMs =
            startedAt && status !== "running"
              ? Math.max(0, now - startedAt)
              : null;

          if (stageDurationMs !== null) {
            stepDurationsMs[step] = stageDurationMs;
          }

          const payloadWithTiming = stageDurationMs !== null
            ? { ...payload, stageDurationMs }
            : payload;

          if (step === "generate_code" && status === "completed" && typeof payload?.code === "string") {
            hasStreamedCode = true;
            streamedCodePromise = broadcastCodeStream(sessionId, payload.code, {
              messageId: assistantMessageId,
              mode: payload?.mode === "modify" ? "modify" : "generate"
            }).catch(() => {
              // Code streaming is best-effort and must not break turns.
            });
          }

          appendOrchestrationTrace(sessionId, {
            step,
            payload: {
              sessionId,
              status,
              ...payloadWithTiming
            }
          });

          broadcastEvent("orchestration:step", {
            requestId: turnRequestId,
            step,
            status,
            payload: {
              sessionId,
              ...payloadWithTiming
            }
          });

          broadcastEvent("agent:activity", buildAgentActivity({
            sessionId,
            messageId: assistantMessageId,
            step,
            status,
            payload: payloadWithTiming
          }));
        }
      }
    );

    let nextSessionState = sessionState;

    if (turn.result && (turn.mode === "generate" || turn.mode === "modify")) {
      if (!hasStreamedCode && typeof turn.result.code === "string") {
        hasStreamedCode = true;
        streamedCodePromise = broadcastCodeStream(sessionId, turn.result.code, {
          messageId: assistantMessageId,
          mode: turn.mode,
          diff: turn.result.diff ?? null
        }).catch(() => {
          // Code streaming is best-effort and must not break turns.
        });
      }

      await streamedCodePromise;

      // Stream code generation thought
      await broadcastThought(sessionId, turn.mode === "generate" ? "code_generated" : "code_modified", {
        ...thoughtContextBase,
        query: content,
        skill: turn.result.skill,
        llmThoughts
      });
      setSessionStatus(sessionId, "generating");

      broadcastEvent(turn.mode === "generate" ? "generation:started" : "code:started", {
        sessionId,
        query: content,
        mode: turn.mode
      });

      const isRejectedNoopModify = turn.mode === "modify" && turn.result?.modifyOutcome === "rejected_noop";
      if (!isRejectedNoopModify) {
        nextSessionState = recordSceneVersion(sessionId, {
          sceneId: turn.result.sceneId,
          code: turn.result.code,
          previewUrl: turn.result.previewUrl,
          skill: turn.result.skill,
          outputKind: turn.result.outputKind ?? turn.result.runtime?.outputKind ?? null,
          mediaType: turn.result.mediaType ?? turn.result.runtime?.mediaType ?? null,
          mediaUrl: turn.result.mediaUrl ?? turn.result.runtime?.mediaUrl ?? null,
          mediaArtifactId: turn.result.mediaArtifactId ?? turn.result.runtime?.mediaArtifactId ?? null,
          mediaDurationMs: turn.result.mediaDurationMs ?? turn.result.runtime?.mediaDurationMs ?? null,
          mediaFps: turn.result.mediaFps ?? turn.result.runtime?.mediaFps ?? null,
          mediaResolution: turn.result.mediaResolution ?? turn.result.runtime?.mediaResolution ?? null,
          mediaBytes: turn.result.mediaBytes ?? turn.result.runtime?.mediaBytes ?? null,
          explanation: turn.result.explanation,
          source: turn.mode,
          messageId: assistantMessageId
        });
      }

      if (!isRejectedNoopModify) {
        // Stream execution thought only when we actually execute runtime work.
        await broadcastThought(sessionId, "executing", {
          ...thoughtContextBase,
          query: content,
          skill: turn.result.skill,
          llmThoughts
        });
        setSessionStatus(sessionId, "executing");
      }

      // Stream sync thought
      await broadcastThought(sessionId, "sync_state", {
        ...thoughtContextBase,
        query: content,
        skill: turn.result.skill,
        llmThoughts
      });

      broadcastEvent(turn.mode === "generate" ? "generation:complete" : "code:update", {
        sessionId,
        sceneId: turn.result.sceneId,
        previewUrl: turn.result.previewUrl,
        outputKind: turn.result.outputKind ?? turn.result.runtime?.outputKind ?? null,
        mediaType: turn.result.mediaType ?? turn.result.runtime?.mediaType ?? null,
        mediaUrl: turn.result.mediaUrl ?? turn.result.runtime?.mediaUrl ?? null,
        mediaArtifactId: turn.result.mediaArtifactId ?? turn.result.runtime?.mediaArtifactId ?? null,
        mediaDurationMs: turn.result.mediaDurationMs ?? turn.result.runtime?.mediaDurationMs ?? null,
        mediaFps: turn.result.mediaFps ?? turn.result.runtime?.mediaFps ?? null,
        mediaResolution: turn.result.mediaResolution ?? turn.result.runtime?.mediaResolution ?? null,
        mediaBytes: turn.result.mediaBytes ?? turn.result.runtime?.mediaBytes ?? null,
        skill: turn.result.skill,
        code: turn.result.code,
        diff: turn.result.diff ?? null,
        sceneVersion: nextSessionState.currentScene?.version ?? 0,
        mode: turn.mode,
        explanation: turn.result.explanation,
        modifyOutcome: turn.result.modifyOutcome ?? null,
        noopReason: turn.result.noopReason ?? null
      });

      if (!isRejectedNoopModify) {
        broadcastEvent("scene:update", buildSceneUpdatePayload(nextSessionState));
      }
    }

    const turnFailed = Boolean(turn.result?.runtime && turn.result.runtime.success === false);
    const turnSummary = buildTurnResultSummary(turn.mode, turn.result, nextSessionState, {
      assistantSource: turn.assistantSource ?? null,
      assistantWarning: turn.assistantWarning ?? null,
      assistantLlm: turn.assistantLlm ?? null
    });
    const runtimeTechnicalDetail = String(
      turn.result?.runtime?.error ?? turn.result?.runtime?.warning ?? ""
    ).toLowerCase();
    const runtimeFailureStage =
      /(sandbox|daytona|acquire|eai_again|getaddrinfo|enotfound|dns|provision|budget exhausted)/i.test(runtimeTechnicalDetail)
        ? "provisioning"
        : "execution";
    const turnError = turnFailed
      ? buildStructuredTurnError({
          stage: runtimeFailureStage,
          errorMessage: turn.result?.runtime?.error ?? turn.result?.runtime?.warning ?? turn.assistantText,
          runtime: turn.result?.runtime ?? null,
          diagnostics: turn.result?.runtime
            ? {
                stage: runtimeFailureStage,
                requestId: turnRequestId,
                sessionId,
                messageId: assistantMessageId,
                message: turn.result?.runtime?.error ?? turn.result?.runtime?.warning ?? "Runtime execution failed",
                name: null,
                code: turn.result?.runtime?.errorCode ?? turn.result?.runtime?.status ?? null,
                status: null,
                cause: null,
                stack: null,
                timestamp: new Date().toISOString(),
                runtime: {
                  status: turn.result?.runtime?.status ?? null,
                  warningCode: turn.result?.runtime?.warningCode ?? null,
                  acquireDiagnostics: turn.result?.runtime?.acquireDiagnostics ?? null
                }
              }
            : null
        })
      : null;

    const assistantMessage = updateSessionMessage(sessionId, assistantMessageId, {
      content: turn.assistantText,
      kind: turn.mode,
      error: turnError,
      meta: turn.result
        ? [
            `requestId:${turnRequestId}`,
            `scene:${turn.result.sceneId}`,
            turn.result.skill ? `skill:${turn.result.skill}` : null,
            turn.result.sceneVersion ? `v${turn.result.sceneVersion}` : null
            ,
            turnError ? `error:${turnError.code}` : null,
            turn.assistantSource ? `assistantSource:${turn.assistantSource}` : null,
            turn.assistantWarning ? "assistantWarning:true" : null
          ].filter(Boolean)
        : [
            turn.assistantSource ? `assistantSource:${turn.assistantSource}` : null,
            turn.assistantWarning ? "assistantWarning:true" : null
          ].filter(Boolean)
    }) ?? appendSessionMessage(sessionId, {
      id: assistantMessageId,
      role: "assistant",
      content: turn.assistantText,
      kind: turn.mode,
      error: turnError,
      meta: turn.result
        ? [
            `requestId:${turnRequestId}`,
            `scene:${turn.result.sceneId}`,
            turn.result.skill ? `skill:${turn.result.skill}` : null,
            turn.result.sceneVersion ? `v${turn.result.sceneVersion}` : null
            ,
            turnError ? `error:${turnError.code}` : null,
            turn.assistantSource ? `assistantSource:${turn.assistantSource}` : null,
            turn.assistantWarning ? "assistantWarning:true" : null
          ].filter(Boolean)
        : [
            turn.assistantSource ? `assistantSource:${turn.assistantSource}` : null,
            turn.assistantWarning ? "assistantWarning:true" : null
          ].filter(Boolean)
    });

    broadcastEvent("message.append", {
      sessionId,
      message: assistantMessage
    });

    const turnEventType = turnFailed ? "turn:error" : "turn:complete";

    // Stream final thought
    await broadcastThought(sessionId, turnFailed ? "turn_error" : "turn_complete", {
      ...thoughtContextBase,
      query: content,
      error: turnFailed ? turn.result?.runtime?.error ?? "" : "",
      llmThoughts
    });

    // ── Post-turn LLM narration (background) ──
    // Do not block turn completion on optional narration.
    if (postTurnNarrationEnabled && !turnFailed && (turn.mode === "generate" || turn.mode === "modify")) {
      void (async () => {
        try {
          const postNarration = await generatePostTurnNarration(
            { result: turn.result },
            content,
            { fastMode: fastModeEnabled }
          );

          if (postNarration) {
            await broadcastThought(sessionId, "post_narration", {
              ...thoughtContextBase,
              query: content,
              llmThoughts: { complete: postNarration }
            });
          }
        } catch (error) {
          console.warn(
            `[Turn] [TRACE] Post-turn narration skipped: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      })();
    }

    broadcastEvent(turnEventType, {
      sessionId,
      requestId: turnRequestId,
      mode: turn.mode,
      messageCount: listSessionMessages(sessionId).length,
      ...buildTurnLifecyclePayload(turnSummary),
      timings: {
        stepDurationsMs
      },
      error: turnFailed ? turnError : null,
      message: turnFailed ? turnError?.userMessage ?? turn.result?.runtime?.error ?? "Turn failed" : null
    });

    broadcastEvent("agent:activity", buildAgentActivity({
      sessionId,
      messageId: assistantMessageId,
      step: turnFailed ? "turn_error" : "turn_complete",
      status: turnFailed ? "failed" : "completed",
      payload: turnFailed ? { error: turnError?.technicalDetail ?? "Turn failed" } : {}
    }));

    appendOrchestrationTrace(sessionId, {
      step: turnFailed ? "turn_error" : "turn_complete",
      payload: {
        sessionId,
        mode: turn.mode,
        messageCount: listSessionMessages(sessionId).length,
        error: turnFailed ? turnError : null
      }
    });
    setSessionStatus(sessionId, "idle");

    return {
      sessionId,
      mode: turn.mode,
      intent: turn.parsedIntent,
      assistantSource: turn.assistantSource ?? null,
      assistantWarning: turn.assistantWarning ?? null,
      assistantLlm: turn.assistantLlm ?? null,
      userMessage,
      assistantMessage,
      sceneState: nextSessionState,
      messages: listSessionMessages(sessionId),
      result: turn.result,
      turnSummary
    };
  } catch (error) {
    const diagnostics = extractErrorDiagnostics(error, {
      stage: "turn",
      requestId: turnRequestId,
      sessionId,
      messageId: assistantMessageId
    });

    const structuredError = buildStructuredTurnError({
      stage: "turn",
      errorMessage: error instanceof Error ? error.message : "Unknown chat turn error",
      runtime: null,
      error,
      diagnostics
    });

    const assistantErrorMessage = updateSessionMessage(sessionId, assistantMessageId, {
      content: structuredError.userMessage,
      kind: "error",
      error: structuredError,
      meta: [`error:${structuredError.code}`]
    });

    if (assistantErrorMessage) {
      broadcastEvent("message:update", {
        sessionId,
        message: assistantErrorMessage
      });
    }

    appendOrchestrationTrace(sessionId, {
      step: "turn_error",
      payload: {
        sessionId,
        error: structuredError,
        timings: {
          stepDurationsMs
        }
      }
    });
    setSessionStatus(sessionId, "idle");

    broadcastEvent("turn:error", {
      sessionId,
      requestId: turnRequestId,
      error: structuredError,
      message: structuredError.userMessage,
      timings: {
        stepDurationsMs
      }
    });

    broadcastEvent("agent:activity", buildAgentActivity({
      sessionId,
      messageId: assistantMessageId,
      step: "turn_error",
      status: "failed",
      payload: { error: structuredError.technicalDetail }
    }));

    throw error;
  }
}

app.get("/healthz", (_req, res) => {
  const daytonaPreflight = getDaytonaEnvPreflight();
  const pool = getPool();
  const poolStatus = pool.getStatus();
  res.json({
    status: "ok",
    backend: "js",
    orchestration: "langgraph",
    llm: {
      pool: {
        enabledProviders: poolStatus.providers.filter((p) => p.state !== "disabled").length,
        totalProviders: poolStatus.providers.length,
        totalGenerations: poolStatus.totalGenerations,
        fallbackCount: poolStatus.fallbackCount,
        avgResponseMs: poolStatus.avgResponseMs,
      },
      primary: {
        provider: "moonshot-kimi",
        configured: Boolean(process.env.MOONSHOT_API_KEY),
        model: process.env.MOONSHOT_MODEL ?? "kimi-k2.5"
      }
    },
    daytona: {
      preflightOk: daytonaPreflight.ok,
      warningCount: daytonaPreflight.warnings.length,
      summary: daytonaPreflight.summary
    }
  });
});

app.get("/api/pool/status", (_req, res) => {
  const pool = getPool();
  res.json(pool.getStatus());
});

app.post("/api/v1/sessions", (req, res) => {
  metrics.sessionsCreated += 1;
  const sessionState = createSession(req.body?.sessionId);
  res.status(201).json(buildSessionResponse(sessionState, buildWebSocketUrl(req)));
});

app.get("/api/v1/sessions", (_req, res) => {
  res.json({
    sessions: listSessions()
  });
});

app.get("/api/v1/sessions/:sessionId/messages", (req, res) => {
  const sessionState = createSession(req.params.sessionId);

  res.json({
    sessionId: sessionState.sessionId,
    messages: listSessionMessages(sessionState.sessionId)
  });
});

app.post("/api/v1/sessions/:sessionId/messages", async (req, res) => {
  const sessionId = req.params.sessionId;
  const content = String(req.body?.content ?? req.body?.query ?? "").trim();
  const imageUrl = String(req.body?.imageUrl ?? "").trim();
  const imageData = String(req.body?.imageData ?? "").trim();

  if (!content && !imageUrl && !imageData) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Message content or image payload is required."
    });
    return;
  }

  try {
    const result = await executeChatTurn(sessionId, content, req.body?.preferences, {
      imageUrl: imageUrl || null,
      imageData: imageData || null,
      transport: "rest"
    });
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

app.get("/api/v1/skills", (_req, res) => {
  res.json({
    skills: getSkillCatalog()
  });
});

app.get("/api/v1/media/:mediaKey", (req, res) => {
  streamMediaArtifact(req, res, req.params.mediaKey);
});

app.post("/api/v1/tasks/plan", async (req, res) => {
  try {
    metrics.plansCreated += 1;
    const result = await planTasks(req.body);
    broadcastEvent("tasks:planned", {
      planId: result.planId,
      taskCount: result.tasks.length,
      summary: result.summary
    });
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/api/v1/tasks/execute", async (req, res) => {
  const startedAt = Date.now();
  try {
    metrics.tasksExecuted += 1;
    broadcastEvent("task:started", {
      planId: req.body?.planId,
      taskId: req.body?.task?.id,
      action: req.body?.task?.action
    });

    const result = await executeTask(req.body);

    broadcastEvent("task:completed", {
      planId: result.planId,
      taskId: result.taskId,
      status: result.status,
      output: result.output,
      artifact: result.artifact,
      durationMs: Date.now() - startedAt
    });

    res.json(result);
  } catch (error) {
    broadcastEvent("task:failed", {
      planId: req.body?.planId,
      taskId: req.body?.task?.id,
      message: error instanceof Error ? error.message : "Unknown task error"
    });
    handleError(error, res);
  }
});

app.post("/api/v1/generate", async (req, res) => {
  const requestId = `req-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const sessionState = createSession(req.body?.sessionId);

  try {
    metrics.generations += 1;
    broadcastEvent("generation:started", { requestId });
    broadcastEvent("generation:progress", {
      requestId,
      stage: "orchestrating",
      message: "Running LangGraph generation pipeline"
    });

    const result = await generateVisual(req.body);
    const updatedSessionState = recordSceneVersion(sessionState.sessionId, {
      sceneId: result.sceneId,
      code: result.code,
      previewUrl: result.previewUrl,
      skill: result.skill,
      outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
      mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
      mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
      mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
      mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
      mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
      explanation: result.explanation,
      source: "generate"
    });

    await broadcastCodeStream(updatedSessionState.sessionId, result.code, {
      mode: "generate",
      diff: result.diff ?? null
    });

    broadcastEvent("generation:complete", {
      requestId,
      sceneId: result.sceneId,
      previewUrl: result.previewUrl,
      outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
      mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
      mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
      mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
      mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
      mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
      skill: result.skill,
      code: result.code,
      diff: result.diff ?? null,
      sessionId: updatedSessionState.sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0
    });

    broadcastEvent("scene:update", buildSceneUpdatePayload(updatedSessionState));

    res.json({
      ...result,
      sessionId: updatedSessionState.sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
      versionCount: updatedSessionState.versionCount,
      sceneState: updatedSessionState
    });
  } catch (error) {
    broadcastEvent("generation:error", {
      requestId,
      message: error instanceof Error ? error.message : "Unknown generation error"
    });
    handleError(error, res);
  }
});

// ── Image-to-Code endpoint ──

app.post("/api/v1/generate/from-image", async (req, res) => {
  const requestId = `req-img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const sessionState = createSession(req.body?.sessionId);
  const imageUrl = req.body?.imageUrl || null;
  const imageData = req.body?.imageData || null;

  if (!imageUrl && !imageData) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "imageUrl or imageData (base64) is required."
    });
    return;
  }

  const resolvedImageUrl = imageUrl || (imageData ? `data:image/png;base64,${imageData}` : null);

  try {
    metrics.generations += 1;
    broadcastEvent("generation:started", { requestId, mode: "image-to-code" });
    broadcastEvent("generation:progress", {
      requestId,
      stage: "analyzing-image",
      message: "Analyzing reference image and generating scene code"
    });

    const result = await generateFromImage({
      imageUrl: resolvedImageUrl,
      query: req.body?.query ?? "",
      sessionId: sessionState.sessionId,
      preferences: req.body?.preferences
    });

    const updatedSessionState = recordSceneVersion(sessionState.sessionId, {
      sceneId: result.sceneId,
      code: result.code,
      previewUrl: result.previewUrl,
      skill: result.skill,
      outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
      mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
      mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
      mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
      mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
      mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
      explanation: result.explanation,
      source: "image-to-code"
    });

    broadcastEvent("generation:complete", {
      requestId,
      sceneId: result.sceneId,
      previewUrl: result.previewUrl,
      outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
      mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
      mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
      mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
      mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
      mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
      skill: result.skill,
      sessionId: updatedSessionState.sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
      mode: "image-to-code"
    });

    broadcastEvent("scene:update", buildSceneUpdatePayload(updatedSessionState));

    res.json({
      ...result,
      sessionId: updatedSessionState.sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
      versionCount: updatedSessionState.versionCount,
      sceneState: updatedSessionState
    });
  } catch (error) {
    broadcastEvent("generation:error", {
      requestId,
      mode: "image-to-code",
      message: error instanceof Error ? error.message : "Unknown image generation error"
    });
    handleError(error, res);
  }
});

app.post("/api/v1/sessions/:sessionId/modify", async (req, res) => {
  const sessionId = req.params.sessionId;
  const instruction = String(req.body?.instruction ?? req.body?.query ?? "").trim();
  const sessionState = createSession(sessionId);

  if (!instruction) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Modification instruction is required."
    });
    return;
  }

  if (!sessionState.currentScene?.code) {
    res.status(404).json({
      error: "NOT_FOUND",
      message: "No scene available for the requested session."
    });
    return;
  }

  try {
    metrics.modifications += 1;
    broadcastEvent("code:started", {
      sessionId,
      sceneId: sessionState.currentScene.sceneId,
      instruction
    });

    const result = await import("./orchestrator.js").then((module) =>
      module.modifyVisual({
        sessionId,
        instruction,
        preferences: req.body?.preferences,
        sceneState: sessionState
      })
    );

    await broadcastCodeStream(sessionId, result.code, {
      mode: "modify",
      diff: result.diff ?? null
    });

    const isRejectedNoopModify = result.modifyOutcome === "rejected_noop";
    const updatedSessionState = isRejectedNoopModify
      ? sessionState
      : recordSceneVersion(sessionId, {
          sceneId: result.sceneId,
          code: result.code,
          previewUrl: result.previewUrl,
          skill: result.skill,
          outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
          mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
          mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
          mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
          mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
          mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
          mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
          mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
          explanation: result.explanation,
          source: "modify"
        });

    broadcastEvent("code:update", buildCodeUpdatePayload(updatedSessionState, {
      instruction,
      code: result.code,
      diff: result.diff,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
      outputKind: result.outputKind ?? result.runtime?.outputKind ?? null,
      mediaType: result.mediaType ?? result.runtime?.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? result.runtime?.mediaUrl ?? null,
      mediaArtifactId: result.mediaArtifactId ?? result.runtime?.mediaArtifactId ?? null,
      mediaDurationMs: result.mediaDurationMs ?? result.runtime?.mediaDurationMs ?? null,
      mediaFps: result.mediaFps ?? result.runtime?.mediaFps ?? null,
      mediaResolution: result.mediaResolution ?? result.runtime?.mediaResolution ?? null,
      mediaBytes: result.mediaBytes ?? result.runtime?.mediaBytes ?? null,
      modifyOutcome: result.modifyOutcome ?? null,
      noopReason: result.noopReason ?? null
    }));

    if (!isRejectedNoopModify) {
      broadcastEvent("scene:update", buildSceneUpdatePayload(updatedSessionState));
    }

    res.json({
      ...result,
      sessionId,
      sceneVersion: updatedSessionState.currentScene?.version ?? 0,
      versionCount: updatedSessionState.versionCount,
      sceneState: updatedSessionState
    });
  } catch (error) {
    broadcastEvent("code:error", {
      sessionId,
      sceneId: sessionState.currentScene.sceneId,
      instruction,
      message: error instanceof Error ? error.message : "Unknown modification error"
    });
    handleError(error, res);
  }
});

app.post("/api/v1/sessions/:sessionId/undo", (req, res) => {
  const sessionId = req.params.sessionId;
  metrics.undos += 1;

  const result = undoSceneVersion(sessionId);

  if (!result.success) {
    res.status(400).json({
      error: "UNDO_FAILED",
      message: result.reason,
      sceneState: result.state
    });
    return;
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));
  broadcastEvent("version:undo", {
    sessionId,
    versionPointer: result.state.versionPointer,
    versionCount: result.state.versionCount
  });

  res.json({
    success: true,
    sceneState: result.state
  });
});

app.post("/api/v1/sessions/:sessionId/redo", (req, res) => {
  const sessionId = req.params.sessionId;
  metrics.redos += 1;

  const result = redoSceneVersion(sessionId);

  if (!result.success) {
    res.status(400).json({
      error: "REDO_FAILED",
      message: result.reason,
      sceneState: result.state
    });
    return;
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));
  broadcastEvent("version:redo", {
    sessionId,
    versionPointer: result.state.versionPointer,
    versionCount: result.state.versionCount
  });

  res.json({
    success: true,
    sceneState: result.state
  });
});

app.post("/api/v1/sessions/:sessionId/artifacts/previous", (req, res) => {
  const sessionId = req.params.sessionId;
  metrics.artifactNavigations += 1;

  const result = previousArtifactVersion(sessionId);

  if (!result.success) {
    res.status(400).json({
      error: "ARTIFACT_NAVIGATION_FAILED",
      message: result.reason,
      sceneState: result.state
    });
    return;
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));
  broadcastEvent("artifact:navigate", {
    sessionId,
    direction: "previous",
    artifactPointer: result.state.artifactPointer,
    artifactCount: result.state.artifactCount,
    currentArtifactId: result.state.currentArtifactId
  });

  res.json({
    success: true,
    sceneState: result.state
  });
});

app.post("/api/v1/sessions/:sessionId/artifacts/next", (req, res) => {
  const sessionId = req.params.sessionId;
  metrics.artifactNavigations += 1;

  const result = nextArtifactVersion(sessionId);

  if (!result.success) {
    res.status(400).json({
      error: "ARTIFACT_NAVIGATION_FAILED",
      message: result.reason,
      sceneState: result.state
    });
    return;
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));
  broadcastEvent("artifact:navigate", {
    sessionId,
    direction: "next",
    artifactPointer: result.state.artifactPointer,
    artifactCount: result.state.artifactCount,
    currentArtifactId: result.state.currentArtifactId
  });

  res.json({
    success: true,
    sceneState: result.state
  });
});

app.post("/api/v1/sessions/:sessionId/versions/select", (req, res) => {
  const sessionId = req.params.sessionId;
  const versionId = typeof req.body?.versionId === "string" ? req.body.versionId : "";

  const result = selectSceneVersion(sessionId, versionId);

  if (!result.success) {
    res.status(400).json({
      error: "VERSION_SELECTION_FAILED",
      message: result.reason,
      sceneState: result.state
    });
    return;
  }

  broadcastEvent("scene:update", buildSceneUpdatePayload(result.state));

  res.json({
    success: true,
    sceneState: result.state
  });
});

app.get("/api/v1/sessions/:sessionId/versions", (req, res) => {
  const sessionId = req.params.sessionId;
  const result = listSceneVersions(sessionId);
  res.json(result);
});

function handleError(error, res) {
  metrics.errors += 1;

  if (error instanceof ZodError) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Request payload failed schema validation.",
      issues: error.issues
    });
    return;
  }

  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unknown error"
  });
}

app.get("/metrics", (_req, res) => {
  const cacheStats = getCacheStats();
  const sandboxPool = getSandboxRuntimeMetrics();
  res.json({
    ...metrics,
    latencies: undefined,
    p95LatencyMs: computeP95Latency(),
    cache: cacheStats,
    sandboxPool,
    daytonaPreflight: startupDaytonaPreflight,
    wsConnections: wsClients.size,
    uptimeSeconds: Math.round(process.uptime())
  });
});

// ── Startup ──
initializeSessions();

server.listen(port, () => {
  console.log(`GVE JS backend listening on http://localhost:${port}`);
});

// ── Graceful shutdown ──
function gracefulShutdown(signal) {
  console.log(`[Server] Received ${signal}. Flushing sessions and shutting down...`);
  void (async () => {
    try {
      await shutdownSandboxRuntime({ deleteIdleSandboxes: true });
    } catch (error) {
      console.warn(`[Server] Sandbox runtime shutdown warning: ${error instanceof Error ? error.message : String(error)}`);
    }

    shutdownSessions();
    server.close(() => {
      console.log("[Server] Closed.");
      process.exit(0);
    });
  })();
  // Force exit after 5s if server doesn't close
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
