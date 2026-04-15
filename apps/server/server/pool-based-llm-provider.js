/**
 * LLM Provider Pool Adapter for Agent Framework
 *
 * Generic adapter that wraps the existing LLMProviderPool to provide
 * a simple generate() interface for the multi-agent framework.
 *
 * Works with any provider in the pool (Kimi, DeepSeek, Groq, etc.)
 * Handles auto-failover, rate limiting, and retry logic.
 *
 * Interface:
 *   adapter.generate(prompt) → Promise<string>
 *   adapter.generateJson(prompt) → Promise<object>
 *   adapter.status() → object
 */

import "./env.js";
import { getPool } from "./llm-pool.js";

// ─── Helper: Sleep ───────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Helper: Make HTTP Request ──────────────────────────────────────

/**
 * Make chat completion request to provider endpoint
 * @private
 * @param {object} provider - Provider config from pool
 * @param {object} payload - Chat completion payload
 * @param {LLMProviderPool} pool - Pool instance for health tracking
 * @param {object} options - { mode, retryDelays }
 * @returns {Promise<object>} Parsed JSON response
 */
async function fetchChatCompletionFromProvider(provider, payload, pool, options = {}) {
  const mode = options.mode ?? "instant";
  const retryDelays = options.retryDelays ?? [100, 250];

  let lastError = null;
  let attempt = 0;

  while (attempt <= retryDelays.length) {
    try {
      // Apply provider-specific payload transform if available
      let enrichedPayload = payload;
      if (typeof provider.payloadTransform === "function") {
        enrichedPayload = provider.payloadTransform(payload, { mode });
      }

      // Set model
      enrichedPayload.model = enrichedPayload.model ?? provider.model;

      // Build endpoint
      const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;

      console.log(`[PoolAdapter] Request to ${provider.id} (attempt ${attempt + 1})`);

      const startMs = Date.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify(enrichedPayload),
        timeout: 30000
      });

      const durationMs = Date.now() - startMs;

      if (!response.ok) {
        const bodyText = await response.text();
        const err = new Error(`HTTP ${response.status}: ${bodyText.slice(0, 100)}`);

        // Retry on 429/503
        if ((response.status === 429 || response.status === 503) && attempt < retryDelays.length) {
          lastError = err;
          const backoffMs = retryDelays[attempt];
          console.log(`[PoolAdapter] Rate limited. Waiting ${backoffMs}ms`);
          await sleep(backoffMs);
          attempt += 1;
          continue;
        }

        throw err;
      }

      const json = await response.json();
      console.log(`[PoolAdapter] ${provider.id} responded in ${durationMs}ms`);

      // Track with pool
      if (pool && typeof pool.recordRequest === "function") {
        pool.recordRequest(provider.id, durationMs);
        pool.markHealthy(provider.id);
      }

      return json;

    } catch (error) {
      lastError = error;
      const isOverload = /overload|503|429|rate.limit/i.test(
        error instanceof Error ? error.message : String(error)
      );

      if (isOverload && attempt < retryDelays.length) {
        await sleep(retryDelays[attempt]);
        attempt += 1;
        continue;
      }

      break;
    }
  }

  throw lastError ?? new Error("Request failed");
}

// ─── Main Provider Pool Adapter ──────────────────────────────────────

/**
 * Generic LLM Provider Pool Adapter
 * Provides a simple generate() interface backed by the provider pool
 */
