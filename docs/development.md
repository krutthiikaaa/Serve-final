# SERVE — Development guide

Every command below was run against this repository. Commands are run from
the repository root unless a step says `backend/`.

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | ≥ 22.12 (`nvm use` reads `.nvmrc`) | backend and tooling |
| npm | ≥ 10 | workspaces |
| PostgreSQL | 16 on `localhost:5432` | database |
| Java | 21 | the Firebase Auth Emulator runs on the JVM |
| Firebase CLI | `npm install -g firebase-tools` (tested with 15.32) | Auth Emulator |

The Firebase CLI is installed globally on purpose. It is a developer tool,
not a dependency of the app.

## 2. Install

```bash
git clone https://github.com/krutthiikaaa/Serve-final.git && cd Serve-final
npm install
```

## 3. PostgreSQL

```bash
SERVE_DB_PASSWORD='choose-a-password' npm run db:setup:local
# If your superuser is only reachable as the postgres OS user:
SERVE_DB_PASSWORD='…' PSQL_ADMIN="sudo -u postgres psql -d postgres" npm run db:setup:local
```

This creates the role `serve` and the databases `serve_dev` and `serve_test`.
It is safe to re-run and never drops anything.

## 4. Environment files (gitignored)

```bash
cp .env.example backend/.env
cp .env.example backend/.env.test
```

**`backend/.env`** (development):

```dotenv
NODE_ENV=development
PORT=5001
DATABASE_URL=postgresql://serve:<password>@localhost:5432/serve_dev?schema=public
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
FIREBASE_PROJECT_ID=demo-serve
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
PAYMENT_MODE=mock
PAYMENT_SECRET=<openssl rand -hex 32>
LOG_LEVEL=debug
```

**`backend/.env.test`** (automated tests):

```dotenv
NODE_ENV=test
PORT=5101
DATABASE_URL=postgresql://serve:<password>@localhost:5432/serve_test?schema=public
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
FIREBASE_PROJECT_ID=demo-serve
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
PAYMENT_MODE=mock
PAYMENT_SECRET=<a different openssl rand -hex 32>
LOG_LEVEL=silent
RATE_LIMIT_MAX=100000
SENSITIVE_RATE_LIMIT_MAX=100000
```

Using a `demo-` project id makes the Firebase CLI run fully offline with no
credentials. Switching to a real Firebase project only needs environment
changes: set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and
`FIREBASE_PRIVATE_KEY`, and remove `FIREBASE_AUTH_EMULATOR_HOST`.

## 5. Firebase Auth Emulator

```bash
npm run emulators          # firebase emulators:start --only auth --project demo-serve
```

It listens on `127.0.0.1:9099` (configured in `firebase.json`). Keep it
running in a separate terminal while developing. Emulator accounts live in
memory and disappear when the emulator stops.

## 6. Database schema and seed data

```bash
npm run prisma:migrate:deploy --workspace backend   # apply migrations to serve_dev
npm run db:seed --workspace backend                 # canteens, hostels, menus (idempotent)
```

Demo accounts (emulator only; refuses anything else):

```bash
DEV_SEED_PASSWORD='choose-a-password' npm run db:seed:dev-users --workspace backend
```

This creates `admin@serve.dev`, `staff.kg@serve.dev` (approved, Krishna &
Godavari), `staff.pending@serve.dev` (pending, with an access request) and
`student@serve.dev` (Krishna hostel), all with `DEV_SEED_PASSWORD`. Re-run it
after restarting the emulator; it re-links the existing rows.

Provision an admin explicitly:

```bash
ADMIN_BOOTSTRAP_PASSWORD='choose-a-password' \
  npm run admin:create --workspace backend -- --email ops@serve.dev --name "Ops Admin"
```

In production the Firebase user must already exist (create it in the Firebase
console). The script then only links it, requires `--confirm-production`, and
never accepts a password.

Schema changes (from `backend/`): run
`npx prisma migrate dev --create-only --name <change>`, review the generated
SQL, then `npx prisma migrate dev` to apply it.

