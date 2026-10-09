export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Consecutive retryable failures before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open before a single trial request is allowed. */
  cooldownMs: number;
}

/**
 * Classic three-state circuit breaker.
 * closed --(N consecutive failures)--> open --(cooldown elapsed)--> half_open
 * half_open --(trial succeeds)--> closed | --(trial fails)--> open
 * While open, the router skips the provider instantly instead of waiting for timeouts.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;

  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly now: () => number = Date.now,
  ) {}

  get currentState(): CircuitState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.options.cooldownMs) return 'half_open';
    return this.state;
  }

  /** Returns true if a request may go through; reserves the single half-open trial slot. */
  tryAcquire(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (this.now() - this.openedAt < this.options.cooldownMs) return false;
      this.state = 'half_open';
      this.trialInFlight = false;
    }
    if (this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  onSuccess(): void {
    this.state = 'closed';
    this.failures = 0;
    this.trialInFlight = false;
  }

  onFailure(): void {
    this.trialInFlight = false;
    if (this.state === 'half_open') {
      this.trip();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) this.trip();
  }

  /** Releases a reserved half-open slot without judging provider health (e.g. client abort). */
  release(): void {
    this.trialInFlight = false;
  }

  private trip(): void {
    this.state = 'open';
    this.openedAt = this.now();
    this.failures = 0;
  }
}

export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): CircuitBreaker {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new CircuitBreaker(this.options, this.now);
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  snapshot(): Record<string, CircuitState> {
    return Object.fromEntries([...this.breakers].map(([key, breaker]) => [key, breaker.currentState]));
  }
}
