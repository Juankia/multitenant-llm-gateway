import { Inject, Injectable } from '@nestjs/common';
import { RequestContext } from '../common/request-context';
import { CircuitBreakerRegistry } from './circuit-breaker';
import {
  LLM_PROVIDERS,
  type LlmProvider,
  type LlmRequest,
  type LlmResult,
  type LlmStreamChunk,
  type ModelRef,
  type ProviderName,
} from './llm.types';
import { AllProvidersFailedError, type Attempt, ProviderError } from './provider-error';

export type RouteRequest = Omit<LlmRequest, 'model'>;

export interface RoutedResult {
  result: LlmResult;
  target: ModelRef;
  attempts: Attempt[];
}

export type RoutedStreamEvent = { type: 'start'; target: ModelRef; attempts: Attempt[] } | LlmStreamChunk;

/**
 * Walks a tenant's fallback chain (primary first). For each target it:
 *  1. skips providers without credentials,
 *  2. skips providers whose circuit is open (fail fast, no timeout wait),
 *  3. calls the provider; retryable errors fall through to the next target,
 *     non-retryable (bad request) errors stop the chain.
 * Streaming can only fall back before the first token reaches the client.
 */
@Injectable()
export class LlmRouter {
  private readonly providers: Map<ProviderName, LlmProvider>;

  constructor(
    @Inject(LLM_PROVIDERS) providers: LlmProvider[],
    private readonly breakers: CircuitBreakerRegistry,
  ) {
    this.providers = new Map(providers.map((p) => [p.name, p]));
  }

  async complete(chain: ModelRef[], request: RouteRequest): Promise<RoutedResult> {
    const attempts: Attempt[] = [];
    for (const target of chain) {
      const provider = this.admit(target, attempts);
      if (!provider) continue;
      const breaker = this.breakers.get(target.provider);
      const startedAt = Date.now();
      try {
        const result = await provider.complete({ ...request, model: target.model });
        breaker.onSuccess();
        attempts.push({ ...target, outcome: 'ok', latencyMs: Date.now() - startedAt });
        return { result, target, attempts };
      } catch (error) {
        this.handleFailure(target, error, request.signal, attempts, Date.now() - startedAt);
      }
    }
    throw new AllProvidersFailedError(attempts);
  }

  async *stream(chain: ModelRef[], request: RouteRequest): AsyncGenerator<RoutedStreamEvent> {
    const attempts: Attempt[] = [];
    for (const target of chain) {
      const provider = this.admit(target, attempts);
      if (!provider) continue;
      const breaker = this.breakers.get(target.provider);
      const startedAt = Date.now();
      let started = false;
      try {
        for await (const chunk of provider.stream({ ...request, model: target.model })) {
          if (!started) {
            started = true;
            attempts.push({ ...target, outcome: 'ok', latencyMs: Date.now() - startedAt });
            yield { type: 'start', target, attempts };
          }
          yield chunk;
        }
        if (!started) {
          attempts.push({ ...target, outcome: 'ok', latencyMs: Date.now() - startedAt });
          yield { type: 'start', target, attempts };
        }
        breaker.onSuccess();
        return;
      } catch (error) {
        if (started) {
          // Tokens were already delivered: switching providers mid-answer would corrupt the output.
          const providerError = ProviderError.from(target.provider, error, request.signal);
          if (providerError.aborted) breaker.release();
          else if (providerError.retryable) breaker.onFailure();
          throw providerError;
        }
        this.handleFailure(target, error, request.signal, attempts, Date.now() - startedAt);
      }
    }
    throw new AllProvidersFailedError(attempts);
  }

  health(): { provider: ProviderName; configured: boolean; circuit: string }[] {
    const circuits = this.breakers.snapshot();
    return [...this.providers.values()].map((p) => ({
      provider: p.name,
      configured: p.isConfigured(),
      circuit: circuits[p.name] ?? 'closed',
    }));
  }

  private admit(target: ModelRef, attempts: Attempt[]): LlmProvider | undefined {
    const provider = this.providers.get(target.provider);
    if (!provider || !provider.isConfigured()) {
      attempts.push({ ...target, outcome: 'skipped_unconfigured' });
      return undefined;
    }
    if (!this.breakers.get(target.provider).tryAcquire()) {
      attempts.push({ ...target, outcome: 'skipped_circuit_open' });
      return undefined;
    }
    return provider;
  }

  private handleFailure(
    target: ModelRef,
    error: unknown,
    signal: AbortSignal | undefined,
    attempts: Attempt[],
    latencyMs: number,
  ): void {
    const providerError = ProviderError.from(target.provider, error, signal);
    const breaker = this.breakers.get(target.provider);
    attempts.push({ ...target, outcome: 'error', error: providerError.message, latencyMs });
    if (providerError.aborted) {
      breaker.release();
      throw providerError;
    }
    if (!providerError.retryable) {
      breaker.release();
      throw providerError;
    }
    breaker.onFailure();
    RequestContext.logger().warn(
      { provider: target.provider, model: target.model, error: providerError.message },
      'provider failed, falling back',
    );
  }
}
