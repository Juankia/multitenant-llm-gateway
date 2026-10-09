import { type TenantDb } from '../database/tenant-db';
import { type Plan, type Tenant, type TenantBranding, type TenantLlmConfig, type TenantStatus } from './tenant.model';
import { SlugTakenError, type TenantPatch, type TenantRepository } from './tenant.repository';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: Plan;
  api_key_hash: string;
  api_key_prefix: string;
  llm_config: TenantLlmConfig;
  system_prompt: string;
  branding: TenantBranding;
  monthly_budget_usd: string | null;
  max_output_tokens: number | null;
  cache_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS: Record<keyof TenantPatch, string> = {
  name: 'name',
  status: 'status',
  plan: 'plan',
  apiKeyHash: 'api_key_hash',
  apiKeyPrefix: 'api_key_prefix',
  llm: 'llm_config',
  systemPrompt: 'system_prompt',
  branding: 'branding',
  monthlyBudgetUsd: 'monthly_budget_usd',
  maxOutputTokens: 'max_output_tokens',
  cacheEnabled: 'cache_enabled',
  updatedAt: 'updated_at',
};
const JSON_COLUMNS = new Set(['llm_config', 'branding']);

export class PostgresTenantRepository implements TenantRepository {
  constructor(private readonly db: TenantDb) {}

  async findByApiKeyHash(hash: string): Promise<Tenant | null> {
    const rows = await this.db.query<TenantRow>('SELECT * FROM tenants WHERE api_key_hash = $1', [hash]);
    return rows[0] ? toTenant(rows[0]) : null;
  }

  async findById(id: string): Promise<Tenant | null> {
    const rows = await this.db.query<TenantRow>('SELECT * FROM tenants WHERE id = $1', [id]);
    return rows[0] ? toTenant(rows[0]) : null;
  }

  async list(): Promise<Tenant[]> {
    const rows = await this.db.query<TenantRow>('SELECT * FROM tenants ORDER BY created_at');
    return rows.map(toTenant);
  }

  async create(t: Tenant): Promise<Tenant> {
    try {
      const rows = await this.db.query<TenantRow>(
        `INSERT INTO tenants (id, name, slug, status, plan, api_key_hash, api_key_prefix, llm_config, system_prompt,
                              branding, monthly_budget_usd, max_output_tokens, cache_enabled, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          t.id, t.name, t.slug, t.status, t.plan, t.apiKeyHash, t.apiKeyPrefix, JSON.stringify(t.llm),
          t.systemPrompt, JSON.stringify(t.branding), t.monthlyBudgetUsd, t.maxOutputTokens, t.cacheEnabled,
          t.createdAt, t.updatedAt,
        ],
      );
      return toTenant(rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error, 'tenants_slug_key')) throw new SlugTakenError(t.slug);
      throw error;
    }
  }

  async update(id: string, patch: TenantPatch): Promise<Tenant | null> {
    const entries = Object.entries({ ...patch, updatedAt: new Date() }).filter(([, v]) => v !== undefined);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of entries) {
      const column = COLUMNS[key as keyof TenantPatch];
      params.push(JSON_COLUMNS.has(column) ? JSON.stringify(value) : value);
      sets.push(`${column} = $${params.length}`);
    }
    params.push(id);
    const rows = await this.db.query<TenantRow>(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0] ? toTenant(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>('DELETE FROM tenants WHERE id = $1 RETURNING id', [id]);
    return rows.length > 0;
  }
}

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    plan: row.plan,
    apiKeyHash: row.api_key_hash,
    apiKeyPrefix: row.api_key_prefix,
    llm: row.llm_config,
    systemPrompt: row.system_prompt,
    branding: row.branding,
    monthlyBudgetUsd: row.monthly_budget_usd === null ? null : Number(row.monthly_budget_usd),
    maxOutputTokens: row.max_output_tokens,
    cacheEnabled: row.cache_enabled,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const code = e.code ?? e.driverError?.code;
  const name = e.constraint ?? e.driverError?.constraint;
  return code === '23505' && name === constraint;
}
