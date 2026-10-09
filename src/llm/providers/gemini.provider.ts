import { type LlmProvider, type LlmRequest, type LlmResult, type LlmStreamChunk, type TokenUsage } from '../llm.types';
import { parseSse, postJson, requireBody, splitSystem } from './http';

interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: GeminiUsage;
}

export interface GeminiProviderOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
}

/** Google Gemini (Generative Language API, v1beta generateContent). */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;

  constructor(private readonly options: GeminiProviderOptions) {}

  isConfigured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const response = await this.call(request, `${encodeURIComponent(request.model)}:generateContent`);
    const json = (await response.json()) as GeminiResponse;
    return {
      content: textOf(json),
      usage: json.usageMetadata ? toUsage(json.usageMetadata) : undefined,
      finishReason: json.candidates?.[0]?.finishReason,
    };
  }

  async *stream(request: LlmRequest): AsyncGenerator<LlmStreamChunk> {
    const response = await this.call(request, `${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`);
    let usage: GeminiUsage | undefined;
    for await (const event of parseSse(requireBody(this.name, response))) {
      const chunk = JSON.parse(event.data) as GeminiResponse;
      const text = textOf(chunk);
      if (text) yield { type: 'delta', content: text };
      if (chunk.usageMetadata) usage = chunk.usageMetadata; // cumulative; keep the last one
    }
    if (usage) yield { type: 'usage', usage: toUsage(usage) };
  }

  private call(request: LlmRequest, path: string): Promise<Response> {
    const { system, rest } = splitSystem(request.messages);
    return postJson({
      provider: this.name,
      url: `${this.options.baseUrl}/models/${path}`,
      headers: { 'x-goog-api-key': this.options.apiKey ?? '' },
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: rest.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        },
      },
      timeoutMs: this.options.timeoutMs,
      signal: request.signal,
    });
  }
}

function textOf(response: GeminiResponse): string {
  return (response.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
}

/** "Thinking" tokens are billed as output tokens. */
function toUsage(usage: GeminiUsage): TokenUsage {
  return {
    promptTokens: usage.promptTokenCount ?? 0,
    completionTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    cachedPromptTokens: usage.cachedContentTokenCount ?? 0,
  };
}