export class PoolBasedLLMProvider {
  /**
   * @param {LLMProviderPool} [pool] - Pool instance (uses singleton if not provided)
   * @param {object} [options] - Configuration options
   * @param {string} [options.mode] - 'thinking' or 'instant'
   * @param {string} [options.preferredProvider] - Prefer specific provider by ID
   * @param {boolean} [options.requireCodeGen] - Require code generation capability
   * @param {boolean} [options.requireThinking] - Require thinking capability
   */
  constructor(pool = null, options = {}) {
    this.pool = pool ?? getPool();
    this.mode = options.mode ?? "thinking";
    this.preferredProvider = options.preferredProvider ?? null;
    this.requireCodeGen = options.requireCodeGen ?? true;
    this.requireThinking = options.requireThinking ?? (options.mode === "thinking");

    this._stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      lastRequestMs: 0,
      lastErrorMs: 0,
      providerUsage: {}
    };
  }

  /**
   * Select best available provider from pool
   * @private
   * @returns {{ provider: object, waitMs: number } | null}
   */
  _selectProvider() {
    const filter = {};

    if (this.requireCodeGen) {
      filter.requireCodeGeneration = true;
    }

    if (this.requireThinking && this.mode === "thinking") {
      filter.requireThinking = true;
    }

    return this.pool.acquire(filter);
  }

  /**
   * Generate response from a prompt
   * @param {string} prompt - The prompt to send
   * @param {object} options - Additional options
   * @returns {Promise<string>} The response text
   */
  async generate(prompt, options = {}) {
    const startMs = Date.now();
    this._stats.totalRequests += 1;
    this._stats.lastRequestMs = startMs;

    try {
      // Select provider
      const selection = this._selectProvider();

      if (!selection) {
        const msg = "No LLM providers available (all disabled or filtered)";
        console.error(`[PoolAdapter] ${msg}`);
        throw new Error(msg);
      }

      const { provider, waitMs } = selection;

      if (waitMs > 0) {
        console.log(`[PoolAdapter] Waiting ${waitMs}ms for ${provider.id} to recover`);
        await sleep(waitMs);
      }

      // Prepare request
      const payload = {
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      };

      const requestOptions = {
        mode: options.mode ?? this.mode,
        retryDelays: [100, 250]
      };

      console.log(`[PoolAdapter] Generating with ${provider.id} (${this.mode} mode)`);

      // Make direct HTTP request to provider
      const response = await fetchChatCompletionFromProvider(provider, payload, this.pool, requestOptions);

      // Track provider usage
      if (!this._stats.providerUsage[provider.id]) {
        this._stats.providerUsage[provider.id] = 0;
      }
      this._stats.providerUsage[provider.id] += 1;

      // Extract content
      const content = response?.choices?.[0]?.message?.content ?? "";

      if (!content) {
        throw new Error("Empty response from provider");
      }

      this._stats.successfulRequests += 1;
      const latency = Date.now() - startMs;
      this._stats.totalLatencyMs += latency;

      console.log(`[PoolAdapter] Generated (${latency}ms via ${provider.id}): ${content.slice(0, 60)}...`);
      return content;

    } catch (error) {
      this._stats.failedRequests += 1;
      this._stats.lastErrorMs = Date.now();

      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[PoolAdapter] Generation failed: ${msg}`);

      throw error;
    }
  }

  /**
   * Generate and parse JSON response
   * @param {string} prompt - The prompt to send (should request JSON)
   * @param {object} options - Additional options
   * @returns {Promise<object>} Parsed JSON response
   */
  async generateJson(prompt, options = {}) {
    const text = await this.generate(prompt, options);

    try {
      // Try to extract JSON from markdown code block first
      const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // Otherwise try to parse the whole thing as JSON
      return JSON.parse(text);
    } catch (error) {
      console.error(`[PoolAdapter] Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`Response was: ${text.slice(0, 200)}`);
      throw new Error(`Invalid JSON response: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  /**
   * Get provider status and stats
   * @returns {object} Status object
   */
  status() {
    const poolStatus = this.pool.getStatus();
    const avgLatency = this._stats.totalRequests > 0
      ? Math.round(this._stats.totalLatencyMs / this._stats.totalRequests)
      : 0;

    return {
      adapter: "pool-based",
      pool: poolStatus,
      stats: {
        totalRequests: this._stats.totalRequests,
        successfulRequests: this._stats.successfulRequests,
        failedRequests: this._stats.failedRequests,
        successRate: this._stats.totalRequests > 0
          ? ((this._stats.successfulRequests / this._stats.totalRequests) * 100).toFixed(1) + "%"
          : "N/A",
        avgLatencyMs: avgLatency,
        lastRequestMs: this._stats.lastRequestMs,
        lastErrorMs: this._stats.lastErrorMs,
        providerUsage: this._stats.providerUsage
      }
    };
  }

  /**
   * Reset stats (useful for testing)
   */
  resetStats() {
    this._stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      lastRequestMs: 0,
      lastErrorMs: 0,
      providerUsage: {}
    };
  }
}

// ─── Factory Functions ──────────────────────────────────────────────

/**
 * Create a pool-based LLM provider adapter
 * @param {object} options - Configuration options
 * @returns {PoolBasedLLMProvider} Provider adapter
 */
export function createPoolBasedProvider(options = {}) {
  return new PoolBasedLLMProvider(null, options);
}

/**
 * Create a pool-based provider with specific configuration
 * @param {object} poolOptions - LLMProviderPool options
 * @param {object} adapterOptions - PoolBasedLLMProvider options
 * @returns {PoolBasedLLMProvider}
 */
export function createPoolBasedProviderWithConfig(poolOptions = {}, adapterOptions = {}) {
  // Note: The pool is a singleton, so poolOptions won't override existing pool
  // If you need a custom pool, reset it first:
  // import { resetPool } from './llm-pool.js';
  // resetPool(poolOptions);
  const pool = getPool();
  return new PoolBasedLLMProvider(pool, adapterOptions);
}

// ─── Singleton ──────────────────────────────────────────────────────

let _defaultProvider = null;

/**
 * Get or create default pool-based provider (singleton)
 * @returns {PoolBasedLLMProvider}
 */
export function getPoolBasedProvider() {
  if (!_defaultProvider) {
    _defaultProvider = new PoolBasedLLMProvider(getPool(), {
      mode: "thinking"
    });
  }
  return _defaultProvider;
}

/**
 * Reset default provider (useful for testing)
 * @param {object} options - Configuration options
 * @returns {PoolBasedLLMProvider}
 */
export function resetPoolBasedProvider(options = {}) {
  _defaultProvider = new PoolBasedLLMProvider(getPool(), options);
  return _defaultProvider;
}

// ─── Exports ────────────────────────────────────────────────────────

export default PoolBasedLLMProvider;
