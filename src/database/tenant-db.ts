import { type DataSource } from 'typeorm';

export const DATA_SOURCE = Symbol('DATA_SOURCE');

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

/**
 * Unit of work bound to one tenant.
 *
 * Every data-plane query runs inside a transaction that first executes
 *   SELECT set_config('app.tenant_id', $1, true)
 * The third argument (`is_local = true`) scopes the setting to the current transaction, so it
 * is discarded on COMMIT/ROLLBACK and can never leak to the next request that reuses the pooled
 * connection. The RLS policies in db/migrations/002_rls.sql then filter every statement by
 * `current_setting('app.tenant_id')` - even a query that forgets its WHERE tenant_id clause.
 */
export class TenantDb {
  constructor(private readonly dataSource: DataSource) {}

  withTenant<T>(tenantId: string, work: (query: Query) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const query: Query = <R>(sql: string, params?: unknown[]) => manager.query<R[]>(sql, params);
      return work(query);
    });
  }

  /** Control-plane access (tenants registry) - no tenant context. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.dataSource.query<T[]>(sql, params);
  }
}
