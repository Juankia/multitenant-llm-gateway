import { type LlmProvider, type LlmRequest, type LlmResult, type LlmStreamChunk, type TokenUsage } from '../llm.types';
import { parseSse, postJson, requireBody, splitSystem } from './http';

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}
interface AnthropicResponse {
  content: { type: string; text?: string }[];
  stop_reason?: string;
  usage: AnthropicUsage;
}
interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: AnthropicUsage };
  delta?: { type?: string; text?: string };
  usage?: AnthropicUsage;
}

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
}

export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Anthropic Messages API.
 *
 * Prompt caching: the tenant system prompt is identical on every request for that tenant, so it
 * is sent as a content block marked `cache_control: { type: "ephemeral" }`. Subsequent requests
 * read it from Anthropic's prompt cache at a fraction of the input price (the prefix must exceed
 * the model's minimum cacheable length to be cached).
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;

  constructor(private readonly options: AnthropicProviderOptions) {}

  isConfigured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const response = await this.call(request, false);
    const json = (await response.json()) as AnthropicResponse;
    return {
      content: json.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(''),
      usage: toUsage(json.usage),
      finishReason: json.stop_reason,
    };
  }

  async *stream(request: LlmRequest): AsyncGenerator<LlmStreamChunk> {
    const response = await this.call(request, true);
    let usage: AnthropicUsage = {};
    for await (const event of parseSse(requireBody(this.name, response))) {
      const payload = JSON.parse(event.data) as AnthropicStreamEvent;
      if (payload.type === 'message_start' && payload.message?.usage) {
        usage = { ...payload.message.usage };
      } else if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta' && payload.delta.text) {
        yield { type: 'delta', content: payload.delta.text };
      } else if (payload.type === 'message_delta' && payload.usage) {
        usage = { ...usage, ...payload.usage };
      } else if (payload.type === 'message_stop') {
        break;
      }
    }
    yield { type: 'usage', usage: toUsage(usage) };
  }

  private call(request: LlmRequest, stream: boolean): Promise<Response> {
    const { system, rest } = splitSystem(request.messages);
    return postJson({
      provider: this.name,
      url: `${this.options.baseUrl}/messages`,
      headers: { 'x-api-key': this.options.apiKey ?? '', 'anthropic-version': ANTHROPIC_VERSION },
      body: {
        model: request.model,
        max_tokens: request.maxTokens,
        messages: rest,
        ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(stream ? { stream: true } : {}),
      },
      timeoutMs: this.options.timeoutMs,
      signal: request.signal,
    });
  }
}

/** Anthropic reports uncached, cache-read and cache-write input tokens separately. */
export function toUsage(usage: AnthropicUsage): TokenUsage {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    promptTokens: (usage.input_tokens ?? 0) + cacheRead + cacheWrite,
    completionTokens: usage.output_tokens ?? 0,
    cachedPromptTokens: cacheRead,
  };
}
