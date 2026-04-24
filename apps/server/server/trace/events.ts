import { getTraceContext } from "./context.js";

export type TraceEvent = {
  ts: string;
  type: string;
  requestId: string | null;
  sessionId: string | null;
  userId: string | null;
  messageId: string | null;
  payload: Record<string, unknown>;
};

export function traceEvent(type: string, payload: Record<string, unknown> = {}): void {
  const ctx = getTraceContext();
  const evt: TraceEvent = {
    ts: new Date().toISOString(),
    type,
    requestId: ctx.requestId ?? null,
    sessionId: ctx.sessionId ?? null,
    userId: ctx.userId ?? null,
    messageId: ctx.messageId ?? null,
    payload
  };

  // Phase 0: JSONL logs to stdout for ingestion.
  // Later: route to file/OTel/collector.
  console.log(`[TRACE] ${JSON.stringify(evt)}`);
}

