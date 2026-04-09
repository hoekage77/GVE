/**
 * LLM Provider Pool — Round-Robin Failover Manager
 *
 * Manages a pool of LLM providers with health tracking, automatic cooldown
 * rotation, and exponential backoff. When one provider is rate-limited (429)
 * or times out, the pool instantly switches to the next healthy provider.
 *
 * By the time we cycle through 3–5 providers (~1–3 minutes of cooldown),
 * the first provider's rate-limit window has typically reset.
 */

import { resolveProviders } from "./llm-provider.js";

// ─── Constants ───────────────────────────────────────────────────────

const HEALTH_STATES = Object.freeze({
  HEALTHY: "healthy",
  COOLDOWN: "cooldown",
  DISABLED: "disabled",
});

const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 300_000; // 5 minutes cap
const DEFAULT_LOG_LEVEL = process.env.LLM_POOL_LOG_LEVEL ?? "trace";

// ─── Logging ─────────────────────────────────────────────────────────

const LOG_LEVELS = { trace: 0, info: 1, warn: 2, error: 3, silent: 4 };

function shouldLog(level) {
  return (LOG_LEVELS[level] ?? 0) >= (LOG_LEVELS[DEFAULT_LOG_LEVEL] ?? 0);
}

function poolLog(level, message) {
  if (!shouldLog(level)) return;

  const prefix = `[LLMPool] [${level.toUpperCase()}]`;
  switch (level) {
    case "error":
      console.error(`${prefix} ${message}`);
      break;
    case "warn":
      console.warn(`${prefix} ${message}`);
      break;
    default:
      console.log(`${prefix} ${message}`);
      break;
  }
}

// ─── Health State ────────────────────────────────────────────────────

function createHealthState(provider) {
  return {
    state: provider.hasApiKey ? HEALTH_STATES.HEALTHY : HEALTH_STATES.DISABLED,
    cooldownUntilMs: 0,
    consecutiveFailures: 0,
    baseCooldownMs: provider.cooldownMs ?? DEFAULT_COOLDOWN_MS,
  };
}

// ─── Metrics ─────────────────────────────────────────────────────────

function createMetrics() {
  return {
    totalRequests: 0,
    totalFailures: 0,
    totalSuccesses: 0,
    totalLatencyMs: 0,
    lastRequestMs: 0,
    lastFailureMs: 0,
    lastSuccessMs: 0,
  };
}

// ─── Provider Pool Class ─────────────────────────────────────────────

export class LLMProviderPool {
  /**
   * @param {object} [options]
   * @param {Array} [options.providers] - Override the default provider list
   * @param {number} [options.defaultCooldownMs] - Override default cooldown
   */
  constructor(options = {}) {
    const rawProviders = options.providers ?? resolveProviders();
    this.providers = rawProviders.sort((a, b) => a.priority - b.priority);

    /** @type {Map<string, object>} */
    this.healthMap = new Map();

    /** @type {Map<string, object>} */
    this.metricsMap = new Map();

    // Global metrics
    this.totalGenerations = 0;
    this.fallbackCount = 0;

    // Initialize health and metrics for each provider
    for (const provider of this.providers) {
      this.healthMap.set(provider.id, createHealthState(provider));
      this.metricsMap.set(provider.id, createMetrics());
    }

    const enabledCount = this.providers.filter((p) => p.hasApiKey).length;
    const disabledCount = this.providers.length - enabledCount;

    poolLog("info", `Pool initialized with ${this.providers.length} providers (${enabledCount} enabled, ${disabledCount} disabled).`);

    for (const provider of this.providers) {
      const health = this.healthMap.get(provider.id);
      poolLog("trace", `  → ${provider.id}: ${health.state} (priority=${provider.priority}, hasKey=${provider.hasApiKey})`);
    }
  }

  // ─── Auto-Transition Cooldown → Healthy ──────────────────────────

  /**
   * Checks and transitions providers whose cooldown has expired
   * back to healthy state.
   */
  _refreshCooldowns() {
    const now = Date.now();
    for (const [id, health] of this.healthMap) {
      if (health.state === HEALTH_STATES.COOLDOWN && now >= health.cooldownUntilMs) {
        health.state = HEALTH_STATES.HEALTHY;
        health.consecutiveFailures = 0;
        poolLog("trace", `${id} cooldown expired → healthy.`);
      }
    }
  }

