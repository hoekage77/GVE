/**
 * Client Validation Cache — Stores browser-side validation results keyed by session.
 *
 * When the browser validates generated JS code using real WebGL/Canvas,
 * it sends results back via WebSocket. This cache holds them so the
 * server can reference them on subsequent turns (e.g., to include
 * error context in the next code generation).
 */

export interface CachedValidationResult {
  sessionId: string;
  skillId: string;
  success: boolean;
  status: "completed" | "error" | "timeout";
  durationMs: number;
  renderCount: number;
  frameCount: number;
  logs: { level: string; message: string; timestamp: string }[];
  summary: { childCount: number; types: string[] };
  error: string | null;
  frameBudgetReached?: boolean;
  deviceInfo?: { gpuRenderer: string; gpuVendor?: string };
  receivedAt: number;
}

const cache = new Map<string, CachedValidationResult[]>();
const MAX_ENTRIES_PER_SESSION = 50;

function getSessionKey(sessionId: string, skillId?: string): string {
  return skillId ? `${sessionId}:${skillId}` : sessionId;
}

export function storeClientValidationResult(
  sessionId: string,
  result: Omit<CachedValidationResult, "receivedAt">
): CachedValidationResult {
  const entry: CachedValidationResult = { ...result, receivedAt: Date.now() };
  const key = getSessionKey(sessionId, result.skillId);

  const existing = cache.get(key) ?? [];
  existing.push(entry);

  // Prune old entries per session
  while (existing.length > MAX_ENTRIES_PER_SESSION) {
    existing.shift();
  }

  cache.set(key, existing);
  return entry;
}

export function getClientValidationResults(sessionId: string, skillId?: string): CachedValidationResult[] {
  const key = getSessionKey(sessionId, skillId);
  return (cache.get(key) ?? []).slice();
}

export function getLatestClientValidationResult(sessionId: string, skillId?: string): CachedValidationResult | null {
  const results = getClientValidationResults(sessionId, skillId);
  return results.length > 0 ? (results.at(-1) ?? null) : null;
}

export function hasClientValidationFailed(sessionId: string, skillId?: string): boolean {
  const latest = getLatestClientValidationResult(sessionId, skillId);
  if (!latest) return false;
  return !latest.success || latest.status === "error" || latest.status === "timeout";
}

export function getClientErrorContext(sessionId: string, skillId?: string): string | null {
  const latest = getLatestClientValidationResult(sessionId, skillId);
  if (!latest || latest.success) return null;

  const errorParts: string[] = [];
  if (latest.error) errorParts.push(`Error: ${latest.error}`);

  const errorLogs = latest.logs.filter((l) => l.level === "error" || l.level === "warn");
  if (errorLogs.length > 0) {
    errorParts.push(
      `Logs: ${errorLogs.slice(0, 5).map((l) => l.message).join("; ")}`
    );
  }

  return errorParts.length > 0 ? errorParts.join(". ") : null;
}

export function clearClientValidationCache(sessionId: string, skillId?: string): void {
  const key = getSessionKey(sessionId, skillId);
  if (skillId) {
    cache.delete(key);
  } else {
    // Clear all entries for this session across all skills
    for (const [k] of cache) {
      if (k.startsWith(`${sessionId}:`)) cache.delete(k);
    }
    cache.delete(sessionId);
  }
}