export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');

export interface IdempotencyRecord {
  tenantId: string;
  key: string;
  requestHash: string;
  status: 'in_progress' | 'completed';
  responseStatus?: number;
  responseBody?: unknown;
  expiresAt: Date;
}

export type BeginResult = { acquired: true } | { acquired: false; existing: IdempotencyRecord };

/** Tenant-scoped (RLS in Postgres). Keys are unique per (tenant, key), never global. */
export interface IdempotencyRepository {
  /** Atomically claims the key unless a live record exists. Expired records are taken over. */
  begin(tenantId: string, key: string, requestHash: string, ttlMs: number): Promise<BeginResult>;
  complete(tenantId: string, key: string, responseStatus: number, responseBody: unknown): Promise<void>;
  /** Frees the key after a failure so the client can retry with the same key. */
  release(tenantId: string, key: string): Promise<void>;
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, IdempotencyRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  async begin(tenantId: string, key: string, requestHash: string, ttlMs: number): Promise<BeginResult> {
    const id = `${tenantId}:${key}`;
    const existing = this.records.get(id);
    if (existing && existing.expiresAt.getTime() > this.now()) {
      return { acquired: false, existing: structuredClone(existing) };
    }
    this.records.set(id, { tenantId, key, requestHash, status: 'in_progress', expiresAt: new Date(this.now() + ttlMs) });
    return { acquired: true };
  }

  async complete(tenantId: string, key: string, responseStatus: number, responseBody: unknown): Promise<void> {
    const record = this.records.get(`${tenantId}:${key}`);
    if (!record) return;
    Object.assign(record, { status: 'completed', responseStatus, responseBody: structuredClone(responseBody) });
  }

  async release(tenantId: string, key: string): Promise<void> {
    this.records.delete(`${tenantId}:${key}`);
  }
}
