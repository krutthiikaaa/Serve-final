#!/usr/bin/env bash
#
# Idempotently create the local SERVE PostgreSQL role and databases:
#   serve_dev   — development
#   serve_test  — automated tests (truncated/migrated by the test suite)
#
# Safe to re-run: existing roles/databases are left untouched (never dropped).
# LOCAL DEVELOPMENT ONLY. Production databases are provisioned separately.
#
# Usage:
#   SERVE_DB_PASSWORD='<choose-a-password>' npm run db:setup:local
#
# Optional:
#   SERVE_DB_USER   (default: serve)
#   PSQL_ADMIN      command used to reach a superuser session
#                   (default: "psql -d postgres"; on Linux distro packages use
#                    PSQL_ADMIN="sudo -u postgres psql -d postgres")
set -euo pipefail

SERVE_DB_USER="${SERVE_DB_USER:-serve}"
: "${SERVE_DB_PASSWORD:?Set SERVE_DB_PASSWORD to the password for the local '${SERVE_DB_USER}' role}"
PSQL_ADMIN="${PSQL_ADMIN:-psql -d postgres}"

# shellcheck disable=SC2086
$PSQL_ADMIN -v ON_ERROR_STOP=1 -q \
  -v db_user="$SERVE_DB_USER" \
  -v db_password="$SERVE_DB_PASSWORD" <<'SQL'
-- Role (CREATEDB is required locally for Prisma's migrate-dev shadow database)
SELECT format('CREATE ROLE %I LOGIN CREATEDB PASSWORD %L', :'db_user', :'db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user')
\gexec

-- Databases
SELECT format('CREATE DATABASE %I OWNER %I', db, :'db_user')
FROM unnest(ARRAY['serve_dev', 'serve_test']) AS db
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = db)
\gexec
SQL

echo "SERVE local databases ready: serve_dev, serve_test (role: ${SERVE_DB_USER})"
echo "DATABASE_URL=postgresql://${SERVE_DB_USER}:<password>@localhost:5432/serve_dev?schema=public"
