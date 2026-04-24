import { AsyncLocalStorage } from "node:async_hooks";

export type TraceContext = {
  requestId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  messageId?: string | null;
};

const storage = new AsyncLocalStorage<TraceContext>();

export function getTraceContext(): TraceContext {
  return storage.getStore() ?? {};
}

export function runWithTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  const parent = storage.getStore() ?? {};
  return storage.run({ ...parent, ...ctx }, fn);
}

