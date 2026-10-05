# SERVE

**Order. Track. Collect.**

SERVE is a university night-canteen ordering platform. Students browse their
night canteen's menu on their phone, pay online and track their order in real
time. They walk over to collect it only when it's ready. There is no delivery
and no cash on delivery.

> **Status: Phase 1 of 12 — repository and backend foundation.**
> Shipped so far: the monorepo, the backend skeleton, validated environment
> configuration, PostgreSQL via Prisma, security middleware and health
> endpoints. Later sections marked _(Phase N)_ describe planned work that
> does not exist yet.

---

## Architecture

```
 Student App (Flutter)   Staff Dashboard (React)   Admin Portal (React)
          │                        │                        │
          │  ① Firebase Authentication (email/password) → ID token
          │  ② REST  Authorization: Bearer <token>
          │  ③ Socket.IO (token-authenticated, server-assigned rooms)
          ▼                        ▼                        ▼
 ┌──────────────── Shared backend: Node.js · Express · Socket.IO ───────────────┐
 │ Firebase proves identity → PostgreSQL decides role, status, canteen access   │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     ▼ Prisma 7 (driver adapter: node-postgres)
                               PostgreSQL 16
```

All three apps talk to one backend. PostgreSQL is the source of truth for
users, roles, canteens, menus, prices, orders and payments. The backend never
trusts identities, prices or totals sent by a client. See
[docs/architecture.md](docs/architecture.md).

## Repository structure

```
.
├── backend/            Node.js · TypeScript · Express 5 · Prisma 7   (Phase 1 ✅)
│   ├── prisma/         schema.prisma, migrations (Phase 2)
│   ├── scripts/        db-setup-local.sh
│   ├── src/            config/ lib/ middleware/ modules/ app.ts server.ts
│   └── tests/          unit/ integration/ (real PostgreSQL)
├── student-app/        Flutter 3.47.4 mobile app                     (Phase 5)
├── staff-dashboard/    React 19 · TypeScript · Vite                  (Phase 6)
├── admin-portal/       React 19 · TypeScript · Vite                  (Phase 7)
├── brand/              Official logo location + palette
├── docs/               architecture · api · database · development
├── .env.example        Every environment variable, documented
└── package.json        npm workspaces
```

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 22.12 (see `.nvmrc`) |
| npm | ≥ 10 |
| PostgreSQL | 16 (14+ should work) |
| Flutter / Dart | 3.47.4 / 3.13.3 _(Phase 5)_ |
| Java 21 + Firebase CLI | for the Firebase Auth Emulator _(Phase 3)_ |

## Quick start (backend)

```bash
npm install                                    # installs all workspaces

# 1. PostgreSQL: create role "serve" + databases serve_dev / serve_test (idempotent)
SERVE_DB_PASSWORD='choose-a-password' npm run db:setup:local
#   Linux distro packages: add PSQL_ADMIN="sudo -u postgres psql -d postgres"

# 2. Environment
cp .env.example backend/.env          # keep the BACKEND section
cp .env.example backend/.env.test     # NODE_ENV=test, DATABASE_URL -> serve_test
#   set DATABASE_URL password and PAYMENT_SECRET (openssl rand -hex 32)

# 3. Run
npm run dev:backend                   # http://localhost:5001
curl http://localhost:5001/api/health
curl http://localhost:5001/api/health/db
```

The full walkthrough is in [docs/development.md](docs/development.md).

## PostgreSQL setup

`backend/scripts/db-setup-local.sh` creates the `serve` role and the
`serve_dev` and `serve_test` databases. It is safe to re-run: it only creates
what's missing and never drops anything. See [docs/database.md](docs/database.md).

## Prisma setup

Prisma 7 configuration lives in `backend/prisma.config.ts`. It reads
`DATABASE_URL` using the same env-file rules as the app. The client is
generated into `backend/src/generated/prisma` (gitignored):

```bash
npm run prisma:generate --workspace backend
npm run prisma:migrate:deploy --workspace backend   # apply migrations (Phase 2+)
```

Destructive commands such as `prisma migrate reset` are never run against
shared or production data.

## Firebase setup _(Phase 3)_

Development and automated tests use the **Firebase Auth Emulator**. It speaks
the real Firebase Auth protocol, and the Admin SDK verifies its tokens. To
switch to a real Firebase project you only change environment variables
(`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`).
Service-account JSON files are never committed.

## Environment variables

Every variable is documented in [`.env.example`](.env.example) and validated at
startup by `backend/src/config/env.ts`. The server refuses to start if a value
is invalid, and the error names the variable without echoing its value.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | – | `development` (default) · `test` · `production` |
| `PORT` | – | default `5001`; `5000` is rejected (macOS AirPlay) |
| `DATABASE_URL` | ✅ | `postgresql://…` |
| `CORS_ORIGINS` | ✅ | exact origins; production: https only, no localhost |
| `PAYMENT_MODE` | – | `mock` (default) · `razorpay` |
| `PAYMENT_SECRET` | ✅ | ≥ 32 chars |
| `FIREBASE_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY` | production | Phase 3 |
| `FIREBASE_AUTH_EMULATOR_HOST` | – | dev/test only; forbidden in production |
| `TRUST_PROXY`, `LOG_LEVEL`, `RATE_LIMIT_*` | – | see `.env.example` |

## Running

| App | Command | Status |
|---|---|---|
| Backend | `npm run dev:backend` → `http://localhost:5001` | ✅ |
| Student app | `cd student-app && flutter run --dart-define-from-file=env/dev.json` | Phase 5 |
| Staff dashboard | `npm run dev --workspace staff-dashboard` | Phase 6 |
| Admin portal | `npm run dev --workspace admin-portal` | Phase 7 |

## Testing

```bash
npm test          # all workspaces (backend: Vitest + Supertest on real PostgreSQL)
npm run typecheck
npm run lint
npm run format:check
```

Backend tests run against the real `serve_test` database. HTTP and the
database are never mocked.

## Build

```bash
npm run build                                  # all workspaces
NODE_ENV=production node backend/dist/server.js  # production start
```

## Git workflow

Owner-reviewed, phase by phase. Work happens on feature branches with one
logical commit per phase; the owner reviews and merges through pull requests
(feature → `develop` → `main`). Nobody pushes directly to `main`, force-pushes
or rewrites history.

## Documentation

- [docs/architecture.md](docs/architecture.md): system design, auth, realtime, payments
- [docs/api.md](docs/api.md): REST API reference
- [docs/database.md](docs/database.md): schema, migrations, safety rules
- [docs/development.md](docs/development.md): local setup, scripts, conventions
