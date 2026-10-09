import { type ModelRef, type ProviderName } from './llm.types';

/**
 * Normalized provider failure.
 * - `retryable`: transient or provider-side (timeouts, 429, 5xx, auth/config problems). The router
 *   falls back to the next provider and counts it against the circuit breaker.
 * - non-retryable: the request itself is invalid (400/413/422). Another vendor would most likely
 *   reject it too, so we fail fast instead of burning budget across the chain.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly aborted = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  static fromStatus(provider: ProviderName, status: number, detail: string): ProviderError {
    const nonRetryable = status === 400 || status === 413 || status === 422;
    return new ProviderError(provider, `HTTP ${status}: ${detail.slice(0, 300)}`, !nonRetryable, status);
  }

  static from(provider: ProviderName, error: unknown, clientSignal?: AbortSignal): ProviderError {
    if (error instanceof ProviderError) return error;
    if (clientSignal?.aborted) return new ProviderError(provider, 'Client aborted the request', false, undefined, true);
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return new ProviderError(provider, isTimeout ? 'Provider timed out' : `Network error: ${message}`, true);
  }
}

export type AttemptOutcome = 'ok' | 'error' | 'skipped_circuit_open' | 'skipped_unconfigured';

export interface Attempt extends ModelRef {
  outcome: AttemptOutcome;
  error?: string;
  latencyMs?: number;
}

export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: Attempt[]) {
    super('No provider in the fallback chain could serve the request');
    this.name = 'AllProvidersFailedError';
  }
}
