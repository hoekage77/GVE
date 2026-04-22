import { getPool } from "../llm-pool.js";
import { sleep, truncateDiagnostic } from "../lib/utils.js";

export function providerMatchesFilter(provider: any, filter: any = {}): boolean {
  if (!provider?.hasApiKey) {
    return false;
  }

  if (filter.requireThinking && !provider.capabilities?.thinking) {
    return false;
  }

  if (filter.requireCodeGeneration && !provider.capabilities?.codeGeneration) {
    return false;
  }

  if (filter.requireVision && !provider.capabilities?.vision) {
    return false;
  }

  return true;
}

export function countEligibleProviders(pool: any, filter: any = {}): number {
  return pool.providers.filter((provider: any) => providerMatchesFilter(provider, filter)).length;
}

export function createRetryableProviderError(message: string, code = "PROVIDER_RETRYABLE_FAILURE"): any {
  const error: any = new Error(message);
  error.code = code;
  error.retryable = true;
  return error;
}

export function isRetryableProviderFailure(error: any): boolean {
  if (error?.retryable === true) {
    return true;
  }

  if (error?.status === 429 || error?.code === "PROVIDER_RATE_LIMITED") {
    return true;
  }

  const text = String(error?.message ?? "").toLowerCase();
  return /(timed? ?out|overloaded|engine_overloaded|temporarily|connection reset|socket hang up)/i.test(text);
}

export function getRetryableProviderFailureReason(error: any): string {
  if (error?.status === 429 || error?.code === "PROVIDER_RATE_LIMITED") {
    return "429";
  }

  const text = String(error?.message ?? "").toLowerCase();
  if (/timed? ?out/i.test(text)) {
    return "timeout";
  }

  if (/(overloaded|engine_overloaded|temporarily)/i.test(text)) {
    return "overloaded";
  }

  return truncateDiagnostic(error?.code ?? error?.message ?? "provider_failure", 96) ?? "provider_failure";
}

export function buildLlmSourceMetadata({ providerId, model, attempts }: { providerId: string | null; model: string | null; attempts: any[] }): any {
  const normalizedAttempts = Array.isArray(attempts)
    ? attempts.map((attempt) => ({
      providerId: attempt.providerId,
      model: attempt.model,
      status: attempt.status,
      reason: attempt.reason ?? null,
      retryable: Boolean(attempt.retryable)
    }))
    : [];

  return {
    providerId: providerId ?? null,
    model: model ?? null,
    fallbackUsed: normalizedAttempts.length > 1,
    attemptCount: normalizedAttempts.length,
    attempts: normalizedAttempts
  };
}

export async function executeWithProviderFailover(options: any = {}): Promise<any> {
  const operationName = options.operationName ?? "LLMOperation";
  const filter = options.filter ?? {};
  const mode = options.mode ?? "instant";
  const retryDelays = Array.isArray(options.retryDelays) ? options.retryDelays : [150, 350];
  const maxCooldownWaitMs = Number.isFinite(options.maxCooldownWaitMs)
    ? Math.max(0, options.maxCooldownWaitMs)
    : 15_000;
  const executeProvider = options.executeProvider;

  if (typeof executeProvider !== "function") {
    throw new Error(`${operationName} requires executeProvider callback.`);
  }

  const pool = getPool();
  const maxAttempts = countEligibleProviders(pool, filter);

  if (maxAttempts === 0) {
    const error: any = new Error(`${operationName} has no eligible LLM providers configured.`);
    error.code = "NO_ELIGIBLE_LLM_PROVIDER";
    throw error;
  }

  const triedProviders = new Set();
  const attempts = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const acquired = pool.acquire(filter);
    if (!acquired) {
      break;
    }

    const { provider, waitMs } = acquired;
    const resolvedModel = provider.model;

    if (triedProviders.has(provider.id)) {
      if (waitMs > 0 && waitMs <= maxCooldownWaitMs) {
        await sleep(waitMs);
      } else {
        break;
      }
    }

    triedProviders.add(provider.id);
    const requestStartedAt = Date.now();

    try {
      const value = await executeProvider({
        provider,
        mode,
        retryDelays,
        attempt: attempt + 1,
        maxAttempts
      });

      pool.recordRequest(provider.id, Date.now() - requestStartedAt);
      pool.markHealthy(provider.id);

      attempts.push({
        providerId: provider.id,
        model: resolvedModel,
        status: "success",
        reason: null,
        retryable: false
      });

      return {
        value,
        provider,
        model: resolvedModel,
        llm: buildLlmSourceMetadata({
          providerId: provider.id,
          model: resolvedModel,
          attempts
        })
      };
    } catch (error: any) {
      const retryable = isRetryableProviderFailure(error);
      const reason = truncateDiagnostic(error?.code ?? error?.message ?? "provider_failure", 180);

      attempts.push({
        providerId: provider.id,
        model: resolvedModel,
        status: "failed",
        reason,
        retryable
      });

      if (retryable) {
        pool.markExhausted(provider.id, getRetryableProviderFailureReason(error));
        continue;
      }

      if (!error.llm) {
        error.llm = buildLlmSourceMetadata({
          providerId: provider.id,
          model: resolvedModel,
          attempts
        });
      }

      throw error;
    }
  }

  const exhaustedError: any = new Error(`${operationName}: all eligible LLM providers were exhausted.`);
  exhaustedError.code = "ALL_LLM_PROVIDERS_EXHAUSTED";
  exhaustedError.llm = buildLlmSourceMetadata({
    providerId: null,
    model: null,
    attempts
  });
  throw exhaustedError;
}
