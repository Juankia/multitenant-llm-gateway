import { FakeProvider } from '../../test/fakes/fake-provider';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { LlmRouter, type RoutedStreamEvent } from './llm-router';
import { type ModelRef } from './llm.types';
import { AllProvidersFailedError, ProviderError } from './provider-error';

const CHAIN: ModelRef[] = [
  { provider: 'openai', model: 'gpt-4o-mini' },
  { provider: 'anthropic', model: 'claude-haiku-4-5' },
  { provider: 'ollama', model: 'llama3.1' },
];
const REQUEST = { messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 64 };

async function collect(stream: AsyncIterable<RoutedStreamEvent>): Promise<RoutedStreamEvent[]> {
  const events: RoutedStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('LlmRouter (fallback chain)', () => {
  let openai: FakeProvider;
  let anthropic: FakeProvider;
  let ollama: FakeProvider;
  let breakers: CircuitBreakerRegistry;
  let router: LlmRouter;

  beforeEach(() => {
    openai = new FakeProvider('openai').succeed();
    anthropic = new FakeProvider('anthropic').succeed();
    ollama = new FakeProvider('ollama').succeed();
    breakers = new CircuitBreakerRegistry({ failureThreshold: 2, cooldownMs: 60_000 });
    router = new LlmRouter([openai, anthropic, ollama], breakers);
  });

  it('uses the primary provider when healthy', async () => {
    const routed = await router.complete(CHAIN, REQUEST);
    expect(routed.target).toEqual(CHAIN[0]);
    expect(routed.attempts.map((a) => a.outcome)).toEqual(['ok']);
    expect(openai.calls[0]?.model).toBe('gpt-4o-mini');
    expect(anthropic.calls).toHaveLength(0);
  });

  it('falls back to the next provider on a retryable error', async () => {
    openai.fail();
    const routed = await router.complete(CHAIN, REQUEST);
    expect(routed.target).toEqual(CHAIN[1]);
    expect(routed.attempts.map((a) => `${a.provider}:${a.outcome}`)).toEqual(['openai:error', 'anthropic:ok']);
  });

  it('skips unconfigured providers', async () => {
    openai.configured = false;
    const routed = await router.complete(CHAIN, REQUEST);
    expect(routed.target.provider).toBe('anthropic');
    expect(routed.attempts[0]?.outcome).toBe('skipped_unconfigured');
  });

  it('does not fall back on a non-retryable (invalid request) error', async () => {
    openai.fail(ProviderError.fromStatus('openai', 400, 'context length exceeded'));
    await expect(router.complete(CHAIN, REQUEST)).rejects.toMatchObject({ retryable: false, status: 400 });
    expect(anthropic.calls).toHaveLength(0);
  });

  it('throws AllProvidersFailedError with every attempt when the chain is exhausted', async () => {
    openai.fail();
    anthropic.fail(new Error('ECONNRESET'));
    ollama.fail(new ProviderError('ollama', 'HTTP 500', true, 500));
    const error = (await router.complete(CHAIN, REQUEST).catch((e: unknown) => e)) as AllProvidersFailedError;
    expect(error).toBeInstanceOf(AllProvidersFailedError);
    expect(error.attempts.map((a) => a.outcome)).toEqual(['error', 'error', 'error']);
  });

  it('opens the circuit after repeated failures and skips the provider without calling it', async () => {
    openai.fail();
    await router.complete(CHAIN, REQUEST);
    await router.complete(CHAIN, REQUEST); // 2nd failure -> circuit opens
    const callsBefore = openai.calls.length;

    const routed = await router.complete(CHAIN, REQUEST);

    expect(openai.calls.length).toBe(callsBefore);
    expect(routed.attempts[0]?.outcome).toBe('skipped_circuit_open');
    expect(routed.target.provider).toBe('anthropic');
    expect(router.health().find((h) => h.provider === 'openai')?.circuit).toBe('open');
  });

  describe('streaming', () => {
    it('falls back before the first token', async () => {
      openai.fail();
      const events = await collect(router.stream(CHAIN, REQUEST));
      const start = events[0];
      expect(start?.type === 'start' && start.target.provider).toBe('anthropic');
      expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThan(0);
    });

    it('does not switch providers after tokens were delivered', async () => {
      openai.failMidStream();
      const seen: RoutedStreamEvent[] = [];
      await expect(
        (async () => {
          for await (const event of router.stream(CHAIN, REQUEST)) seen.push(event);
        })(),
      ).rejects.toBeInstanceOf(ProviderError);
      expect(seen.some((e) => e.type === 'delta')).toBe(true);
      expect(anthropic.calls).toHaveLength(0);
    });
  });
});
