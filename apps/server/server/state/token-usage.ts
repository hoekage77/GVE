/**
 * Token Usage Accumulator
 *
 * Tracks LLM token consumption per-session and per-user with configurable
 * limits. Persists usage records to disk using the same .data directory
 * pattern as the session file-store.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getTraceContext } from "../trace/context.js";
import { traceEvent } from "../trace/events.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USAGE_DATA_DIR = join(__dirname, "..", "..", ".data", "usage");

if (!existsSync(USAGE_DATA_DIR)) {
  mkdirSync(USAGE_DATA_DIR, { recursive: true });
}

// ── Configuration ──

function parsePositiveIntEnv(raw: string | undefined, fallback: number, min = 0): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

/** Per-session token limit. 0 = unlimited. */
const TOKEN_LIMIT_PER_SESSION = parsePositiveIntEnv(process.env.TOKEN_LIMIT_PER_SESSION, 0);

/** Per-user daily token limit. 0 = unlimited. */
const TOKEN_LIMIT_PER_USER_DAILY = parsePositiveIntEnv(process.env.TOKEN_LIMIT_PER_USER_DAILY, 0);

/** How often to flush usage to disk (ms). */
const FLUSH_INTERVAL_MS = parsePositiveIntEnv(process.env.TOKEN_USAGE_FLUSH_INTERVAL_MS, 5_000, 1_000);

// ── Types ──

export interface TokenUsageEntry {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  lastRecordedAt: string;
}

export interface TokenUsageRecord {
  providerId: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  sessionId: string | null;
  userId: string | null;
  recordedAt: string;
}

export interface LimitCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  scope: "session" | "user" | "none";
  currentUsage: number;
}

interface DailyUserBucket {
  date: string; // YYYY-MM-DD
  usage: TokenUsageEntry;
}

// ── In-memory accumulators ──

const sessionUsage = new Map<string, TokenUsageEntry>();
const userDailyUsage = new Map<string, DailyUserBucket>();

/** Global totals for /metrics. */
const globalTotals = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
};

let dirty = false;

// ── Helpers ──

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyEntry(): TokenUsageEntry {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0, lastRecordedAt: new Date().toISOString() };
}

function addToEntry(entry: TokenUsageEntry, prompt: number, completion: number, total: number): void {
  entry.promptTokens += prompt;
  entry.completionTokens += completion;
  entry.totalTokens += total;
  entry.requestCount += 1;
  entry.lastRecordedAt = new Date().toISOString();
}

function getUserDailyBucket(userId: string): TokenUsageEntry {
  const today = todayDateString();
  const existing = userDailyUsage.get(userId);

  if (existing && existing.date === today) {
    return existing.usage;
  }

  // New day — reset bucket.
  const fresh = emptyEntry();
  userDailyUsage.set(userId, { date: today, usage: fresh });
  return fresh;
}

// ── Core API ──

/**
 * Record token usage from an LLM response.
 * Automatically reads sessionId/userId from AsyncLocalStorage trace context
 * if not provided explicitly.
 */
export function recordTokenUsage(
  ctx: { sessionId?: string | null; userId?: string | null; providerId?: string; model?: string | null },
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
): void {
  const traceCtx = getTraceContext();
  const sessionId = ctx.sessionId ?? traceCtx.sessionId ?? null;
  const userId = ctx.userId ?? traceCtx.userId ?? null;

  const prompt = Math.max(0, Number(usage.prompt_tokens) || 0);
  const completion = Math.max(0, Number(usage.completion_tokens) || 0);
  const total = Math.max(0, Number(usage.total_tokens) || prompt + completion);

  if (total === 0 && prompt === 0 && completion === 0) {
    return; // Nothing to record.
  }

  // Global totals.
  globalTotals.promptTokens += prompt;
  globalTotals.completionTokens += completion;
  globalTotals.totalTokens += total;
  globalTotals.requestCount += 1;

  // Per-session accumulation.
  if (sessionId) {
    const entry = sessionUsage.get(sessionId) ?? emptyEntry();
    addToEntry(entry, prompt, completion, total);
    sessionUsage.set(sessionId, entry);
  }

  // Per-user daily accumulation.
  if (userId) {
    const bucket = getUserDailyBucket(userId);
    addToEntry(bucket, prompt, completion, total);
  }

  dirty = true;

  traceEvent("token.recorded", {
    sessionId,
    userId,
    providerId: ctx.providerId ?? null,
    model: ctx.model ?? null,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  });
}

/**
 * Get aggregated token usage for a session.
 */
export function getSessionUsage(sessionId: string): TokenUsageEntry {
  return sessionUsage.get(sessionId) ?? emptyEntry();
}

/**
 * Get aggregated daily token usage for a user.
 */
export function getUserDailyTokenUsage(userId: string): TokenUsageEntry {
  const today = todayDateString();
  const bucket = userDailyUsage.get(userId);

  if (!bucket || bucket.date !== today) {
    return emptyEntry();
  }

  return { ...bucket.usage };
}

/**
 * Check whether a request should be allowed based on configured limits.
 * Returns the most restrictive limit that applies.
 */