## 7. Run the backend

```bash
npm run dev:backend               # tsx watch, http://localhost:5001
curl localhost:5001/api/health
curl localhost:5001/api/health/db
```

Production-style:

```bash
npm run build
NODE_ENV=development node backend/dist/server.js    # local check of the compiled build
npm run start --workspace backend                   # NODE_ENV=production: needs production env vars
```

### Calling the API locally

```bash
TOKEN=$(curl -s -X POST \
  'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo' \
  -H 'Content-Type: application/json' \
  -d '{"email":"student@serve.dev","password":"<DEV_SEED_PASSWORD>","returnSecureToken":true}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).idToken')
curl -H "Authorization: Bearer $TOKEN" localhost:5001/api/auth/me
```

## 8. Tests

Two equivalent options:

```bash
# A) emulator already running (npm run emulators)
npm test

# B) start a temporary emulator just for the run
npm run test:emulator
```

| Suite | What it covers |
|---|---|
| `tests/unit/` | env validation rules, log redaction, role guards |
| `tests/integration/health`, `app` | health checks (including database down), security headers, CORS, request ids, error contract, rate limiting |
| `database` | constraints, cascades, snapshots, partial unique index, seed idempotency |
| `auth` | Firebase token verification (malformed, forged, revoked, disabled), registration rules, admin bootstrap |
| `menu` | canteen visibility, menu, staff menu management, cross-canteen isolation |
| `orders` | quotes, server totals, snapshots, idempotency, paused/inactive canteens, state machine, IDOR |
| `payments` | mock flow, amount mismatch, replay, signature checks, webhook replay protection |
| `staff-admin` | approval lifecycle, admin canteen/hostel/staff management, notifications, recommendations |
| `realtime` | Socket.IO auth, room isolation, menu subscriptions, post-commit events, assignment moves |
| `critical-flow` | the full admin → staff → student → payment → realtime pickup scenario |
| `security` | 401/403 sweep over every protected route, malformed ids, no leaked internals |

The global setup **recreates `serve_test` from the migrations on every run**.
It refuses any database whose name does not end in `_test`. Emulator accounts
are never cleared, so development demo accounts survive test runs.

Other checks:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
npm audit
```

## 9. Ports

| Service | Port |
|---|---|
| Backend | 5001 (5000 is rejected because of macOS AirPlay) |
| Firebase Auth Emulator | 9099 |
| PostgreSQL | 5432 |
| Staff dashboard / admin portal (later phases) | 5173 / 5174 |

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `Firebase Auth Emulator is not reachable` when running tests | Start `npm run emulators`, or use `npm run test:emulator`. |
| `Invalid environment configuration: …` at startup | The message names each bad variable; compare with `.env.example`. |
| `Port 5001 is already in use` | Another backend is running; stop it. |
| `/api/health/db` returns 503 | PostgreSQL is down or `DATABASE_URL` is wrong. |
| Demo users can't sign in | The emulator was restarted (accounts are in memory); re-run `db:seed:dev-users`. |
| `AUTH_TOKEN_EXPIRED` | ID tokens last one hour; sign in again. |
| `Cannot read properties of undefined (reading 'upsert')` from the seed | Run `npm run prisma:generate --workspace backend` after schema changes (Prisma 7 does not auto-generate on migrate). |
| `prisma migrate dev` shows drift | Never resolve drift on shared data with `migrate reset`. Inspect it with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`. |

## 11. Conventions

- TypeScript strict, ESM, module-per-feature under `backend/src/modules/`.
- Only `src/config/env.ts` reads `process.env`.
- Services hold business rules; routers validate input with zod and call services.
- Multi-record changes run in `prisma.$transaction`. Realtime events go into an `Outbox` and are published only after commit.
- Throw `AppError` subclasses. The central handler shapes every error response.
- Never trust client-supplied prices, totals, roles, ids or canteen assignments.
- Git: feature branch, logical commits, owner-reviewed PRs. No force-push and no direct commits to `main`.
