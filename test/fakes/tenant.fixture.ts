import { hashApiKey } from '../../src/common/crypto';
import { type Tenant } from '../../src/tenants/tenant.model';

export const FIXTURE_API_KEY = 'tgw_fixture_key_for_tests_only';

export function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  const now = new Date('2026-10-01T00:00:00Z');
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme Insurance',
    slug: 'acme-insurance',
    status: 'active',
    plan: 'pro',
    apiKeyHash: hashApiKey(FIXTURE_API_KEY),
    apiKeyPrefix: FIXTURE_API_KEY.slice(0, 12),
    llm: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [{ provider: 'anthropic', model: 'claude-haiku-4-5' }],
    },
    systemPrompt: 'You are Aria, the assistant of Acme Insurance.',
    branding: { assistantName: 'Aria' },
    monthlyBudgetUsd: null,
    maxOutputTokens: null,
    cacheEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
