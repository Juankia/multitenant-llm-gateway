import { type LlmProvider, type LlmRequest, type LlmResult, type LlmStreamChunk, type TokenUsage } from '../llm.types';
import { ProviderError } from '../provider-error';
import { parseSse, postJson, requireBody } from './http';

interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
}
interface OpenAiResponse {
  choices: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: OpenAiUsage;
}
interface OpenAiStreamChunk {
  choices?: { delta?: { content?: string | null } }[];
  usage?: OpenAiUsage | null;
}

export interface OpenAiProviderOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
}

/**
 * OpenAI Chat Completions. Works with any OpenAI-compatible endpoint via OPENAI_BASE_URL.
 * Prompt caching is automatic on OpenAI for prompts >= 1024 tokens; cached tokens are reported in
 * `usage.prompt_tokens_details.cached_tokens` and priced at the discounted rate by the PriceTable.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;

  constructor(private readonly options: OpenAiProviderOptions) {}

  isConfigured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const response = await postJson({
      provider: this.name,
      url: `${this.options.baseUrl}/chat/completions`,
      headers: this.headers(),
      body: this.body(request, false),
      timeoutMs: this.options.timeoutMs,
      signal: request.signal,
    });
    const json = (await response.json()) as OpenAiResponse;
    const choice = json.choices[0];
    if (!choice) throw new ProviderError(this.name, 'Response contained no choices', true);
    return {
      content: choice.message?.content ?? '',
      usage: json.usage ? toUsage(json.usage) : undefined,
      finishReason: choice.finish_reason,
    };
  }

  async *stream(request: LlmRequest): AsyncGenerator<LlmStreamChunk> {
    const response = await postJson({
      provider: this.name,
      url: `${this.options.baseUrl}/chat/completions`,
      headers: this.headers(),
      body: this.body(request, true),
      timeoutMs: this.options.timeoutMs,
      signal: request.signal,
    });
    for await (const event of parseSse(requireBody(this.name, response))) {
      if (event.data === '[DONE]') return;
      const chunk = JSON.parse(event.data) as OpenAiStreamChunk;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield { type: 'delta', content: delta };
      if (chunk.usage) yield { type: 'usage', usage: toUsage(chunk.usage) };
    }
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.options.apiKey ?? ''}` };
  }

  private body(request: LlmRequest, stream: boolean): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages,
      max_completion_tokens: request.maxTokens,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
  }
}

function toUsage(usage: OpenAiUsage): TokenUsage {
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    cachedPromptTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
  };
}
