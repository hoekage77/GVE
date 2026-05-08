/**
 * Tool Coordinator — Streaming tool execution for agent mode.
 *
 * Phase 2: Live per-file/event streaming via onEvent callback.
 * Phase 2b: Native function calling support (OpenAI-compatible tool_calls).
 * Phase 3: Multimodal user message support (text + image_url) with vision provider failover.
 *
 * The coordinator yields progress events as they happen so the frontend
 * can render tool actions, file completions, and previews in real time.
 */

import { buildFunctionSchemas, executeTool, getToolsSummary, TERMINATING_TOOLS } from "../tools/registry.js";
import { buildToolAwareSystemPrompt } from "../pipeline/prompts.js";
import { compressWorkingMemory, estimateMessageTokens } from "../pipeline/compression.js";

export interface LlmProviderOptions {
  preferredProviderId?: string;
  onToken?: (token: string) => void;
}

export interface LlmProviderResponse {
  content: string;
  reasoningContent?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string; // raw JSON string
  }>;
}

export type UserMessage =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: string } }
    >;

/**
 * Events emitted by the coordinator during execution.
 * Consumers (agent-turn-path) map these to broadcastEvent / broadcastThought.
 */
export type CoordinatorEvent =
  | { type: "coordinator:thinking"; payload: { iteration: number; messageCount: number; compressed?: boolean } }
  | { type: "coordinator:tool_call"; payload: { callId: string; name: string; arguments: Record<string, unknown>; iteration: number } }
  | { type: "coordinator:tool_result"; payload: { callId: string; name: string; success: boolean; output: string; durationMs: number } }
  | { type: "coordinator:file_complete"; payload: { path: string; previewUrl: string | null; lines: number | null } }
  | { type: "coordinator:complete"; payload: { response: string; totalToolCalls: number; iterations: number; terminated?: boolean } }
  | { type: "coordinator:error"; payload: { error: string } };

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TurnResult {
  success: boolean;
  response: string;
  toolCalls: ToolCall[];
  toolResults: Array<{ callId: string; success: boolean; output: string }>;
  error?: string;
}

/**
 * Create an LLM provider callback for the tool coordinator.
 *
 * Uses the existing provider pool with failover. Token usage is recorded
 * automatically.
 *
 * When tools are provided, they are passed via the native OpenAI-compatible
 * `tools` API parameter. The response includes both content and any native
 * `tool_calls` returned by the model.
 *
 * Vision requirement is inferred from the messages array (image_url content parts).
 */
export function createLlmProvider(options: LlmProviderOptions = {}) {
  const { preferredProviderId, onToken } = options;
  return async (
    messages: Array<{ role: string; content: string | any[] }>,
    tools?: any[]
  ): Promise<LlmProviderResponse> => {
    const { executeWithProviderFailover, createRetryableProviderError } = await import(
      "../pipeline/failover.js"
    );
    const { streamChatCompletion } = await import("../llm/streaming.js");

    const hasVision = messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((c: any) => c.type === "image_url")
    );

    const completion = await executeWithProviderFailover({
      operationName: "AgentToolTurn",
      filter: {
        preferredProviderId,
        requireVision: hasVision,
      },
      mode: "thinking",
      retryDelays: [250, 750],
      executeProvider: async ({ provider, mode, retryDelays }: any) => {
        const payload: any = { messages };
        if (tools && tools.length > 0) {
          payload.tools = tools;
          payload.tool_choice = "auto";
        }

        const streamOptions: any = { mode, retryDelays };
        if (onToken) {
          streamOptions.callbacks = { onToken };
        }
        const result = await streamChatCompletion(provider, payload, streamOptions);

        if (!result.content && !result.toolCalls?.length) {
          throw createRetryableProviderError(
            `${provider.id} returned empty content and no tool_calls.`,
            "PROVIDER_EMPTY_OUTPUT"
          );
        }

        return {
          content: result.content ?? "",
          reasoningContent: result.reasoningContent || undefined,
          toolCalls: result.toolCalls?.length ? result.toolCalls : undefined,
        };
      },
    });

    return completion.value as LlmProviderResponse;
  };
}

/**
 * Execute a single turn with tool availability and real-time streaming.
 *
 * Flow:
 * 1. Build system prompt with tool descriptions
 * 2. Call LLM with user message + native tools → emit `thinking`
 * 3. Extract tool calls from native `tool_calls` or parse from content
 * 4. Execute tools → emit `tool_result` per result
 * 5. Detect file outputs → emit `file_complete` for previewable artifacts
 * 6. Call LLM again with tool results → repeat steps 2-5
 * 7. Emit `complete` with final response
 */
