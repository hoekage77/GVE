/**
 * LLM provider and pool types.
 */

export interface ProviderCapabilities {
  codeGeneration: boolean;
  thinking: boolean;
  vision: boolean;
  streaming: boolean;
  reasoning?: boolean;
  supportsPromptCaching?: boolean;
}

export interface ProviderLimits {
  rpm: number;
  concurrency: number;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  priority: number;
  capabilities: ProviderCapabilities;
  limits: ProviderLimits;
  cooldownMs: number;
  maxTokens?: number;
  payloadTransform: ((payload: ChatCompletionPayload, options?: Record<string, unknown>) => ChatCompletionPayload) | null;
}

export interface ResolvedProvider extends ProviderDefinition {
  apiKey: string;
  hasApiKey: boolean;
}

export interface PoolHealthEntry {
  providerId: string;
  available: boolean;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  cooldownUntil: string | null;
}

export interface ChatCompletionPayload {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: string | { type: string; function: { name: string } };
  [key: string]: unknown;
}

export type ChatMessageContent =
  | string
  | null
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    >;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatMessageContent;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage & { reasoning_content?: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