  // ─── Provider Selection ──────────────────────────────────────────

  /**
   * Selects the next healthy provider by priority.
   * If no providers are healthy, returns the one with the shortest remaining cooldown.
   *
   * @param {object} [filter] - Optional filter criteria
   * @param {boolean} [filter.requireThinking] - Only select providers with thinking capability
   * @param {boolean} [filter.requireCodeGeneration] - Only select code-gen capable providers
   * @param {boolean} [filter.requireVision] - Only select providers with vision capability
   * @returns {{ provider: object, waitMs: number } | null}
   *   - provider: the selected provider object
   *   - waitMs: 0 if healthy, or ms to wait if in cooldown
   *   - null if all providers are disabled
   */
  acquire(filter = {}) {
    this._refreshCooldowns();

    const candidates = this.providers.filter((p) => {
      const health = this.healthMap.get(p.id);
      if (health.state === HEALTH_STATES.DISABLED) return false;
      if (filter.requireThinking && !p.capabilities?.thinking) return false;
      if (filter.requireCodeGeneration && !p.capabilities?.codeGeneration) return false;
      if (filter.requireVision && !p.capabilities?.vision) return false;
      return true;
    });

    if (candidates.length === 0) {
      poolLog("error", "No providers available (all disabled or filtered out).");
      return null;
    }

    // Find first healthy provider by priority
    const healthy = candidates.filter(
      (p) => this.healthMap.get(p.id).state === HEALTH_STATES.HEALTHY
    );

    if (healthy.length > 0) {
      const selected = healthy[0]; // Already sorted by priority
      const healthyCount = healthy.length;
      const totalCount = candidates.length;
      poolLog("trace", `Acquired provider: ${selected.id} (priority=${selected.priority}, healthy=${healthyCount}/${totalCount})`);
      return { provider: selected, waitMs: 0 };
    }

    // All candidates are in cooldown — find the one that recovers soonest
    const now = Date.now();
    let soonest = null;
    let soonestWaitMs = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      const health = this.healthMap.get(candidate.id);
      const waitMs = Math.max(0, health.cooldownUntilMs - now);
      if (waitMs < soonestWaitMs) {
        soonest = candidate;
        soonestWaitMs = waitMs;
      }
    }

    if (soonest) {
      poolLog("warn", `All providers in cooldown. Shortest wait: ${soonest.id} (${soonestWaitMs}ms).`);
      return { provider: soonest, waitMs: soonestWaitMs };
    }

