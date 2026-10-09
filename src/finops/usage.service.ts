import { Inject, Injectable } from '@nestjs/common';
import { monthWindow, type MonthWindow } from '../common/time';
import { effectiveLimits, type Tenant } from '../tenants/tenant.model';
import { USAGE_REPOSITORY, type UsageBreakdownRow, type UsageRecord, type UsageRepository } from './usage.repository';

export interface BudgetStatus {
  limitUsd: number;
  spentUsd: number;
  remainingUsd: number;
  resetAt: Date;
  exceeded: boolean;
}

export interface UsageReport {
  tenantId: string;
  month: string;
  period: { start: string; end: string };
  budget: Omit<BudgetStatus, 'resetAt'> & { resetAt: string };
  totals: { requests: number; promptTokens: number; completionTokens: number; costUsd: number; cacheHits: number };
  byModel: UsageBreakdownRow[];
}

@Injectable()
export class UsageService {
  constructor(@Inject(USAGE_REPOSITORY) private readonly usage: UsageRepository) {}

  record(record: UsageRecord): Promise<void> {
    return this.usage.record(record);
  }

  async budgetStatus(tenant: Tenant, now: Date = new Date()): Promise<BudgetStatus> {
    const window = monthWindow(now);
    const limitUsd = effectiveLimits(tenant).monthlyBudgetUsd;
    const spentUsd = await this.usage.totalCost(tenant.id, window.start, window.end);
    return {
      limitUsd,
      spentUsd,
      remainingUsd: Math.max(0, round(limitUsd - spentUsd)),
      resetAt: window.end,
      exceeded: spentUsd >= limitUsd,
    };
  }

  async report(tenant: Tenant, window: MonthWindow, now: Date = new Date()): Promise<UsageReport> {
    const byModel = await this.usage.breakdown(tenant.id, window.start, window.end);
    const isCurrent = window.label === monthWindow(now).label;
    const totals = byModel.reduce(
      (acc, row) => ({
        requests: acc.requests + row.requests,
        promptTokens: acc.promptTokens + row.promptTokens,
        completionTokens: acc.completionTokens + row.completionTokens,
        costUsd: round(acc.costUsd + row.costUsd),
        cacheHits: acc.cacheHits + row.cacheHits,
      }),
      { requests: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, cacheHits: 0 },
    );
    const limitUsd = effectiveLimits(tenant).monthlyBudgetUsd;
    return {
      tenantId: tenant.id,
      month: window.label,
      period: { start: window.start.toISOString(), end: window.end.toISOString() },
      budget: {
        limitUsd,
        spentUsd: totals.costUsd,
        remainingUsd: Math.max(0, round(limitUsd - totals.costUsd)),
        resetAt: (isCurrent ? window.end : monthWindow(now).end).toISOString(),
        exceeded: isCurrent && totals.costUsd >= limitUsd,
      },
      totals,
      byModel,
    };
  }
}

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}
