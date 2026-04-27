/**
 * LLM Provider Pool Adapter
 *
 * Wraps the LLMProviderPool to provide a simple generate() interface.
 * Handles auto-failover, rate limiting, and retry logic.
 */

import "../env.js";
import { getPool, type LLMProviderPool } from "./pool.js";
import { sleep } from "../lib/utils.js";
import type { ResolvedProvider, ChatCompletionPayload, ChatCompletionResponse } from "../types/llm.js";
import { traceEvent } from "../trace/events.js";
import { recordTokenUsage } from "../state/token-usage.js";

// ─── Helper: Make HTTP Request ──────────────────────────────────────

interface FetchOptions {
  mode?: string;
  retryDelays?: number[];
}

async function fetchChatCompletionFromProvider(
  provider: ResolvedProvider,
  payload: ChatCompletionPayload,
  pool: LLMProviderPool | null,
  options: FetchOptions = {}
): Promise<ChatCompletionResponse> {
  const mode = options.mode ?? "instant";
  const retryDelays = options.retryDelays ?? [100, 250];

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= retryDelays.length) {
    try {
      let enrichedPayload: ChatCompletionPayload = { max_tokens: 8192, ...payload };
      if (typeof provider.payloadTransform === "function") {
        enrichedPayload = provider.payloadTransform(enrichedPayload, { mode });
      }

      enrichedPayload.model = enrichedPayload.model ?? provider.model;

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
      });

      const durationMs = Date.now() - startMs;

      if (!response.ok) {
        const bodyText = await response.text();
        const err = new Error(`HTTP ${response.status}: ${bodyText.slice(0, 100)}`);

        if ((response.status === 429 || response.status === 503) && attempt < retryDelays.length) {
          lastError = err;
          const backoffMs = retryDelays[attempt]!;
          console.log(`[PoolAdapter] Rate limited. Waiting ${backoffMs}ms`);
          await sleep(backoffMs);
          attempt += 1;
          continue;
        }

        throw err;
      }

      const json = await response.json() as ChatCompletionResponse;
      console.log(`[PoolAdapter] ${provider.id} responded in ${durationMs}ms`);

      if (json?.usage) {
        traceEvent("llm.usage", {
          providerId: provider.id,
          model: json.model ?? enrichedPayload.model ?? provider.model ?? null,
          prompt_tokens: json.usage.prompt_tokens,
          completion_tokens: json.usage.completion_tokens,
          total_tokens: json.usage.total_tokens,
          latencyMs: durationMs
        });

        recordTokenUsage(
          { providerId: provider.id, model: json.model ?? enrichedPayload.model ?? provider.model ?? null },
          json.usage
        );
      } else {
        traceEvent("llm.response", {
          providerId: provider.id,
          model: json?.model ?? enrichedPayload.model ?? provider.model ?? null,
          latencyMs: durationMs
        });
      }

      if (pool && typeof pool.recordRequest === "function") {
        pool.recordRequest(provider.id, durationMs);
        pool.markHealthy(provider.id);
      }

      return json;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isOverload = /overload|503|429|rate.limit/i.test(lastError.message);

      if (isOverload && attempt < retryDelays.length) {
        await sleep(retryDelays[attempt]!);
        attempt += 1;
        continue;
      }

      break;
    }
  }

  throw lastError ?? new Error("Request failed");
}

// ─── Main Provider Pool Adapter ──────────────────────────────────────

interface AdapterOptions {
  mode?: string;
  preferredProvider?: string | null;
  requireCodeGen?: boolean;
  requireThinking?: boolean;
}

interface AdapterStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalLatencyMs: number;
  lastRequestMs: number;
  lastErrorMs: number;
  providerUsage: Record<string, number>;
}

export class PoolBasedLLMProvider {
  pool: LLMProviderPool;
  mode: string;
  preferredProvider: string | null;
  requireCodeGen: boolean;
  requireThinking: boolean;
  private _stats: AdapterStats;

  constructor(pool: LLMProviderPool | null = null, options: AdapterOptions = {}) {
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

  private _selectProvider() {
    const filter: { requireCodeGeneration?: boolean; requireThinking?: boolean } = {};

    if (this.requireCodeGen) {
      filter.requireCodeGeneration = true;
    }

    if (this.requireThinking && this.mode === "thinking") {
      filter.requireThinking = true;
    }

    return this.pool.acquire(filter);
  }

  async generate(prompt: string, options: { mode?: string } = {}): Promise<string> {
    const startMs = Date.now();
    this._stats.totalRequests += 1;
    this._stats.lastRequestMs = startMs;

    try {
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

      const payload: ChatCompletionPayload = {
        messages: [{ role: "user", content: prompt }]
      };

      const requestOptions: FetchOptions = {
        mode: options.mode ?? this.mode,
        retryDelays: [100, 250]
      };

      const resolvedModel = payload.model ?? provider.model;
      const resolvedPayload = { max_tokens: 8192, ...payload, model: resolvedModel };

      console.log(`[LLMPool] [TRACE] fetchChatCompletion called. provider=${provider.id}, model=${resolvedModel}, mode=${options.mode ?? this.mode}`);

      console.log(`[PoolAdapter] Generating with ${provider.id} (${this.mode} mode)`);

      const response = await fetchChatCompletionFromProvider(provider, resolvedPayload, this.pool, requestOptions);

      if (!this._stats.providerUsage[provider.id]) {
        this._stats.providerUsage[provider.id] = 0;
      }
      this._stats.providerUsage[provider.id]! += 1;

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

  async generateJson(prompt: string, options: { mode?: string } = {}): Promise<unknown> {
    const text = await this.generate(prompt, options);

    try {
      const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]!);
      }

      return JSON.parse(text);
    } catch (error) {
      console.error(`[PoolAdapter] Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`Response was: ${text.slice(0, 200)}`);
      throw new Error(`Invalid JSON response: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  status() {
    const poolStatus = this.pool.getStatus();
    const avgLatency = this._stats.totalRequests > 0
      ? Math.round(this._stats.totalLatencyMs / this._stats.totalRequests)
      : 0;

    return {
      adapter: "pool-based" as const,
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

  resetStats(): void {
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

export function createPoolBasedProvider(options: AdapterOptions = {}): PoolBasedLLMProvider {
  return new PoolBasedLLMProvider(null, options);
}

export function createPoolBasedProviderWithConfig(poolOptions = {}, adapterOptions: AdapterOptions = {}): PoolBasedLLMProvider {
  const pool = getPool();
  return new PoolBasedLLMProvider(pool, adapterOptions);
}

// ─── Singleton ──────────────────────────────────────────────────────

let _defaultProvider: PoolBasedLLMProvider | null = null;

export function getPoolBasedProvider(): PoolBasedLLMProvider {
  if (!_defaultProvider) {
    _defaultProvider = new PoolBasedLLMProvider(getPool(), { mode: "thinking" });
  }
  return _defaultProvider;
}

export function resetPoolBasedProvider(options: AdapterOptions = {}): PoolBasedLLMProvider {
  _defaultProvider = new PoolBasedLLMProvider(getPool(), options);
  return _defaultProvider;
}

export default PoolBasedLLMProvider;
