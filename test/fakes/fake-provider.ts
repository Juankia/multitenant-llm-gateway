import {
  type LlmProvider,
  type LlmRequest,
  type LlmResult,
  type LlmStreamChunk,
  type ProviderName,
  type TokenUsage,
} from '../../src/llm/llm.types';
import { ProviderError } from '../../src/llm/provider-error';

export type FakeMode =
  | { kind: 'ok'; content?: string; usage?: TokenUsage | null }
  | { kind: 'fail'; error: Error }
  | { kind: 'fail_mid_stream'; error: Error };

/** Scriptable provider used by unit and e2e tests - no network, fully deterministic. */
export class FakeProvider implements LlmProvider {
  readonly calls: LlmRequest[] = [];
  configured = true;
  private mode: FakeMode = { kind: 'ok' };

  constructor(readonly name: ProviderName) {}

  succeed(content?: string, usage: TokenUsage | null = { promptTokens: 100, completionTokens: 50 }): this {
    this.mode = { kind: 'ok', content, usage };
    return this;
  }

  fail(error: Error = new ProviderError(this.name, 'HTTP 503: overloaded', true, 503)): this {
    this.mode = { kind: 'fail', error };
    return this;
  }

  failMidStream(error: Error = new ProviderError(this.name, 'connection reset', true)): this {
    this.mode = { kind: 'fail_mid_stream', error };
    return this;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.calls.push(request);
    if (this.mode.kind !== 'ok') throw this.mode.error;
    return { content: this.content(request), usage: this.mode.usage ?? undefined, finishReason: 'stop' };
  }

  async *stream(request: LlmRequest): AsyncGenerator<LlmStreamChunk> {
    this.calls.push(request);
    if (this.mode.kind === 'fail') throw this.mode.error;
    const words = this.content(request).split(/(?<= )/);
    if (this.mode.kind === 'fail_mid_stream') {
      yield { type: 'delta', content: words[0] ?? '' };
      throw this.mode.error;
    }
    for (const word of words) yield { type: 'delta', content: word };
    if (this.mode.usage) yield { type: 'usage', usage: this.mode.usage };
  }

  private content(request: LlmRequest): string {
    if (this.mode.kind === 'ok' && this.mode.content) return this.mode.content;
    return `${this.name}:${request.model} says hello`;
  }
}
