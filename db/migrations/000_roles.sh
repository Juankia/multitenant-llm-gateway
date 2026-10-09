#!/usr/bin/env bash
# Creates the runtime role the API connects as. It is deliberately NOT a superuser and has
# NO BYPASSRLS: superusers and BYPASSRLS roles skip Row-Level Security entirely, which would
# silently disable tenant isolation. The password comes from the environment (never committed).
set -euo pipefail

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE gateway_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gateway_app') \gexec
SQL
