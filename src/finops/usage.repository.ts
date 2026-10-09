import { type ProviderName } from '../llm/llm.types';

export const USAGE_REPOSITORY = Symbol('USAGE_REPOSITORY');

export interface UsageRecord {
  tenantId: string;
  requestId: string;
  provider: ProviderName;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  costUsd: number;
  /** True when token counts came from tiktoken instead of the provider. */
  estimated: boolean;
  cacheHit: boolean;
  fallbackUsed: boolean;
  latencyMs: number;
  createdAt: Date;
}

export interface UsageBreakdownRow {
  provider: ProviderName;
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  cacheHits: number;
  estimatedRequests: number;
}

/** Data-plane, tenant-scoped. In Postgres every method runs under RLS for `tenantId`. */
export interface UsageRepository {
  record(record: UsageRecord): Promise<void>;
  totalCost(tenantId: string, from: Date, to: Date): Promise<number>;
  breakdown(tenantId: string, from: Date, to: Date): Promise<UsageBreakdownRow[]>;
}

export class InMemoryUsageRepository implements UsageRepository {
  private readonly records: UsageRecord[] = [];

  async record(record: UsageRecord): Promise<void> {
    this.records.push({ ...record });
  }

  async totalCost(tenantId: string, from: Date, to: Date): Promise<number> {
    return round(this.scoped(tenantId, from, to).reduce((sum, r) => sum + r.costUsd, 0));
  }

  async breakdown(tenantId: string, from: Date, to: Date): Promise<UsageBreakdownRow[]> {
    const rows = new Map<string, UsageBreakdownRow>();
    for (const r of this.scoped(tenantId, from, to)) {
      const key = `${r.provider}/${r.model}`;
      const row = rows.get(key) ?? {
        provider: r.provider,
        model: r.model,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        cacheHits: 0,
        estimatedRequests: 0,
      };
      row.requests += 1;
      row.promptTokens += r.promptTokens;
      row.completionTokens += r.completionTokens;
      row.costUsd = round(row.costUsd + r.costUsd);
      row.cacheHits += r.cacheHit ? 1 : 0;
      row.estimatedRequests += r.estimated ? 1 : 0;
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => b.costUsd - a.costUsd);
  }

  private scoped(tenantId: string, from: Date, to: Date): UsageRecord[] {
    return this.records.filter((r) => r.tenantId === tenantId && r.createdAt >= from && r.createdAt < to);
  }
}

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}
