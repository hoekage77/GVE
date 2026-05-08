/**
 * LLM Streaming — Unified SSE streaming with tool_calls delta reassembly.
 *
 * All LLM calls in the agent coordinator, conversation, vision analysis,
 * and code analysis paths go through this module. It handles:
 *   - SSE chunk parsing and reassembly
 *   - tool_calls delta accumulation (index-based)
 *   - reasoning_content accumulation
 *   - Retry with configurable delays
 *   - Provider-specific payload transforms and caching hints
 *   - Token usage recording
 */

import { sleep } from "../lib/utils.js";
import { recordTokenUsage } from "../state/token-usage.js";
import { traceEvent } from "../trace/events.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface StreamedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface StreamedCompletion {
  content: string;
  reasoningContent: string;
  toolCalls: StreamedToolCall[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
  finishReason: string | null;
}

export interface StreamCallbacks {
  onToken?: (token: string) => void | Promise<void>;
  onReasoningToken?: (token: string) => void | Promise<void>;
}

export interface StreamOptions {
  mode?: string;
  retryDelays?: number[];
  sessionId?: string;
  callbacks?: StreamCallbacks;
  maxTokensOverride?: number;
}

// ─── SSE Parsing ────────────────────────────────────────────────────────

interface SSEChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    delta: {
      content?: string;
      role?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: any;
}

function parseSSELine(line: string): SSEChunk | "[DONE]" | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  if (trimmed === "[DONE]") return "[DONE]";
  if (!trimmed.startsWith("data: ")) return null;
  const jsonStr = trimmed.slice(6).trim();
  if (!jsonStr) return null;
  try { return JSON.parse(jsonStr) as SSEChunk; } catch { return null; }
}

// ─── Main Streaming Function ────────────────────────────────────────────

/**
 * Stream a chat completion via SSE with full tool_calls and reasoning
 * delta reassembly. Returns the fully assembled result.
 *
 * This is the single entry point for all LLM calls in the platform.
 */
export async function streamChatCompletion(
  provider: any,
  payload: any,
  options: StreamOptions = {}
): Promise<StreamedCompletion> {
  const retryDelays = options.retryDelays ?? [150, 350];
  let lastError: any = null;
  let attempt = 0;

  const resolvedPayload: any = {
    max_tokens: options.maxTokensOverride ?? Math.max(payload.max_tokens ?? provider.maxTokens ?? 8192, 16384),
    ...payload,
    model: payload.model ?? provider.model,
    stream: true,
  };

  while (attempt <= retryDelays.length) {
    let enrichedPayload = typeof provider.payloadTransform === "function"
      ? provider.payloadTransform.call(provider, resolvedPayload, { mode: options.mode })
      : resolvedPayload;

    enrichedPayload.stream = true;

    const endpoint = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        Accept: "text/event-stream",
      };

      const isFireworks = provider.id === "fireworks" || provider.baseUrl?.includes("fireworks.ai");
      if (isFireworks && options.sessionId) {
        headers["x-session-affinity"] = String(options.sessionId).slice(0, 64);
      }

      const fetchStartMs = Date.now();
      const fetchResponse = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(enrichedPayload),
      });

      if (!fetchResponse.ok) {
        const bodyText = await fetchResponse.text();
        const err: any = new Error(`${provider.id} stream failed (${fetchResponse.status}): ${bodyText.slice(0, 220)}`);
        err.status = fetchResponse.status;
        if (fetchResponse.status === 429) {
          err.code = "PROVIDER_RATE_LIMITED";
          throw err;
        }
        lastError = err;
        attempt++;
        if (attempt > retryDelays.length) throw err;
        await sleep(retryDelays[attempt - 1] ?? 150);
        continue;
      }

      if (!fetchResponse.body) {
        throw new Error("Stream response body is null");
      }

      // ── SSE parsing with delta reassembly ──
      let fullContent = "";
      let fullReasoning = "";
      let finishReason: string | null = null;
      let finalModel = enrichedPayload.model ?? provider.model ?? "unknown";
      let usage: any = null;
      const toolCallMap = new Map<number, StreamedToolCall>();

      const reader = fetchResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const parsed = parseSSELine(line);
          if (parsed === null || parsed === "[DONE]") continue;

          if (parsed.model) finalModel = parsed.model;
          if (parsed.usage) usage = parsed.usage;

          const choice = parsed?.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;

          // Accumulate content tokens
          if (delta?.content) {
            fullContent += delta.content;
            await options.callbacks?.onToken?.(delta.content);
          }

          // Accumulate reasoning tokens
          if ((delta as any)?.reasoning_content) {
            fullReasoning += (delta as any).reasoning_content;
            await options.callbacks?.onReasoningToken?.((delta as any).reasoning_content);
          }

          // Reassemble tool_calls deltas
          if (delta?.tool_calls) {
            for (const tcDelta of delta.tool_calls) {
              const idx = tcDelta.index ?? 0;
              let existing = toolCallMap.get(idx);
              if (!existing) {
                existing = {
                  id: tcDelta.id ?? `call-${Date.now()}-${idx}`,
                  name: tcDelta.function?.name ?? "",
                  arguments: "",
                };
                toolCallMap.set(idx, existing);
              }
              if (tcDelta.id) existing.id = tcDelta.id;
              if (tcDelta.function?.name) existing.name = tcDelta.function.name;
              if (tcDelta.function?.arguments) existing.arguments += tcDelta.function.arguments;
            }
          }

          if (choice.finish_reason && choice.finish_reason !== "null") {
            finishReason = choice.finish_reason;
          }
        }
      }

      const toolCalls = Array.from(toolCallMap.values());
      const durationMs = Date.now() - fetchStartMs;

      const finalUsage = usage ?? {
        prompt_tokens: Math.ceil(JSON.stringify(enrichedPayload.messages).length / 4),
        completion_tokens: Math.ceil(fullContent.length / 4),
        total_tokens: Math.ceil(JSON.stringify(enrichedPayload.messages).length / 4) + Math.ceil(fullContent.length / 4),
      };

      // Record token usage and trace
      recordTokenUsage(
        { providerId: provider.id, model: finalModel },
        finalUsage
      );

      traceEvent("llm.usage", {
        providerId: provider.id,
        model: finalModel,
        prompt_tokens: finalUsage.prompt_tokens,
        completion_tokens: finalUsage.completion_tokens,
        total_tokens: finalUsage.total_tokens,
        latencyMs: durationMs,
        streaming: true,
      });

      console.log(`[LLMStream] ${provider.id} completed (${durationMs}ms, ${fullContent.length} chars, ${toolCalls.length} tool_calls)`);

      return {
        content: fullContent,
        reasoningContent: fullReasoning,
        toolCalls,
        usage: finalUsage,
        model: finalModel,
        finishReason,
      };

    } catch (err: any) {
      if (err?.code === "PROVIDER_RATE_LIMITED" || err?.status === 429) throw err;
      lastError = err;
      attempt++;
      if (attempt > retryDelays.length) throw err;
      await sleep(retryDelays[attempt - 1] ?? 150);
    }
  }

  throw lastError ?? new Error(`${provider.id} stream failed.`);
}
