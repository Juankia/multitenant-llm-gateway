import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let now = 0;
  const clock = () => now;
  let breaker: CircuitBreaker;

  beforeEach(() => {
    now = 0;
    breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1_000 }, clock);
  });

  it('opens after N consecutive failures', () => {
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.currentState).toBe('closed');
    breaker.onFailure();
    expect(breaker.currentState).toBe('open');
    expect(breaker.tryAcquire()).toBe(false);
  });

  it('a success resets the failure count', () => {
    breaker.onFailure();
    breaker.onFailure();
    breaker.onSuccess();
    breaker.onFailure();
    expect(breaker.currentState).toBe('closed');
  });

  it('allows exactly one trial request after the cooldown (half-open)', () => {
    for (let i = 0; i < 3; i++) breaker.onFailure();
    now = 1_000;
    expect(breaker.currentState).toBe('half_open');
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(false); // trial already in flight
  });

  it('closes when the trial succeeds, re-opens when it fails', () => {
    for (let i = 0; i < 3; i++) breaker.onFailure();
    now = 1_000;
    breaker.tryAcquire();
    breaker.onSuccess();
    expect(breaker.currentState).toBe('closed');

    for (let i = 0; i < 3; i++) breaker.onFailure();
    now = 2_500;
    breaker.tryAcquire();
    breaker.onFailure();
    expect(breaker.currentState).toBe('open');
    now = 3_000;
    expect(breaker.tryAcquire()).toBe(false); // new cooldown started at 2_500
  });
});
