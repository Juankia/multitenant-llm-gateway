import { type Tenant } from './tenant.model';

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');

export type TenantPatch = Partial<Omit<Tenant, 'id' | 'slug' | 'createdAt'>>;

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`Tenant slug "${slug}" is already taken`);
  }
}

/**
 * Control-plane registry of tenants. Unlike data-plane tables it is NOT under RLS: resolving a
 * tenant from an API key necessarily happens before the tenant is known.
 */
export interface TenantRepository {
  findByApiKeyHash(hash: string): Promise<Tenant | null>;
  findById(id: string): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
  create(tenant: Tenant): Promise<Tenant>;
  update(id: string, patch: TenantPatch): Promise<Tenant | null>;
  delete(id: string): Promise<boolean>;
}
