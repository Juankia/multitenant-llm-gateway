import { type LlmProvider, type LlmRequest, type LlmResult, type LlmStreamChunk } from '../llm.types';

/**
 * Deterministic offline provider for the quickstart and demos.
 * It deliberately does NOT report token usage, which exercises the gateway's tiktoken
 * estimation path exactly like a real provider that omits usage would.
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock' as const;

  constructor(private readonly enabled: boolean) {}

  isConfigured(): boolean {
    return this.enabled;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    return { content: this.answer(request), finishReason: 'stop' };
  }

  async *stream(request: LlmRequest): AsyncGenerator<LlmStreamChunk> {
    for (const word of this.answer(request).split(/(?<= )/)) {
      if (request.signal?.aborted) return;
      yield { type: 'delta', content: word };
    }
  }

  private answer(request: LlmRequest): string {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const persona = request.messages.find((m) => m.role === 'system')?.content.split('.')[0] ?? 'Assistant';
    return `(${request.model}) ${persona}. You asked: "${lastUser.slice(0, 200)}". This is a mock response.`;
  }
}
