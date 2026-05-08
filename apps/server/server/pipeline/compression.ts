/**
 * Tier 1 Context Compression — Kortix-style working memory truncation.
 *
 * Strategy (simplified from Kortix execution.py):
 *   1. Truncate tool result messages to 2000 chars (keep last 2 at 3000)
 *   2. Truncate user messages > 4000 chars
 *   3. Truncate assistant messages > 2000 chars
 *   4. Emergency: sort all messages by length, aggressively truncate > 1200
 *
 * The system prompt is never truncated.
 */

import { getEncoding, type Tiktoken } from "js-tiktoken";

const TIER1_TOOL_TRUNCATE = 2000;
const TIER1_TOOL_LAST_TRUNCATE = 3000;
const TIER1_USER_TRUNCATE = 4000;
const TIER1_ASSISTANT_TRUNCATE = 2000;
const EMERGENCY_TRUNCATE = 1200;

let _encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!_encoder) {
    _encoder = getEncoding("o200k_base");
  }
  return _encoder;
}

export function countTokens(text: string): number {
  try {
    return getEncoder().encode(text).length;
  } catch {
    return Math.ceil(text.length / 3.5);
  }
}

export function estimateTokens(text: string): number {
  return countTokens(text);
}

export function estimateMessageTokens(messages: Array<{ role: string; content: string | any[] }>): number {
  let total = 0;
  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    total += countTokens(text) + 4;
  }
  return total;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n... [truncated]";
}

function isToolResultMessage(message: any): boolean {
  return message.role === "tool" || (message.name && message.tool_call_id);
}

/**
 * Compress a message array in-place (returns a new array).
 * The first message (system prompt) is preserved entirely.
 */
export function compressWorkingMemory(
  messages: Array<{ role: string; content: string | any[]; name?: string; tool_call_id?: string }>,
  options: { contextWindow?: number; tokenThreshold?: number } = {}
): Array<{ role: string; content: string | any[]; name?: string; tool_call_id?: string }> {
  if (messages.length === 0) return messages;

  const contextWindow = options.contextWindow ?? 128_000;
  const tokenThreshold = options.tokenThreshold ?? Math.floor(contextWindow * 0.70);

  // Quick check: if under threshold, return as-is
  const currentTokens = estimateMessageTokens(messages);
  if (currentTokens <= tokenThreshold) {
    return messages;
  }

  const compressed = messages.map((m) => ({ ...m }));
  const systemMessage = compressed[0];
  if (!systemMessage) return messages;
  const workingMemory = compressed.slice(1);

  // Count tool result messages so we can keep the last 2 at higher limit
  const toolResultIndices = workingMemory
    .map((m, i) => (isToolResultMessage(m) ? i : -1))
    .filter((i) => i !== -1);
  const lastTwoToolIndices = new Set(toolResultIndices.slice(-2));

  // Tier 1: Truncate by role
  for (let i = 0; i < workingMemory.length; i++) {
    const m = workingMemory[i];
    if (!m || typeof m.content !== "string") continue;

    if (isToolResultMessage(m)) {
      const limit = lastTwoToolIndices.has(i) ? TIER1_TOOL_LAST_TRUNCATE : TIER1_TOOL_TRUNCATE;
      m.content = truncateText(m.content, limit);
    } else if (m.role === "user") {
      m.content = truncateText(m.content, TIER1_USER_TRUNCATE);
    } else if (m.role === "assistant") {
      m.content = truncateText(m.content, TIER1_ASSISTANT_TRUNCATE);
    }
  }

  // Re-check tokens
  const afterTier1Tokens = estimateMessageTokens([systemMessage, ...workingMemory]);
  if (afterTier1Tokens <= tokenThreshold) {
    return [systemMessage, ...workingMemory];
  }

  // Emergency tier: sort working memory by content length descending,
  // truncate the longest messages aggressively until under threshold
  const lengths = workingMemory.map((m) =>
    typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length
  );
  const sortedIndices = lengths
    .map((len, i) => ({ len, i }))
    .sort((a, b) => b.len - a.len)
    .map((x) => x.i);

  for (const idx of sortedIndices) {
    const m = workingMemory[idx];
    if (!m) continue;
    if (typeof m.content === "string" && m.content.length > EMERGENCY_TRUNCATE) {
      m.content = truncateText(m.content, EMERGENCY_TRUNCATE);
    }
    const current = estimateMessageTokens([systemMessage, ...workingMemory]);
    if (current <= tokenThreshold) break;
  }

  return [systemMessage, ...workingMemory];
}
