import { BudgetExceededException } from '../common/errors';
import { fakeHttpContext } from '../../test/fakes/execution-context';
import { makeTenant } from '../../test/fakes/tenant.fixture';
import { BudgetGuard } from './budget.guard';
import { InMemoryUsageRepository, type UsageRecord } from './usage.repository';
import { UsageService } from './usage.service';

function usage(tenantId: string, costUsd: number, createdAt = new Date()): UsageRecord {
  return {
    tenantId,
    requestId: 'r',
    provider: 'openai',
    model: 'gpt-4o-mini',
    promptTokens: 10,
    completionTokens: 10,
    cachedPromptTokens: 0,
    costUsd,
    estimated: false,
    cacheHit: false,
    fallbackUsed: false,
    latencyMs: 1,
    createdAt,
  };
}

describe('BudgetGuard', () => {
  let repo: InMemoryUsageRepository;
  let guard: BudgetGuard;
  const tenant = makeTenant({ monthlyBudgetUsd: 10 });

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    guard = new BudgetGuard(new UsageService(repo));
  });

  afterEach(() => jest.useRealTimers());

  it('allows requests under budget and exposes the remaining budget', async () => {
    await repo.record(usage(tenant.id, 4.25));
    const http = fakeHttpContext({}, { tenant });

    await expect(guard.canActivate(http.context)).resolves.toBe(true);
    expect(http.response.headers['X-Budget-Remaining-Usd']).toBe('5.750000');
  });

  it('rejects with 429 and X-Budget-Reset-At once the monthly budget is spent', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-15T12:00:00Z') });
    await repo.record(usage(tenant.id, 6));
    await repo.record(usage(tenant.id, 4));
    const http = fakeHttpContext({}, { tenant });

    const error = await guard.canActivate(http.context).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BudgetExceededException);
    const exception = error as BudgetExceededException;
    expect(exception.getStatus()).toBe(429);
    expect(exception.headers['X-Budget-Reset-At']).toBe('2026-11-01T00:00:00.000Z');
    expect(Number(exception.headers['Retry-After'])).toBe(16.5 * 24 * 3600);
    expect(exception.getResponse()).toMatchObject({ error: 'budget_exceeded', spentUsd: 10, limitUsd: 10 });
  });

  it('only counts the current UTC month', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T00:00:05Z') });
    await repo.record(usage(tenant.id, 50, new Date('2026-09-30T23:59:59Z')));
    await expect(guard.canActivate(fakeHttpContext({}, { tenant }).context)).resolves.toBe(true);
  });

  it('isolates spend per tenant', async () => {
    await repo.record(usage('another-tenant', 1_000));
    await expect(guard.canActivate(fakeHttpContext({}, { tenant }).context)).resolves.toBe(true);
  });

  it('falls back to the plan budget when the tenant has no override', async () => {
    const free = makeTenant({ plan: 'free', monthlyBudgetUsd: null }); // free plan = $5
    await repo.record(usage(free.id, 5));
    await expect(guard.canActivate(fakeHttpContext({}, { tenant: free }).context)).rejects.toBeInstanceOf(
      BudgetExceededException,
    );
  });
});
