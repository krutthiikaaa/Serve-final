# SERVE — Architecture

_Status: Phase 1 implemented (backend foundation). Sections marked
**(planned)** describe the design approved for later phases._

## 1. System overview

```
┌──────────────┐  ┌──────────────────┐  ┌───────────────┐
│ Student App  │  │ Staff Dashboard  │  │ Admin Portal  │
│  (Flutter)   │  │  (React + Vite)  │  │ (React + Vite)│
└──────┬───────┘  └────────┬─────────┘  └──────┬────────┘
       │ ① Firebase sign-in (email/password) → ID token
       ▼                   ▼                    ▼
   ┌────────────── Firebase Authentication ──────────────┐
   └──────────────────────────────────────────────────────┘
       │ ② HTTPS REST   Authorization: Bearer <idToken>
       │ ③ Socket.IO    auth: { token }
       ▼
┌──────────────────────── Backend (Express 5 + Socket.IO) ────────────────────────┐
│ helmet · strict CORS · rate limit · request ids · redacted structured logs      │
│ verifyIdToken → principal resolved from PostgreSQL (role, status, canteen)      │
│ Services: menu · orders (state machine) · payments (provider interface) · staff │
│ Domain events (after commit) → rooms student:<id> / canteen:<id> / admin        │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    ▼ Prisma 7 + @prisma/adapter-pg
                              PostgreSQL 16
```

**Core rule: Firebase proves identity; PostgreSQL decides authorisation.**
The backend works out the student, staff member or admin and their canteen
scope from the verified token's UID. It never takes these from request
bodies, and it never accepts prices or totals from clients.

## 2. Backend layout (implemented)

```
backend/src/
├── config/
│   ├── env.ts            zod-validated configuration; the ONLY reader of process.env
│   └── logger.ts         pino with secret redaction
├── lib/
│   ├── errors.ts         AppError hierarchy (400/401/403/404/409/422/503)
│   └── prisma.ts         PrismaClient factory (node-postgres driver adapter)
├── middleware/
│   ├── request-logger.ts pino-http + X-Request-Id
│   └── error-handler.ts  central error → JSON translation, 404 handler
├── modules/
│   └── health/           GET /api/health, GET /api/health/db
├── generated/prisma/     generated client (gitignored)
├── app.ts                createApp({ env, logger, prisma }): dependency-injected
└── server.ts             process entry: env → logger → prisma → HTTP, graceful shutdown
```

`createApp` receives its dependencies, so the integration tests run the real
application against a real PostgreSQL test database without mocks.

### Request pipeline

1. `trust proxy` (configurable hop count, for correct client IPs behind a load balancer)
2. Request logger: assigns or propagates `X-Request-Id`, logs with secrets redacted
3. `helmet`: strict CSP (`default-src 'none'`), HSTS, nosniff, frame protection
4. CORS: exact-origin allowlist from `CORS_ORIGINS`. No credentials, because the API uses Bearer tokens rather than cookies.
5. JSON body parser (100 kB limit)
6. `/api/health`: mounted before the rate limiter so probes are never throttled
7. Rate limiter on `/api` (per client IP, IETF draft-8 headers)
8. Feature routers _(Phase 4+)_
9. 404 handler, then the central error handler

### Error contract

```json
{ "error": { "code": "DATABASE_UNAVAILABLE", "message": "Database is unreachable", "requestId": "…" } }
```

Unknown errors are logged in full on the server and returned as a generic
`500 INTERNAL_ERROR`. Stack traces, SQL and connection details never reach clients.

## 3. Environments

| | development | test | production |
|---|---|---|---|
| Env source | `backend/.env` | `backend/.env.test` | platform/secrets manager only |
| Database | `serve_dev` | `serve_test` | managed PostgreSQL |
| Firebase | Auth Emulator | Auth Emulator | real project (credentials required) |
| CORS | localhost allowed | localhost allowed | https only, localhost rejected |
| Logs | pretty | silent | JSON |

Production startup fails fast when it's configured with local origins, the
Firebase emulator or missing Firebase credentials. It never falls back to
localhost.

## 4. Authentication (planned — Phase 3)

1. The client signs in with the Firebase SDK and attaches its ID token as `Authorization: Bearer`.
2. The backend runs `verifyIdToken(token, checkRevoked)` to get the UID.
3. `requireStudent` / `requireStaff` / `requireAdmin` look up the UID in that role's table and check active status. Approved staff get `canteenId` attached from the database.
4. Student self-registration (`POST /api/auth/student/register`, with name and hostel) only ever creates a Student. An optional university email-domain restriction is configured by environment variable.
5. Admins are bootstrapped with a CLI script. No role can be self-assigned.

## 5. Realtime (planned — Phase 8)

Socket.IO handshake: `auth.token` is a Firebase ID token, verified the same way as REST.
**Rooms are assigned by the server**, and clients cannot join arbitrary rooms:
`student:<id>`, `staff:<id>`, `canteen:<id>` (approved staff only), `admin`,
plus a read-only `canteen-public:<id>` room for menu and status events.
Events are emitted only after the database transaction commits.

## 6. Payments (planned — Phase 9)

A `PaymentProvider` interface with `MockProvider` (now) and `RazorpayProvider`
(later). The backend re-prices the cart from PostgreSQL, creates the order
(`PLACED`) and payment (`PENDING`), and verifies an HMAC signature
(`PAYMENT_SECRET`) before moving the order to `PAYMENT_CONFIRMED`. An
`Idempotency-Key` header with a unique constraint prevents duplicate orders.

## 7. Deployment (planned — Phase 12)

The backend runs as a container (ECS Fargate or App Runner) behind an ALB,
with RDS PostgreSQL. `prisma migrate deploy` runs as a release step. The
React apps are static builds on S3 + CloudFront. Running more than one
backend instance needs the Socket.IO Redis adapter.
