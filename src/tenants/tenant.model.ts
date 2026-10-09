import { type ModelRef } from '../llm/llm.types';

export const PLANS = ['free', 'pro', 'enterprise'] as const;
export type Plan = (typeof PLANS)[number];

export const TENANT_STATUSES = ['active', 'suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface PlanLimits {
  monthlyBudgetUsd: number;
  maxOutputTokens: number;
}

/** Plan defaults; a tenant may carry explicit overrides (negotiated enterprise budgets, etc.). */
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { monthlyBudgetUsd: 5, maxOutputTokens: 512 },
  pro: { monthlyBudgetUsd: 100, maxOutputTokens: 2048 },
  enterprise: { monthlyBudgetUsd: 2000, maxOutputTokens: 8192 },
};

export interface TenantBranding {
  assistantName: string;
  primaryColor?: string;
  welcomeMessage?: string;
}

export interface TenantLlmConfig {
  primary: ModelRef;
  fallbacks: ModelRef[];
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: Plan;
  apiKeyHash: string;
  apiKeyPrefix: string;
  llm: TenantLlmConfig;
  systemPrompt: string;
  branding: TenantBranding;
  /** null = use plan default. */
  monthlyBudgetUsd: number | null;
  /** null = use plan default. */
  maxOutputTokens: number | null;
  cacheEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicTenant = Omit<Tenant, 'apiKeyHash'> & { limits: PlanLimits };

export function effectiveLimits(tenant: Tenant): PlanLimits {
  const defaults = PLAN_LIMITS[tenant.plan];
  return {
    monthlyBudgetUsd: tenant.monthlyBudgetUsd ?? defaults.monthlyBudgetUsd,
    maxOutputTokens: tenant.maxOutputTokens ?? defaults.maxOutputTokens,
  };
}

export function toPublicTenant(tenant: Tenant): PublicTenant {
  const { apiKeyHash: _omit, ...rest } = tenant;
  return { ...rest, limits: effectiveLimits(tenant) };
}

export function fallbackChain(tenant: Tenant): ModelRef[] {
  return [tenant.llm.primary, ...tenant.llm.fallbacks];
}
