import { type TenantDb } from '../database/tenant-db';
import { type BeginResult, type IdempotencyRecord, type IdempotencyRepository } from './idempotency.repository';

interface Row {
  tenant_id: string;
  key: string;
  request_hash: string;
  status: 'in_progress' | 'completed';
  response_status: number | null;
  response_body: unknown;
  expires_at: Date;
}

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: TenantDb) {}

  /**
   * Single-statement claim: INSERT, or take over an *expired* row. If a live row exists the
   * upsert's WHERE fails, nothing is returned, and we read the existing row instead.
   * The (tenant_id, key) primary key makes concurrent duplicates race-free.
   */
  async begin(tenantId: string, key: string, requestHash: string, ttlMs: number): Promise<BeginResult> {
    return this.db.withTenant(tenantId, async (query) => {
      const claimed = await query<Row>(
        `INSERT INTO idempotency_keys (tenant_id, key, request_hash, status, expires_at)
         VALUES ($1, $2, $3, 'in_progress', now() + ($4 || ' milliseconds')::interval)
         ON CONFLICT (tenant_id, key) DO UPDATE
           SET request_hash = EXCLUDED.request_hash, status = 'in_progress',
               response_status = NULL, response_body = NULL, expires_at = EXCLUDED.expires_at
           WHERE idempotency_keys.expires_at <= now()
         RETURNING *`,
        [tenantId, key, requestHash, String(ttlMs)],
      );
      if (claimed.length > 0) return { acquired: true };
      const rows = await query<Row>('SELECT * FROM idempotency_keys WHERE tenant_id = $1 AND key = $2', [tenantId, key]);
      return { acquired: false, existing: toRecord(rows[0]!) };
    });
  }

  async complete(tenantId: string, key: string, responseStatus: number, responseBody: unknown): Promise<void> {
    await this.db.withTenant(tenantId, (query) =>
      query(
        `UPDATE idempotency_keys SET status = 'completed', response_status = $3, response_body = $4
         WHERE tenant_id = $1 AND key = $2`,
        [tenantId, key, responseStatus, JSON.stringify(responseBody)],
      ),
    );
  }

  async release(tenantId: string, key: string): Promise<void> {
    await this.db.withTenant(tenantId, (query) =>
      query('DELETE FROM idempotency_keys WHERE tenant_id = $1 AND key = $2', [tenantId, key]),
    );
  }
}

function toRecord(row: Row): IdempotencyRecord {
  return {
    tenantId: row.tenant_id,
    key: row.key,
    requestHash: row.request_hash,
    status: row.status,
    responseStatus: row.response_status ?? undefined,
    responseBody: row.response_body ?? undefined,
    expiresAt: new Date(row.expires_at),
  };
}