export async function executeToolTurn(params: {
  sessionId: string;
  userMessage: UserMessage;
  llmProvider: (messages: Array<{ role: string; content: string | any[] }>, tools?: any[]) => Promise<LlmProviderResponse>;
  maxToolCalls?: number;
  onEvent?: (event: CoordinatorEvent) => void | Promise<void>;
}): Promise<TurnResult> {
  const { sessionId, userMessage, llmProvider, maxToolCalls = 5, onEvent } = params;

  function emit(event: CoordinatorEvent) {
    try {
      onEvent?.(event);
    } catch {
      // Event emission is best-effort; never break turn flow.
    }
  }

  try {
    const toolsSummary = getToolsSummary();
    const rawSchemas = buildFunctionSchemas();
    const functionSchemas = Object.values(rawSchemas).map((schema: any) => ({
      type: "function" as const,
      function: schema,
    }));
    const systemPrompt = buildToolAwareSystemPrompt(toolsSummary);

    const sessionAwarePrompt = systemPrompt + `\n\nCurrent session ID: ${sessionId}\nWhen calling sandbox or animation tools, always use this exact session_id.`;

    const messages: Array<{ role: string; content: string | any[]; tool_calls?: any; tool_call_id?: string; name?: string }> = [
      { role: "system", content: sessionAwarePrompt },
      { role: "user", content: userMessage }
    ];

    const toolCalls: ToolCall[] = [];
    const toolResults: Array<{ callId: string; success: boolean; output: string }> = [];

    // First LLM call
    emit({ type: "coordinator:thinking", payload: { iteration: 0, messageCount: messages.length } });

    // Tier 1 compression before first LLM call
    const compressedMessages = compressWorkingMemory(messages);
    if (compressedMessages.length < messages.length || estimateMessageTokens(compressedMessages) < estimateMessageTokens(messages)) {
      emit({ type: "coordinator:thinking", payload: { iteration: 0, messageCount: compressedMessages.length, compressed: true } });
    }

    let llmResponse = await llmProvider(compressedMessages, Object.values(functionSchemas));

    let parsedCalls = extractToolCalls(llmResponse);
    let iterations = 0;

    let shouldTerminate = false;

    while (parsedCalls.length > 0 && iterations < maxToolCalls && !shouldTerminate) {
      iterations += 1;

      // Push ONE assistant message with ALL tool_calls from this response
      const assistantMsg: any = {
        role: "assistant",
        content: llmResponse.content || "",
        tool_calls: parsedCalls.map(call => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) }
        }))
      };
      if (llmResponse.reasoningContent) {
        assistantMsg.reasoning_content = llmResponse.reasoningContent;
      }
      messages.push(assistantMsg);

      // Emit tool_call events for all calls in this batch
      for (const call of parsedCalls) {
        toolCalls.push(call);
        emit({
          type: "coordinator:tool_call",
          payload: { callId: call.id, name: call.name, arguments: call.arguments, iteration: iterations }
        });
      }

      // Execute all tools in the batch concurrently
      const batchResults = await Promise.all(
        parsedCalls.map(async (call) => {
          const toolStart = Date.now();
          const result = await executeTool(call.name, call.arguments);
          const toolDuration = Date.now() - toolStart;
          return { call, result, toolDuration };
        })
      );

      // Process results sequentially to maintain message order
      for (const { call, result, toolDuration } of batchResults) {
        const MAX_TOOL_OUTPUT = 2048;
        const displayOutput = result && result.output.length > MAX_TOOL_OUTPUT
          ? result.output.slice(0, MAX_TOOL_OUTPUT) + `\n\n... [output truncated, ${result.output.length - MAX_TOOL_OUTPUT} chars remaining] ...`
          : result?.output;
        const resultContent = result
          ? `Tool result (${call.name}): ${displayOutput}`
          : `Tool result (${call.name}): Tool returned null`;

        messages.push({
          role: "tool",
          content: resultContent,
          tool_call_id: call.id
        });

        if (!result) {
          toolResults.push({
            callId: call.id,
            success: false,
            output: `Tool "${call.name}" returned null`
          });
          emit({
            type: "coordinator:tool_result",
            payload: { callId: call.id, name: call.name, success: false, output: "Tool returned null", durationMs: toolDuration }
          });
          continue;
        }

        toolResults.push({
          callId: call.id,
          success: result.success,
          output: result.output
        });

        emit({
          type: "coordinator:tool_result",
          payload: { callId: call.id, name: call.name, success: result.success, output: result.output, durationMs: toolDuration }
        });

        const fileInfo = extractFileInfo(call.name, result.output);
        if (fileInfo) {
          emit({
            type: "coordinator:file_complete",
            payload: {
              path: fileInfo.path,
              previewUrl: fileInfo.previewUrl,
              lines: fileInfo.lines
            }
          });
        }

        if (result.success && TERMINATING_TOOLS.has(call.name)) {
          shouldTerminate = true;
        }
      }

      if (shouldTerminate) break;

      // Tier 1 compression before follow-up LLM call
      const followUpCompressed = compressWorkingMemory(messages);
      if (followUpCompressed.length < messages.length || estimateMessageTokens(followUpCompressed) < estimateMessageTokens(messages)) {
        emit({ type: "coordinator:thinking", payload: { iteration: iterations, messageCount: followUpCompressed.length, compressed: true } });
      }

      llmResponse = await llmProvider(followUpCompressed, Object.values(functionSchemas));
      parsedCalls = extractToolCalls(llmResponse);
    }

    // If a terminating tool ended the loop, use its output as the final response
    const terminatingResult = shouldTerminate
      ? toolResults.slice().reverse().find((tr) => TERMINATING_TOOLS.has(toolCalls.find((tc) => tc.id === tr.callId)?.name ?? ""))
      : undefined;

    const finalResponse = terminatingResult
      ? terminatingResult.output
      : llmResponse.content;

    emit({
      type: "coordinator:complete",
      payload: { response: finalResponse, totalToolCalls: toolCalls.length, iterations, terminated: shouldTerminate }
    });

    return {
      success: true,
      response: finalResponse,
      toolCalls,
      toolResults
    };
  } catch (err: any) {
    const errorMsg = `Tool turn failed: ${err.message}`;
    emit({ type: "coordinator:error", payload: { error: errorMsg } });
    return {
      success: false,
      response: "",
      toolCalls: [],
      toolResults: [],
      error: errorMsg
    };
  }
}