    return null;
  }

  // ─── State Transitions ───────────────────────────────────────────

  /**
   * Mark a provider as exhausted (429 / timeout).
   * Enters cooldown with exponential backoff based on consecutive failures.
   *
   * @param {string} id - Provider identifier
   * @param {string} [reason] - Optional human-readable reason
   */
  markExhausted(id, reason = "rate-limited") {
    const health = this.healthMap.get(id);
    if (!health) {
      poolLog("warn", `markExhausted called for unknown provider: ${id}`);
      return;
    }

    health.consecutiveFailures += 1;

    // Exponential backoff: base * 2^(failures-1), capped at MAX_COOLDOWN_MS
    const backoffMs = Math.min(
      health.baseCooldownMs * Math.pow(2, health.consecutiveFailures - 1),
      MAX_COOLDOWN_MS
    );

    health.state = HEALTH_STATES.COOLDOWN;
    health.cooldownUntilMs = Date.now() + backoffMs;

    // Update metrics
    const metrics = this.metricsMap.get(id);
    if (metrics) {
      metrics.totalFailures += 1;
      metrics.lastFailureMs = Date.now();
    }

    // Find next available provider for the log message
    const next = this.acquire();
    const nextLabel = next ? `Next: ${next.provider.id}${next.waitMs > 0 ? ` (wait ${next.waitMs}ms)` : ""}` : "No alternatives available";

    poolLog("warn", `${id} exhausted (${reason}). Cooldown ${Math.round(backoffMs / 1000)}s (failure #${health.consecutiveFailures}). ${nextLabel}`);
  }

  /**
   * Mark a provider as healthy after a successful request.
   * Resets consecutive failure counter and cooldown.
   *
   * @param {string} id - Provider identifier
   */
  markHealthy(id) {
    const health = this.healthMap.get(id);
    if (!health) return;

    if (health.state === HEALTH_STATES.DISABLED) return;

    health.state = HEALTH_STATES.HEALTHY;
    health.consecutiveFailures = 0;
    health.cooldownUntilMs = 0;

    // Update metrics
    const metrics = this.metricsMap.get(id);
    if (metrics) {
      metrics.totalSuccesses += 1;
      metrics.lastSuccessMs = Date.now();
    }
  }

  /**
   * Record a completed request's latency for metrics.
   *
   * @param {string} id - Provider identifier
   * @param {number} durationMs - Request duration in milliseconds
   */
  recordRequest(id, durationMs) {
    const metrics = this.metricsMap.get(id);
    if (!metrics) return;

    metrics.totalRequests += 1;
    metrics.totalLatencyMs += durationMs;
    metrics.lastRequestMs = Date.now();
    this.totalGenerations += 1;
  }

  /**
   * Increment the global fallback counter.
   */
  recordFallback() {
    this.fallbackCount += 1;
  }

  // ─── Diagnostics ─────────────────────────────────────────────────

  /**
   * Returns a snapshot of the pool status for diagnostics/monitoring.
   *
   * @returns {object} Pool status object
   */
  getStatus() {
    this._refreshCooldowns();
    const now = Date.now();

    const providers = this.providers.map((p) => {
      const health = this.healthMap.get(p.id);
      const metrics = this.metricsMap.get(p.id);
      const cooldownRemainingMs =
        health.state === HEALTH_STATES.COOLDOWN
          ? Math.max(0, health.cooldownUntilMs - now)
          : 0;

      return {
        id: p.id,
        name: p.name,
        priority: p.priority,
        state: health.state,
        cooldownRemainingMs,
        consecutiveFailures: health.consecutiveFailures,
        totalRequests: metrics?.totalRequests ?? 0,
        totalFailures: metrics?.totalFailures ?? 0,
        totalSuccesses: metrics?.totalSuccesses ?? 0,
        avgResponseMs:
          metrics?.totalRequests > 0
            ? Math.round(metrics.totalLatencyMs / metrics.totalRequests)
            : 0,
      };
    });

    const totalRequests = providers.reduce((sum, p) => sum + p.totalRequests, 0);
    const totalLatency = Array.from(this.metricsMap.values()).reduce(
      (sum, m) => sum + m.totalLatencyMs,
      0
    );

    return {
      providers,
      totalGenerations: this.totalGenerations,
      fallbackCount: this.fallbackCount,
      avgResponseMs: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
    };
  }

  /**
   * Logs a compact one-line pool status summary.
   */
  logStatus() {
    this._refreshCooldowns();
    const now = Date.now();
    const parts = this.providers
      .filter((p) => this.healthMap.get(p.id).state !== HEALTH_STATES.DISABLED)
      .map((p) => {
        const health = this.healthMap.get(p.id);
        if (health.state === HEALTH_STATES.COOLDOWN) {
          const remainingSecs = Math.round((health.cooldownUntilMs - now) / 1000);
          return `${p.id}=cooldown(${remainingSecs}s left)`;
        }
        return `${p.id}=${health.state}`;
      });

    poolLog("trace", `Pool status: ${parts.join(" ")}`);
  }
}

// ─── Singleton Pool Instance ──────────────────────────────────────────

let _poolInstance = null;

/**
 * Returns the singleton LLMProviderPool instance.
 * Created lazily on first call.
 *
 * @returns {LLMProviderPool}
 */
export function getPool() {
  if (!_poolInstance) {
    _poolInstance = new LLMProviderPool();
  }
  return _poolInstance;
}

/**
 * Resets the singleton pool (useful for testing).
 *
 * @param {object} [options] - Options to pass to the new pool.
 * @returns {LLMProviderPool}
 */
export function resetPool(options = {}) {
  _poolInstance = new LLMProviderPool(options);
  return _poolInstance;
}
