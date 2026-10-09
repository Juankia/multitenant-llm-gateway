export const PROVIDER_NAMES = ['openai', 'anthropic', 'gemini', 'ollama', 'mock'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export interface ModelRef {
  provider: ProviderName;
  model: string;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LlmRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  /** Aborted when the client disconnects; providers must forward it to fetch(). */
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** Prompt tokens served from the provider's prompt cache (billed at a discount). */
  cachedPromptTokens?: number;
}

export interface LlmResult {
  content: string;
  /** Undefined when the provider does not report usage; the gateway then estimates with tiktoken. */
  usage?: TokenUsage;
  finishReason?: string;
}

export type LlmStreamChunk = { type: 'delta'; content: string } | { type: 'usage'; usage: TokenUsage };

/** Strategy interface: one implementation per LLM vendor. */
export interface LlmProvider {
  readonly name: ProviderName;
  /** False when credentials/endpoints are missing; the router skips unconfigured providers. */
  isConfigured(): boolean;
  complete(request: LlmRequest): Promise<LlmResult>;
  stream(request: LlmRequest): AsyncIterable<LlmStreamChunk>;
}

export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');
