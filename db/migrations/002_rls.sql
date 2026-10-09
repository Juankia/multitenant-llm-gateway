-- 002_rls.sql - tenant isolation enforced by PostgreSQL itself.
--
-- How it works
-- ------------
-- For every data-plane statement the API opens a transaction and runs
--     SELECT set_config('app.tenant_id', '<tenant uuid>', true);   -- true = transaction-local
-- The policies below compare each row's tenant_id with that setting. Consequences:
--   * A query that forgets `WHERE tenant_id = ...` still only sees the caller's rows.
--   * INSERT/UPDATE of a row for another tenant fails (WITH CHECK).
--   * If the setting is missing, current_setting(..., true) returns NULL (or '' on a pooled
--     connection where it was set earlier and reset), NULLIF turns '' into NULL, and
--     `tenant_id = NULL` is never true -> zero rows. The policy fails CLOSED.
--   * Because the setting is transaction-local, it cannot leak to the next request that
--     borrows the same pooled connection.
-- FORCE ROW LEVEL SECURITY also applies the policies to the table owner. Superusers and
-- BYPASSRLS roles are always exempt, which is why the API uses the `gateway_app` role.

BEGIN;

ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON usage_records;
CREATE POLICY tenant_isolation ON usage_records
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON idempotency_keys;
CREATE POLICY tenant_isolation ON idempotency_keys
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Least privilege for the runtime role. The usage ledger is append-only (no UPDATE/DELETE).
GRANT USAGE ON SCHEMA public TO gateway_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO gateway_app;
GRANT SELECT, INSERT ON usage_records TO gateway_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO gateway_app;

COMMIT;