/**
 * Extract tool calls from an LLM response.
 *
 * Priority:
 * 1. Native `toolCalls` from the API (OpenAI-compatible)
 * 2. XML-style function calls in content text
 * 3. JSON format in content text
 */
function extractToolCalls(response: LlmProviderResponse): ToolCall[] {
  // Priority 1: Native tool_calls
  if (response.toolCalls && response.toolCalls.length > 0) {
    const calls: ToolCall[] = [];
    for (const tc of response.toolCalls) {
      try {
        const args = JSON.parse(tc.arguments);
        calls.push({ id: tc.id, name: tc.name, arguments: args });
      } catch {
        // If JSON parse fails, use raw string as single argument
        calls.push({ id: tc.id, name: tc.name, arguments: { _raw: tc.arguments } });
      }
    }
    return calls;
  }

  // Priority 2 & 3: Parse from content text
  return parseToolCallsFromText(response.content);
}

/**
 * Extract file completion metadata from tool output JSON.
 * Returns null if no file info is found.
 */
function extractFileInfo(toolName: string, output: string): { path: string; previewUrl: string | null; lines: number | null } | null {
  try {
    const parsed = JSON.parse(output);
    if (parsed.file_path || parsed.path || parsed.file_name) {
      const path = String(parsed.file_path ?? parsed.path ?? parsed.file_name ?? "");
      if (!path) return null;
      return {
        path,
        previewUrl: parsed.preview_url ?? parsed.previewUrl ?? null,
        lines: parsed.line_count ?? parsed.lines ?? null
      };
    }
    // Animation tools return media_url instead of file_path
    if (parsed.media_url || parsed.previewUrl) {
      const mediaUrl = String(parsed.media_url ?? parsed.previewUrl ?? "");
      if (!mediaUrl) return null;
      return {
        path: parsed.file_path ?? `media-${Date.now()}.mp4`,
        previewUrl: mediaUrl,
        lines: null
      };
    }
    // Special case: animation tools embed file_path inside nested object
    if (parsed.file_path && typeof parsed.file_path === "string") {
      return {
        path: parsed.file_path,
        previewUrl: parsed.preview_url ?? null,
        lines: parsed.lines ?? null
      };
    }
  } catch {
    // Not JSON — ignore
  }
  return null;
}

/**
 * Parse tool calls from text content (XML and JSON fallback formats).
 *
 * Handles both well-formed and truncated responses. When the LLM hits
 * max_tokens, closing tags may be missing — we attempt recovery in that case.
 */
