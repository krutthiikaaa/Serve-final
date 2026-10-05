# SERVE — Database

PostgreSQL 16 through **Prisma 7**, using the `prisma-client` generator and
the `@prisma/adapter-pg` driver adapter.

_Status: Phase 1. Connection, configuration and health check are done. Domain
models arrive in Phase 2 through a reviewed migration._

## Files

| File | Purpose |
|---|---|
| `backend/prisma.config.ts` | Prisma CLI config: schema and migrations paths, `DATABASE_URL` from env |
| `backend/prisma/schema.prisma` | Schema (generator + datasource only in Phase 1) |
| `backend/prisma/migrations/` | SQL migrations, committed and reviewed _(Phase 2+)_ |
| `backend/src/lib/prisma.ts` | Runtime client factory (5 s connect timeout) |
| `backend/src/generated/prisma/` | Generated client (gitignored; `npm run prisma:generate`) |
| `backend/scripts/db-setup-local.sh` | Idempotent local role and database creation |

## Databases

| Environment | Database | Notes |
|---|---|---|
| development | `serve_dev` | local |
| test | `serve_test` | used by `npm test`; test suites may truncate it |
| production | managed (e.g. RDS) | migrations only via `prisma migrate deploy` |

## Local setup

```bash
SERVE_DB_PASSWORD='choose-a-password' npm run db:setup:local
# Linux distro packages:
SERVE_DB_PASSWORD='…' PSQL_ADMIN="sudo -u postgres psql -d postgres" npm run db:setup:local
```

The script creates the role `serve` (`LOGIN CREATEDB`; CREATEDB is needed for
the Prisma migrate-dev shadow database) and the `serve_dev` and `serve_test`
databases. It only creates missing objects and never drops anything.

## Migration safety rules

1. Every schema change is a Prisma migration (`prisma migrate dev --name <change>`) that is **inspected before committing**.
2. Never run `prisma migrate reset`, `db push --force-reset` or manual `DROP` against shared or production data unless the owner explicitly asks.
3. Production applies migrations only with `prisma migrate deploy`.
4. A migration that would lose data needs owner approval first.

## Planned data model (Phase 2)

`Canteen`, `Hostel` (→ Canteen), `Student` (→ Hostel), `Staff` (→ Canteen when
approved), `Admin`, `MenuCategory` (→ Canteen), `MenuItem` (→ Canteen and
Category), `CanteenChangeRequest`, `Order` (→ Student, Canteen), `OrderItem`
(snapshot of name, unit price and quantity), `Payment` (→ Order),
`Notification`. Money is stored as integer **paise**. Full details will be
documented here alongside the migration.
