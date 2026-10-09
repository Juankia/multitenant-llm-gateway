import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { generateApiKey, hashApiKey } from '../common/crypto';
import { type CreateTenantDto, type UpdateTenantDto } from './dto/tenant.dto';
import { type PublicTenant, type Tenant, toPublicTenant } from './tenant.model';
import { SlugTakenError, TENANT_REPOSITORY, type TenantPatch, type TenantRepository } from './tenant.repository';

export interface TenantWithKey {
  tenant: PublicTenant;
  /** Shown exactly once; only its SHA-256 hash is persisted. */
  apiKey: string;
}

@Injectable()
export class TenantsService {
  constructor(@Inject(TENANT_REPOSITORY) private readonly repo: TenantRepository) {}

  resolveByApiKey(apiKey: string): Promise<Tenant | null> {
    return this.repo.findByApiKeyHash(hashApiKey(apiKey));
  }

  async create(dto: CreateTenantDto): Promise<TenantWithKey> {
    const key = generateApiKey();
    const now = new Date();
    const tenant: Tenant = {
      id: randomUUID(),
      name: dto.name,
      slug: dto.slug,
      status: 'active',
      plan: dto.plan,
      apiKeyHash: key.hash,
      apiKeyPrefix: key.prefix,
      llm: { primary: { ...dto.primary }, fallbacks: (dto.fallbacks ?? []).map((f) => ({ ...f })) },
      systemPrompt: dto.systemPrompt ?? '',
      branding: dto.branding ? { ...dto.branding } : { assistantName: dto.name },
      monthlyBudgetUsd: dto.monthlyBudgetUsd ?? null,
      maxOutputTokens: dto.maxOutputTokens ?? null,
      cacheEnabled: dto.cacheEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const created = await this.repo.create(tenant);
      return { tenant: toPublicTenant(created), apiKey: key.apiKey };
    } catch (error) {
      if (error instanceof SlugTakenError) throw new ConflictException(error.message);
      throw error;
    }
  }

  async list(): Promise<PublicTenant[]> {
    return (await this.repo.list()).map(toPublicTenant);
  }

  async get(id: string): Promise<PublicTenant> {
    return toPublicTenant(await this.require(id));
  }

  async update(id: string, dto: UpdateTenantDto): Promise<PublicTenant> {
    const current = await this.require(id);
    const patch: TenantPatch = {
      name: dto.name,
      plan: dto.plan,
      status: dto.status,
      systemPrompt: dto.systemPrompt,
      branding: dto.branding ? { ...dto.branding } : undefined,
      monthlyBudgetUsd: dto.monthlyBudgetUsd,
      maxOutputTokens: dto.maxOutputTokens,
      cacheEnabled: dto.cacheEnabled,
    };
    if (dto.primary || dto.fallbacks) {
      patch.llm = {
        primary: dto.primary ? { ...dto.primary } : current.llm.primary,
        fallbacks: dto.fallbacks ? dto.fallbacks.map((f) => ({ ...f })) : current.llm.fallbacks,
      };
    }
    const updated = await this.repo.update(id, stripUndefined(patch));
    if (!updated) throw new NotFoundException('Tenant not found');
    return toPublicTenant(updated);
  }

  /** Issues a new key; the old one stops working immediately. */
  async rotateKey(id: string): Promise<TenantWithKey> {
    await this.require(id);
    const key = generateApiKey();
    const updated = await this.repo.update(id, { apiKeyHash: key.hash, apiKeyPrefix: key.prefix });
    if (!updated) throw new NotFoundException('Tenant not found');
    return { tenant: toPublicTenant(updated), apiKey: key.apiKey };
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repo.delete(id))) throw new NotFoundException('Tenant not found');
  }

  private async require(id: string): Promise<Tenant> {
    const tenant = await this.repo.findById(id);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