function parseToolCallsFromText(response: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const seenInvokeNames = new Set<string>();

  // ── XML-style (complete) ──
  const xmlRegex = /<invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/gi;
  let xmlMatch: RegExpExecArray | null;
  while ((xmlMatch = xmlRegex.exec(response)) !== null) {
    const name = xmlMatch[1]!;
    const content = xmlMatch[2]!;
    seenInvokeNames.add(name);
    const args = parseXmlParams(content);
    calls.push({ id: `call-${Date.now()}-${calls.length}`, name, arguments: args });
  }

  // ── XML-style (truncated — missing </invoke>) ──
  // Match <invoke name="...">... that never got a closing tag
  const truncatedXmlRegex = /<invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]+)$/gi;
  const truncatedXmlMatch = truncatedXmlRegex.exec(response);
  if (truncatedXmlMatch && !seenInvokeNames.has(truncatedXmlMatch[1]!)) {
    const name = truncatedXmlMatch[1]!;
    const content = truncatedXmlMatch[2]!;
    const args = parseXmlParams(content);
    if (Object.keys(args).length > 0) {
      console.warn(
        `[Coordinator] Recovered truncated XML invoke for "${name}" with ${Object.keys(args).length} params. ` +
        `Response likely hit max_tokens.`
      );
      calls.push({ id: `call-${Date.now()}-${calls.length}`, name, arguments: args });
    }
  }

  // ── JSON format (complete) ──
  const seenJsonNames = new Set<string>();
  const jsonRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let jsonMatch: RegExpExecArray | null;
  while ((jsonMatch = jsonRegex.exec(response)) !== null) {
    try {
      const jsonText = jsonMatch[1];
      if (!jsonText) continue;
      const parsed = JSON.parse(jsonText);
      const callName = parsed.name || parsed.tool;
      if (callName && typeof callName === "string") {
        seenJsonNames.add(callName);
        calls.push({
          id: `call-${Date.now()}-${calls.length}`,
          name: callName,
          arguments: parsed.arguments || parsed.args || {}
        });
      }
    } catch (parseErr: any) {
      console.warn(
        `[Coordinator] Failed to parse tool_call JSON (length=${jsonMatch[1]?.length ?? 0}): ${parseErr?.message ?? parseErr}. ` +
        `Snippet: ${String(jsonMatch[1] ?? "").slice(0, 200)}...`
      );
    }
  }

  // ── JSON format (truncated — missing </tool_call>) ──
  const truncatedJsonRegex = /<tool_call>([\s\S]+)$/gi;
  const truncatedJsonMatch = truncatedJsonRegex.exec(response);
  if (truncatedJsonMatch) {
    const jsonText = truncatedJsonMatch[1]!.trim();
    if (jsonText && !seenJsonNames.size) {
      // Try to repair truncated JSON: find the last complete key-value pair
      const repaired = repairTruncatedJson(jsonText);
      if (repaired) {
        try {
          const parsed = JSON.parse(repaired);
          const callName = parsed.name || parsed.tool;
          if (callName && typeof callName === "string") {
            console.warn(
              `[Coordinator] Recovered truncated JSON tool_call for "${callName}". ` +
              `Response likely hit max_tokens.`
            );
            calls.push({
              id: `call-${Date.now()}-${calls.length}`,
              name: callName,
              arguments: parsed.arguments || parsed.args || {}
            });
          }
        } catch (repairErr: any) {
          console.warn(
            `[Coordinator] Truncated JSON repair also failed: ${repairErr?.message ?? repairErr}. ` +
            `Original snippet: ${jsonText.slice(0, 200)}...`
          );
        }
      }
    }
  }

  return calls;
}

/**
 * Parse <param name="...">value</param> from XML invoke body.
 * Also handles truncated params missing </param>.
 */
function parseXmlParams(content: string): Record<string, string> {
  const args: Record<string, string> = {};

  // Complete params
  const paramRegex = /<param\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/param>/gi;
  let paramMatch: RegExpExecArray | null;
  while ((paramMatch = paramRegex.exec(content)) !== null) {
    args[paramMatch[1]!] = paramMatch[2]!.trim();
  }

  // Truncated params (missing </param>) — last param in a truncated response
  const truncatedParamRegex = /<param\s+name=["']([^"']+)["'][^>]*>([\s\S]+)$/gi;
  const truncatedParamMatch = truncatedParamRegex.exec(content);
  if (truncatedParamMatch && !(truncatedParamMatch[1]! in args)) {
    args[truncatedParamMatch[1]!] = truncatedParamMatch[2]!.trim();
  }

  return args;
}

/**
 * Attempt to repair a truncated JSON string from a tool_call block.
 *
 * Strategy: find the last complete key-value pair and close the object.
 * E.g. {"name": "foo", "arguments": {"code": "incomplet  -> {"name": "foo", "arguments": {"code": "incomplet"}}
 */
function repairTruncatedJson(jsonText: string): string | null {
  let text = jsonText;

  // Quick check: if it's already valid JSON, return as-is
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Needs repair
  }

  // Count unclosed braces and brackets
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\') {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }

  // If we're inside a string, close it
  if (inString) {
    text += '"';
  }

  // Close open brackets then braces
  for (let i = 0; i < openBrackets; i++) {
    text += ']';
  }
  for (let i = 0; i < openBraces; i++) {
    text += '}';
  }

  // Try parsing the repaired text
  try {
    JSON.parse(text);
    return text;
  } catch {
    return null;
  }
}
