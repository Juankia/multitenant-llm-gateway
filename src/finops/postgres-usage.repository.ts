import { type TenantDb } from '../database/tenant-db';
import { type ProviderName } from '../llm/llm.types';
import { type UsageBreakdownRow, type UsageRecord, type UsageRepository } from './usage.repository';

/**
 * Note the queries below still include `tenant_id = $1`: it is good for the index, but isolation
 * does not depend on it - the RLS policy enforces the same predicate inside Postgres.
 */
export class PostgresUsageRepository implements UsageRepository {
  constructor(private readonly db: TenantDb) {}

  async record(r: UsageRecord): Promise<void> {
    await this.db.withTenant(r.tenantId, (query) =>
      query(
        `INSERT INTO usage_records (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens,
                                    cached_prompt_tokens, cost_usd, estimated, cache_hit, fallback_used, latency_ms, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          r.tenantId, r.requestId, r.provider, r.model, r.promptTokens, r.completionTokens, r.cachedPromptTokens,
          r.costUsd, r.estimated, r.cacheHit, r.fallbackUsed, r.latencyMs, r.createdAt,
        ],
      ),
    );
  }

  async totalCost(tenantId: string, from: Date, to: Date): Promise<number> {
    const rows = await this.db.withTenant(tenantId, (query) =>
      query<{ total: string }>(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_records
         WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
        [tenantId, from, to],
      ),
    );
    return Number(rows[0]?.total ?? 0);
  }

  async breakdown(tenantId: string, from: Date, to: Date): Promise<UsageBreakdownRow[]> {
    const rows = await this.db.withTenant(tenantId, (query) =>
      query<Record<string, string>>(
        `SELECT provider, model, COUNT(*) AS requests,
                SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens,
                SUM(cost_usd) AS cost_usd, COUNT(*) FILTER (WHERE cache_hit) AS cache_hits,
                COUNT(*) FILTER (WHERE estimated) AS estimated_requests
         FROM usage_records
         WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
         GROUP BY provider, model ORDER BY SUM(cost_usd) DESC`,
        [tenantId, from, to],
      ),
    );
    return rows.map((row) => ({
      provider: row.provider as ProviderName,
      model: String(row.model),
      requests: Number(row.requests),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      costUsd: Number(row.cost_usd),
      cacheHits: Number(row.cache_hits),
      estimatedRequests: Number(row.estimated_requests),
    }));
  }
}
