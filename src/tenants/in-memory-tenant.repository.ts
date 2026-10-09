import { type Tenant } from './tenant.model';
import { SlugTakenError, type TenantPatch, type TenantRepository } from './tenant.repository';

export class InMemoryTenantRepository implements TenantRepository {
  private readonly tenants = new Map<string, Tenant>();

  async findByApiKeyHash(hash: string): Promise<Tenant | null> {
    return clone([...this.tenants.values()].find((t) => t.apiKeyHash === hash));
  }

  async findById(id: string): Promise<Tenant | null> {
    return clone(this.tenants.get(id));
  }

  async list(): Promise<Tenant[]> {
    return [...this.tenants.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((t) => clone(t)!);
  }

  async create(tenant: Tenant): Promise<Tenant> {
    if ([...this.tenants.values()].some((t) => t.slug === tenant.slug)) throw new SlugTakenError(tenant.slug);
    this.tenants.set(tenant.id, clone(tenant)!);
    return clone(tenant)!;
  }

  async update(id: string, patch: TenantPatch): Promise<Tenant | null> {
    const current = this.tenants.get(id);
    if (!current) return null;
    const next: Tenant = { ...current, ...patch, updatedAt: new Date() };
    this.tenants.set(id, next);
    return clone(next);
  }

  async delete(id: string): Promise<boolean> {
    return this.tenants.delete(id);
  }
}

function clone(tenant: Tenant | undefined): Tenant | null {
  return tenant ? structuredClone(tenant) : null;
}
