/**
 * LLM Provider Registry
 *
 * Defines all available LLM providers with their configuration, capabilities,
 * and rate-limit profiles. Each provider exposes an OpenAI-compatible
 * /chat/completions endpoint, so the abstraction layer is intentionally thin.
 *
 * Providers without a configured API key are automatically marked as `disabled`
 * by the pool manager and skipped during selection.
 */

import "./env.js";

// ─── Provider Definitions ────────────────────────────────────────────

const PROVIDER_DEFINITIONS = [
  {
    id: "gradient-kimi",
    name: "DigitalOcean Gradient - Kimi K2.5",
    baseUrl: process.env.GRADIENT_BASE_URL ?? "https://inference.do-ai.run/v1",
    model: "kimi-k2.5",
    apiKeyEnv: "GRADIENT_API_KEY",
    priority: 1,
    capabilities: {
      codeGeneration: true,
      thinking: true,
      vision: true,
      streaming: true,
    },
    limits: {
      rpm: 10,
      concurrency: 2,
    },
    cooldownMs: 30_000,
    payloadTransform: null,
  },

  {
    id: "moonshot",
    name: "Moonshot Kimi K2.5",
    baseUrl: process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.ai/v1",
    model: process.env.MOONSHOT_MODEL ?? "kimi-k2.5",
    apiKeyEnv: "MOONSHOT_API_KEY",
    priority: 2,
    capabilities: {
      codeGeneration: true,
      thinking: true,
      vision: true,
      streaming: true,
    },
    limits: {
      rpm: 3,
      concurrency: 1,
    },
    cooldownMs: 60_000,
    /**
     * Moonshot-specific payload transform.
     * Adds `extra_body.chat_template_kwargs.thinking` toggle for Kimi models.
     * Also forces temperature=1 for Kimi models.
     */
    payloadTransform(payload, options = {}) {
      const enriched = { ...payload };

      // Kimi models currently require temperature=1.
      if (/kimi/i.test(enriched.model ?? this.model)) {
        enriched.temperature = 1;
      }

      const mode = options.mode ?? "thinking";

      // In instant mode, explicitly disable thinking.
      if (mode === "instant") {
        const existingExtraBody = payload.extra_body ?? {};
        const existingTemplateArgs = existingExtraBody.chat_template_kwargs ?? {};
        enriched.extra_body = {
          ...existingExtraBody,
          chat_template_kwargs: {
            ...existingTemplateArgs,
            thinking: false,
          },
        };
      } else if (payload.extra_body) {
        enriched.extra_body = payload.extra_body;
      }

      return enriched;
    },
  },

  {
    id: "deepseek",
    name: "DeepSeek Chat",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    priority: 3,
    capabilities: {
      codeGeneration: true,
      thinking: true,
      vision: false,
      streaming: true,
    },
    limits: {
      rpm: 60,
      concurrency: 10,
    },
    cooldownMs: 30_000,
    payloadTransform: null,
  },

  {
    id: "gradient-deepseek",
    name: "DigitalOcean Gradient - DeepSeek R1 Distill Llama 70B",
    baseUrl: process.env.GRADIENT_BASE_URL ?? "https://inference.do-ai.run/v1",
    model: "deepseek-r1-distill-llama-70b",
    apiKeyEnv: "GRADIENT_API_KEY",
    priority: 4,
    capabilities: {
      codeGeneration: true,
      thinking: true,
      vision: false,
      streaming: true,
    },
    limits: {
      rpm: 10,
      concurrency: 2,
    },
    cooldownMs: 30_000,
    payloadTransform: null,
  },

  {
    id: "groq",
    name: "Groq Llama 3.3 70B",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
    priority: 5,
    capabilities: {
      codeGeneration: true,
      thinking: false,
      vision: false,
      streaming: true,
    },
    limits: {
      rpm: 30,
      concurrency: 5,
    },
    cooldownMs: 30_000,
    payloadTransform: null,
  },

  {
    id: "gemini",
    name: "Gemini 2.0 Flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    priority: 6,
    capabilities: {
      codeGeneration: true,
      thinking: false,
      vision: true,
      streaming: true,
    },
    limits: {
      rpm: 10,
      concurrency: 5,
    },
    cooldownMs: 30_000,
    payloadTransform: null,
  },

  {
    id: "together",
    name: "Together Qwen2.5-Coder-32B",
    baseUrl: "https://api.together.xyz/v1",
    model: "Qwen/Qwen2.5-Coder-32B-Instruct",
    apiKeyEnv: "TOGETHER_API_KEY",
    priority: 7,
    capabilities: {
      codeGeneration: true,
      thinking: false,
      vision: false,
      streaming: true,
    },
    limits: {
      rpm: 10,
      concurrency: 4,
    },
    cooldownMs: 30_000,
    payloadTransform: null,
  },
];

// ─── Provider Resolution ─────────────────────────────────────────────

/**
 * Resolves provider definitions into live provider objects with API keys resolved
 * from the environment. Providers with no API key are included (the pool manager
 * will mark them as `disabled`).
 *
 * @returns {Array<object>} Resolved provider list sorted by priority.
 */
export function resolveProviders() {
  return PROVIDER_DEFINITIONS
    .map((definition) => {
      const apiKey = process.env[definition.apiKeyEnv] ?? "";
      return {
        ...definition,
        apiKey: apiKey.trim(),
        hasApiKey: Boolean(apiKey.trim()),
      };
    })
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Returns only providers that have a configured API key.
 *
 * @returns {Array<object>} Enabled providers sorted by priority.
 */
export function resolveEnabledProviders() {
  return resolveProviders().filter((p) => p.hasApiKey);
}

/**
 * Look up a single provider by ID.
 *
 * @param {string} id - Provider identifier (e.g. "moonshot", "groq").
 * @returns {object|null} The resolved provider, or null if not found.
 */
export function getProviderById(id) {
  return resolveProviders().find((p) => p.id === id) ?? null;
}

/**
 * Returns only providers that support the thinking/reasoning mode.
 * Used for ThinkingAnalysis and PostTurnNarration calls.
 *
 * @returns {Array<object>} Thinking-capable providers with API keys.
 */
export function getThinkingProviders() {
  return resolveEnabledProviders().filter((p) => p.capabilities.thinking);
}

/**
 * Returns only providers that support code generation.
 *
 * @returns {Array<object>} Code-generation-capable providers with API keys.
 */
export function getCodeGenerationProviders() {
  return resolveEnabledProviders().filter((p) => p.capabilities.codeGeneration);
}

/**
 * Returns the raw definitions array for inspection/testing.
 *
 * @returns {Array<object>}
 */
export function getProviderDefinitions() {
  return [...PROVIDER_DEFINITIONS];
}
