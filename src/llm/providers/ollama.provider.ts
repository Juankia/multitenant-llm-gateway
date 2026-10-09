import { type LlmProvider, type LlmRequest, type LlmResult, type LlmStreamChunk, type TokenUsage } from '../llm.types';
import { parseNdjson, postJson, requireBody } from './http';

interface OllamaChatResponse {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaProviderOptions {
  baseUrl?: string;
  timeoutMs: number;
}

/** Self-hosted models via Ollama's /api/chat. Useful as a zero-marginal-cost last-resort fallback. */
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama' as const;

  constructor(private readonly options: OllamaProviderOptions) {}

  isConfigured(): boolean {
    return Boolean(this.options.baseUrl);
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const response = await this.call(request, false);
    const json = (await response.json()) as OllamaChatResponse;
    return { content: json.message?.content ?? '', usage: toUsage(json), finishReason: json.done_reason };
  }

  async *stream(request: LlmRequest): AsyncGenerator<LlmStreamChunk> {
    const response = await this.call(request, true);
    for await (const chunk of parseNdjson<OllamaChatResponse>(requireBody(this.name, response))) {
      if (chunk.message?.content) yield { type: 'delta', content: chunk.message.content };
      if (chunk.done) {
        const usage = toUsage(chunk);
        if (usage) yield { type: 'usage', usage };
      }
    }
  }

  private call(request: LlmRequest, stream: boolean): Promise<Response> {
    return postJson({
      provider: this.name,
      url: `${this.options.baseUrl}/api/chat`,
      headers: {},
      body: {
        model: request.model,
        messages: request.messages,
        stream,
        options: {
          num_predict: request.maxTokens,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        },
      },
      timeoutMs: this.options.timeoutMs,
      signal: request.signal,
    });
  }
}

function toUsage(response: OllamaChatResponse): TokenUsage | undefined {
  if (response.prompt_eval_count === undefined && response.eval_count === undefined) return undefined;
  return { promptTokens: response.prompt_eval_count ?? 0, completionTokens: response.eval_count ?? 0 };
}