export function checkTokenLimit(sessionId: string | null, userId: string | null): LimitCheckResult {
  // Check session limit first.
  if (TOKEN_LIMIT_PER_SESSION > 0 && sessionId) {
    const entry = sessionUsage.get(sessionId);
    const current = entry?.totalTokens ?? 0;
    const remaining = Math.max(0, TOKEN_LIMIT_PER_SESSION - current);

    if (current >= TOKEN_LIMIT_PER_SESSION) {
      return { allowed: false, remaining: 0, limit: TOKEN_LIMIT_PER_SESSION, scope: "session", currentUsage: current };
    }
  }

  // Check user daily limit.
  if (TOKEN_LIMIT_PER_USER_DAILY > 0 && userId) {
    const entry = getUserDailyBucket(userId);
    const current = entry.totalTokens;
    const remaining = Math.max(0, TOKEN_LIMIT_PER_USER_DAILY - current);

    if (current >= TOKEN_LIMIT_PER_USER_DAILY) {
      return { allowed: false, remaining: 0, limit: TOKEN_LIMIT_PER_USER_DAILY, scope: "user", currentUsage: current };
    }

    // Return user limit info since it's more restrictive globally.
    if (TOKEN_LIMIT_PER_SESSION > 0 && sessionId) {
      const sessionEntry = sessionUsage.get(sessionId);
      const sessionCurrent = sessionEntry?.totalTokens ?? 0;
      const sessionRemaining = TOKEN_LIMIT_PER_SESSION - sessionCurrent;

      if (sessionRemaining < remaining) {
        return { allowed: true, remaining: sessionRemaining, limit: TOKEN_LIMIT_PER_SESSION, scope: "session", currentUsage: sessionCurrent };
      }
    }

    return { allowed: true, remaining, limit: TOKEN_LIMIT_PER_USER_DAILY, scope: "user", currentUsage: current };
  }

  // Session-only limit (no user).
  if (TOKEN_LIMIT_PER_SESSION > 0 && sessionId) {
    const entry = sessionUsage.get(sessionId);
    const current = entry?.totalTokens ?? 0;
    const remaining = Math.max(0, TOKEN_LIMIT_PER_SESSION - current);
    return { allowed: true, remaining, limit: TOKEN_LIMIT_PER_SESSION, scope: "session", currentUsage: current };
  }

  return { allowed: true, remaining: -1, limit: 0, scope: "none", currentUsage: 0 };
}

/**
 * Get global token usage totals for /metrics.
 */
export function getGlobalTokenTotals() {
  return { ...globalTotals };
}

/**
 * Get token limit configuration (for API responses).
 */
export function getTokenLimitConfig() {
  return {
    perSession: TOKEN_LIMIT_PER_SESSION,
    perUserDaily: TOKEN_LIMIT_PER_USER_DAILY,
    sessionLimitEnabled: TOKEN_LIMIT_PER_SESSION > 0,
    userDailyLimitEnabled: TOKEN_LIMIT_PER_USER_DAILY > 0,
  };
}

// ── Persistence ──

function usageFilePath(): string {
  return join(USAGE_DATA_DIR, "token-usage.json");
}

function persistUsage(): void {
  if (!dirty) return;

  try {
    const data = {
      globalTotals: { ...globalTotals },
      sessions: Object.fromEntries(sessionUsage),
      userDaily: Object.fromEntries(
        Array.from(userDailyUsage.entries()).map(([k, v]) => [k, v])
      ),
      savedAt: new Date().toISOString(),
    };

    const filePath = usageFilePath();
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpPath, filePath);
    dirty = false;
  } catch (err) {
    console.error(`[TokenUsage] Failed to persist:`, (err as Error).message);
  }
}

function loadUsage(): void {
  const filePath = usageFilePath();
  if (!existsSync(filePath)) return;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);

    if (data.globalTotals) {
      globalTotals.promptTokens = data.globalTotals.promptTokens ?? 0;
      globalTotals.completionTokens = data.globalTotals.completionTokens ?? 0;
      globalTotals.totalTokens = data.globalTotals.totalTokens ?? 0;
      globalTotals.requestCount = data.globalTotals.requestCount ?? 0;
    }

    if (data.sessions && typeof data.sessions === "object") {
      for (const [id, entry] of Object.entries(data.sessions)) {
        sessionUsage.set(id, entry as TokenUsageEntry);
      }
    }

    if (data.userDaily && typeof data.userDaily === "object") {
      const today = todayDateString();
      for (const [id, bucket] of Object.entries(data.userDaily)) {
        const b = bucket as DailyUserBucket;
        // Only restore today's buckets — stale days are expired.
        if (b.date === today) {
          userDailyUsage.set(id, b);
        }
      }
    }

    console.log(`[TokenUsage] Loaded persisted usage: ${sessionUsage.size} session(s), ${userDailyUsage.size} user(s), ${globalTotals.totalTokens} total tokens.`);
  } catch (err) {
    console.error(`[TokenUsage] Failed to load persisted usage:`, (err as Error).message);
  }
}

// ── Lifecycle ──

let _flushTimer: ReturnType<typeof setInterval> | null = null;

export function initializeTokenUsage(): void {
  loadUsage();

  if (!_flushTimer) {
    _flushTimer = setInterval(persistUsage, FLUSH_INTERVAL_MS);
    _flushTimer.unref?.();
  }

  console.log(`[TokenUsage] Initialized. Limits: session=${TOKEN_LIMIT_PER_SESSION || "unlimited"}, userDaily=${TOKEN_LIMIT_PER_USER_DAILY || "unlimited"}.`);
}

export function shutdownTokenUsage(): void {
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }

  persistUsage();
  console.log("[TokenUsage] Shutdown complete.");
}
