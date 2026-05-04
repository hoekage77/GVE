import { wsClients } from "./handler.js";

import { generateThought, tokenizeThought } from "../pipeline/thoughts.js";
import { appendSessionMessage } from "../state/session.js";

const fastModeEnabled = process.env.FAST_MODE !== "false" && process.env.FAST_MODE !== "0";
const thoughtStreamingMode = (process.env.THOUGHT_STREAM_MODE ?? (fastModeEnabled ? "compact" : "token")).toLowerCase();
const thoughtTokenDelayMs = Number.parseInt(String(process.env.THOUGHT_TOKEN_DELAY_MS ?? (fastModeEnabled ? "0" : "35")), 10);
const codeStreamChunkSize = Number.parseInt(String(process.env.CODE_STREAM_CHUNK_SIZE ?? (fastModeEnabled ? "480" : "220")), 10);
const codeStreamChunkDelayMs = Number.parseInt(String(process.env.CODE_STREAM_CHUNK_DELAY_MS ?? (fastModeEnabled ? "0" : "8")), 10);
const wsReplayBufferSize = Number.parseInt(String(process.env.WS_REPLAY_BUFFER_SIZE ?? "2000"), 10);

const STEP_DISPLAY_LABELS: Record<string, string> = {
  turn_started: "Thinking",
  parse_intent: "Understanding request",
  intent_parsed: "Understanding request",
  select_skill: "Selecting skill",
  build_prompt: "Building prompt",
  generate_code: "Generating code",
  code_generated: "Code ready",
  code_modified: "Modifying scene",
  validate_code: "Validating code",
  validation_failed: "Recovering from error",
  execute_code: "Executing in sandbox",
  executing: "Running scene",
  execution_skipped: "Skipping execution",
  sync_state: "Syncing state",
  turn_complete: "Done",
  turn_error: "Error",
  post_narration: "Narrating",
  image_analyzing: "Analyzing image",
  image_generating: "Generating from image",
};

export interface ReplayEvent {
  type: string;
  seq: number;
  timestamp: string;
  payload: any;
}

export const eventReplayBuffer: ReplayEvent[] = [];
export let wsEventSequence = 0;

export function createReplayableEvent(type: string, payload: any): ReplayEvent {
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

export function sendSocketPayload(socket: any, payload: any) {
  if (!socket || socket.readyState !== 1) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

export function sendSocketEvent(socket: any, type: string, payload: any) {
  sendSocketPayload(socket, {
    type,
    timestamp: new Date().toISOString(),
    payload
  });
}

export function eventMatchesSession(eventPayload: any, targetSessionId: string): boolean {
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

export function replayEventsSince(socket: any, lastSeq: number, sessionId = "") {
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

export function broadcastEvent(type: string, payload: any) {
  const event = createReplayableEvent(type, payload);
  const message = JSON.stringify(event);

  for (const client of Array.from(wsClients) as any[]) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

export async function broadcastThought(sessionId: string, step: string, context: any = {}): Promise<string> {
  const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalizedSessionId) {
    console.warn(`[Streaming] broadcastThought called with empty sessionId for step=${step} — skipping.`);
    return "";
  }
  sessionId = normalizedSessionId;

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
        isFinal: i === tokens.length - 1,
        stepLabel: STEP_DISPLAY_LABELS[step] ?? step.replace(/_/g, " "),
        status: i === tokens.length - 1 ? "completed" : "streaming",
        durationMs: context.stageDurationMs ?? null,
        detail: context.detail ?? null,
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
        isFinal: false,
        stepLabel: STEP_DISPLAY_LABELS[step] ?? step.replace(/_/g, " "),
        status: "streaming",
        durationMs: context.stageDurationMs ?? null,
        detail: context.detail ?? null,
      });
    }

    broadcastEvent("thought:stream", {
      ...thoughtPayloadBase,
      thought,
      token: thought,
      isFinal: true,
      stepLabel: STEP_DISPLAY_LABELS[step] ?? step.replace(/_/g, " "),
      status: "completed",
      durationMs: context.stageDurationMs ?? null,
      detail: context.detail ?? null,
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
      messageId ? `messageId:${messageId}` : null,
      context.stageDurationMs ? `durationMs:${context.stageDurationMs}` : null
    ].filter(Boolean)
  });

  return thought;
}

export async function broadcastCodeStream(sessionId: string, code: string, options: any = {}): Promise<void> {
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
