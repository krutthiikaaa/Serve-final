# SERVE — Development guide

## 1. Toolchain

- Node.js ≥ 22.12 (`nvm use` reads `.nvmrc`)
- PostgreSQL 16 running locally on port 5432
- _(Phase 3)_ Java 21 + `firebase-tools` for the Auth Emulator
- _(Phase 5)_ Flutter 3.47.4 / Dart 3.13.3

## 2. First-time setup

```bash
git clone https://github.com/krutthiikaaa/Serve-final.git && cd Serve-final
npm install

# PostgreSQL role + databases (idempotent)
SERVE_DB_PASSWORD='choose-a-password' npm run db:setup:local

# Env files (gitignored)
cp .env.example backend/.env
cp .env.example backend/.env.test
```

Edit **`backend/.env`**:

```dotenv
NODE_ENV=development
PORT=5001
DATABASE_URL=postgresql://serve:<password>@localhost:5432/serve_dev?schema=public
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
PAYMENT_MODE=mock
PAYMENT_SECRET=<openssl rand -hex 32>
LOG_LEVEL=debug
```

Edit **`backend/.env.test`** the same way, but with `NODE_ENV=test`,
`PORT=5101`, `DATABASE_URL=…/serve_test…`, a different `PAYMENT_SECRET` and
`LOG_LEVEL=silent`.

> Docker alternative (not used by this repo's own verification):
> `docker run -d --name serve-pg -e POSTGRES_USER=serve -e POSTGRES_PASSWORD=<pw> -e POSTGRES_DB=serve_dev -p 5432:5432 postgres:16`
> then `docker exec serve-pg createdb -U serve serve_test`.

## 3. Running the backend

```bash
npm run dev:backend            # tsx watch, http://localhost:5001
curl localhost:5001/api/health
curl localhost:5001/api/health/db
```

Production-style:

```bash
npm run build --workspace backend
NODE_ENV=production node backend/dist/server.js   # needs production env vars
```

## 4. Scripts

Root (runs across workspaces):

| Script | Does |
|---|---|
| `npm run dev:backend` | Backend with live reload |
| `npm run db:setup:local` | Create local role and databases |
| `npm test` | All tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (type-aware) |
| `npm run format` / `format:check` | Prettier |
| `npm run build` | Production builds |

Backend (`--workspace backend`): `prisma:generate`, `prisma:validate`,
`prisma:migrate:dev`, `prisma:migrate:deploy`, `prisma:migrate:status`,
`test:watch`.

## 5. Testing

- **Unit** (`backend/tests/unit`): environment validation rules and log redaction.
- **Integration** (`backend/tests/integration`): the real Express app with
  Supertest against the real `serve_test` PostgreSQL database. Covers health,
  database-down behaviour (a real client pointed at a closed port), security
  headers, CORS, request ids, error contract and rate limiting.
- The tests refuse to run unless `NODE_ENV=test`.

## 6. Conventions

- TypeScript strict, ESM (`"type": "module"`, NodeNext resolution, `.js` import suffixes).
- Only `src/config/env.ts` reads `process.env`.
- Errors: throw `AppError` subclasses. The central handler shapes responses.
- Money in integer paise. Never trust client prices, totals, identities or canteen ids.
- No hardcoded business data and no fake or mocked API responses in app code.

## 7. Git workflow

- Never commit to or push `main` directly, never force-push, never rewrite history.
- One logical commit per phase (`feat: …`, `test: …`, `docs: …`).
- Before every commit: tests, typecheck, lint, build, `git diff` review, secret scan.
- The owner reviews and merges through pull requests.

## 8. Ports

| Service | Port |
|---|---|
| Backend (dev) | 5001 (never 5000, because of macOS AirPlay) |
| Backend (test runs) | 5101 |
| Staff dashboard | 5173 _(Phase 6)_ |
| Admin portal | 5174 _(Phase 7)_ |
| Firebase Auth Emulator | 9099 _(Phase 3)_ |
| PostgreSQL | 5432 |
