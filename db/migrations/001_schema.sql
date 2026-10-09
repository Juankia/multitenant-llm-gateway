-- 001_schema.sql - core schema. Tables are owned by the migration (superuser) role,
-- the application connects as `gateway_app` (see 000_roles.sh).

BEGIN;

-- Control plane: tenant registry. Looked up by API-key hash BEFORE the tenant is known,
-- so it is intentionally not under RLS (see README "Design decisions").
CREATE TABLE IF NOT EXISTS tenants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  slug                text        NOT NULL,
  status              text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  plan                text        NOT NULL CHECK (plan IN ('free', 'pro', 'enterprise')),
  api_key_hash        char(64)    NOT NULL,             -- SHA-256 hex of the key; plaintext never stored
  api_key_prefix      text        NOT NULL,             -- non-secret, for display
  llm_config          jsonb       NOT NULL,             -- { primary: {provider, model}, fallbacks: [...] }
  system_prompt       text        NOT NULL DEFAULT '',
  branding            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  monthly_budget_usd  numeric(12, 4) CHECK (monthly_budget_usd >= 0),  -- NULL = plan default
  max_output_tokens   integer     CHECK (max_output_tokens > 0),       -- NULL = plan default
  cache_enabled       boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_key UNIQUE (slug),
  CONSTRAINT tenants_api_key_hash_key UNIQUE (api_key_hash)
);

-- Data plane: append-only usage ledger (FinOps source of truth).
CREATE TABLE IF NOT EXISTS usage_records (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id             uuid          NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  request_id            text          NOT NULL,
  provider              text          NOT NULL,
  model                 text          NOT NULL,
  prompt_tokens         integer       NOT NULL CHECK (prompt_tokens >= 0),
  completion_tokens     integer       NOT NULL CHECK (completion_tokens >= 0),
  cached_prompt_tokens  integer       NOT NULL DEFAULT 0 CHECK (cached_prompt_tokens >= 0),
  cost_usd              numeric(14, 8) NOT NULL CHECK (cost_usd >= 0),
  estimated             boolean       NOT NULL DEFAULT false,
  cache_hit             boolean       NOT NULL DEFAULT false,
  fallback_used         boolean       NOT NULL DEFAULT false,
  latency_ms            integer       NOT NULL DEFAULT 0,
  created_at            timestamptz   NOT NULL DEFAULT now()
);
-- Serves the hot path: month-to-date SUM(cost_usd) per tenant for the budget guard.
CREATE INDEX IF NOT EXISTS usage_records_tenant_created_idx
  ON usage_records (tenant_id, created_at) INCLUDE (cost_usd);

-- Data plane: Idempotency-Key ledger.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id        uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  key              text        NOT NULL,
  request_hash     char(64)    NOT NULL,
  status           text        NOT NULL CHECK (status IN ('in_progress', 'completed')),
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON idempotency_keys (expires_at);

COMMIT;
