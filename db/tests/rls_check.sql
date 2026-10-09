-- RLS regression test. Run as the runtime role (gateway_app) after applying migrations:
--   psql -U gateway_app -d llm_gateway -v ON_ERROR_STOP=1 -f db/tests/rls_check.sql
-- Any failed assertion raises an exception and makes psql exit non-zero (used in CI).

INSERT INTO tenants (id, name, slug, plan, api_key_hash, api_key_prefix, llm_config) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A', 'rls-a', 'free', repeat('a', 64), 'tgw_aaaa', '{}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B', 'rls-b', 'free', repeat('b', 64), 'tgw_bbbb', '{}');

BEGIN;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
INSERT INTO usage_records (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'req-a', 'mock', 'demo', 10, 10, 0.01);
COMMIT;

BEGIN;
SELECT set_config('app.tenant_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
INSERT INTO usage_records (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'req-b', 'mock', 'demo', 20, 20, 0.02);
COMMIT;

-- 1. Without tenant context nothing is visible (fail closed).
DO $$ BEGIN
  IF (SELECT count(*) FROM usage_records) <> 0 THEN RAISE EXCEPTION 'RLS: rows visible without app.tenant_id'; END IF;
END $$;

BEGIN;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
-- 2. A tenant sees only its own rows, even with no WHERE clause.
DO $$ BEGIN
  IF (SELECT count(*) FROM usage_records) <> 1 THEN RAISE EXCEPTION 'RLS: tenant A must see exactly 1 row'; END IF;
  IF EXISTS (SELECT 1 FROM usage_records WHERE request_id = 'req-b') THEN RAISE EXCEPTION 'RLS: tenant A sees tenant B data'; END IF;
END $$;
-- 3. A tenant cannot write rows for another tenant (WITH CHECK).
DO $$ BEGIN
  BEGIN
    INSERT INTO usage_records (tenant_id, request_id, provider, model, prompt_tokens, completion_tokens, cost_usd)
    VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'forged', 'mock', 'demo', 1, 1, 0);
    RAISE EXCEPTION 'RLS: cross-tenant INSERT was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; -- expected
  END;
END $$;
COMMIT;

-- 4. Transaction-local setting does not leak to the next statement on the same connection.
DO $$ BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN RAISE EXCEPTION 'RLS: tenant context leaked'; END IF;
END $$;

-- 5. The usage ledger is append-only for the runtime role.
DO $$ BEGIN
  BEGIN
    DELETE FROM usage_records;
    RAISE EXCEPTION 'RLS: runtime role can delete usage';
  EXCEPTION WHEN insufficient_privilege THEN NULL; -- expected
  END;
END $$;

DELETE FROM tenants WHERE slug IN ('rls-a', 'rls-b');
\echo 'RLS checks passed'
