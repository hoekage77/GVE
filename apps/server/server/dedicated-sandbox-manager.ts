import { SandboxPoolManager } from "@visual-runtime/sandbox-pool";
import { traceEvent } from "./trace/events.js";

type DedicatedSandboxRecord = {
  key: string;
  sandboxEnv: any;
  createdAtMs: number;
  lastUsedAtMs: number;
  hibernatedAtMs: number | null;
};

function parsePositiveIntEnv(rawValue: string | undefined | null, fallbackValue: number, minimum = 1): number {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.max(minimum, parsed);
}

function parseBooleanEnv(rawValue: string | undefined | null, fallbackValue: boolean): boolean {
  if (rawValue === undefined || rawValue === null || rawValue === "") return fallbackValue;
  const normalized = String(rawValue).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallbackValue;
}

export class DedicatedSandboxManager {
  private pool: SandboxPoolManager;
  private enabled: boolean;
  private idleHibernateMs: number;
  private hibernatedTtlMs: number;
  private records = new Map<string, DedicatedSandboxRecord>();
  private inflight = new Map<string, Promise<any>>();
  private reaper: NodeJS.Timeout | null = null;

  constructor(pool: SandboxPoolManager) {
    this.pool = pool;
    this.enabled = parseBooleanEnv(process.env.DEDICATED_SANDBOX_ENABLED, false);
    this.idleHibernateMs = parsePositiveIntEnv(process.env.DEDICATED_SANDBOX_IDLE_HIBERNATE_SECONDS, 900, 30) * 1000;
    this.hibernatedTtlMs = parsePositiveIntEnv(process.env.DEDICATED_SANDBOX_HIBERNATED_TTL_SECONDS, 86_400, 300) * 1000;

    const reaperIntervalMs = parsePositiveIntEnv(process.env.DEDICATED_SANDBOX_REAPER_INTERVAL_SECONDS, 30, 10) * 1000;
    this.reaper = setInterval(() => void this._reap(), reaperIntervalMs);
    this.reaper.unref?.();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getKey({ userId, sessionId }: { userId?: string | null; sessionId?: string | null }): string | null {
    const normalizedUserId = String(userId ?? "").trim();
    if (normalizedUserId) return `user:${normalizedUserId}`;
    const normalizedSessionId = String(sessionId ?? "").trim();
    if (normalizedSessionId) return `session:${normalizedSessionId}`;
    return null;
  }

  async acquireForKey(key: string, requirements: { skillId?: string; turnDeadlineAtMs?: number | null } = {}) {
    if (!this.enabled) {
      return this.pool.acquire(requirements);
    }

    const inflight = this.inflight.get(key);
    if (inflight) return inflight;

    const promise = (async () => {
      const now = Date.now();
      const existing = this.records.get(key) ?? null;

      if (existing?.sandboxEnv) {
        existing.lastUsedAtMs = now;

        // If previously hibernated, attempt resume best-effort.
        if (existing.hibernatedAtMs) {
          traceEvent("sandbox.dedicated.resume_attempt", { key, workspaceId: existing.sandboxEnv?.workspaceId ?? null });
          try {
            await this.pool.resume?.(existing.sandboxEnv, `dedicated_resume_${key}`);
            existing.hibernatedAtMs = null;
            traceEvent("sandbox.dedicated.resume_ok", { key, workspaceId: existing.sandboxEnv?.workspaceId ?? null });
          } catch (err) {
            traceEvent("sandbox.dedicated.resume_failed", { key, error: err instanceof Error ? err.message : String(err) });
          }
        }

        traceEvent("sandbox.dedicated.acquire_hit", { key, workspaceId: existing.sandboxEnv?.workspaceId ?? null });
        return existing.sandboxEnv;
      }

      traceEvent("sandbox.dedicated.acquire_miss", { key });
      const sandboxEnv = await this.pool.acquire(requirements);
      this.records.set(key, {
        key,
        sandboxEnv,
        createdAtMs: now,
        lastUsedAtMs: now,
        hibernatedAtMs: null
      });

      traceEvent("sandbox.dedicated.acquire_created", { key, workspaceId: sandboxEnv?.workspaceId ?? null });
      return sandboxEnv;
    })().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  async releaseForKey(key: string, sandboxEnv: any): Promise<void> {
    if (!this.enabled) {
      await this.pool.release(sandboxEnv);
      return;
    }

    const record = this.records.get(key);
    if (!record) {
      // Unknown key; best-effort release as normal.
      await this.pool.release(sandboxEnv);
      return;
    }

    // Dedicated sandboxes are retained. We only update activity timestamp.
    record.lastUsedAtMs = Date.now();
  }

  private async _reap(): Promise<void> {
    if (!this.enabled) return;

    const now = Date.now();
    for (const [key, record] of this.records) {
      const idleMs = now - record.lastUsedAtMs;

      // Step 1: hibernate when idle long enough.
      if (!record.hibernatedAtMs && idleMs >= this.idleHibernateMs) {
        traceEvent("sandbox.dedicated.hibernate_attempt", { key, idleMs, workspaceId: record.sandboxEnv?.workspaceId ?? null });
        try {
          if (typeof this.pool.hibernate === "function") {
            await this.pool.hibernate(record.sandboxEnv, `dedicated_idle_${key}`);
            record.hibernatedAtMs = Date.now();
            traceEvent("sandbox.dedicated.hibernate_ok", { key, workspaceId: record.sandboxEnv?.workspaceId ?? null });
          } else {
            // Fallback: delete via release path if pool doesn't support hibernate.
            await this.pool.release({ ...record.sandboxEnv, _reusable: false });
            this.records.delete(key);
            traceEvent("sandbox.dedicated.hibernate_deleted_fallback", { key });
          }
        } catch (err) {
          traceEvent("sandbox.dedicated.hibernate_failed", { key, error: err instanceof Error ? err.message : String(err) });
        }
        continue;
      }

      // Step 2: hard-delete hibernated sandboxes after TTL.
      if (record.hibernatedAtMs && (now - record.hibernatedAtMs) >= this.hibernatedTtlMs) {
        traceEvent("sandbox.dedicated.evict_attempt", { key, workspaceId: record.sandboxEnv?.workspaceId ?? null });
        try {
          await this.pool.release({ ...record.sandboxEnv, _reusable: false });
        } finally {
          this.records.delete(key);
          traceEvent("sandbox.dedicated.evict_ok", { key });
        }
      }
    }
  }
}

