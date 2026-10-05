# SERVE

### Order. Track. Collect.

> **Under active development.** SERVE is being built in 12 reviewed phases.
> **Phase 1 is done:** the monorepo and backend foundation (Express server,
> validated environment configuration, PostgreSQL through Prisma, security
> middleware and health endpoints). The Student App, Staff Dashboard and
> Admin Portal **are not implemented yet**. Wherever this README describes
> them, it describes the approved design, not working software. See
> [Current Development Status](#17-current-development-status).

---

## 2. Overview

SERVE is a digital night-canteen ordering platform designed for university
students. It reduces long queues and uncertainty during peak night-canteen
hours by allowing students to browse menus, place orders, make online
payments, receive an order number, track order status in real time, and
collect their food when it is ready.

## 3. Problem We Solve

During peak hours, students queue at the night canteen in person, and they
don't know:

- how long the queue will take
- whether the food they want is available
- whether their order is ready
- what stage their order is at

## 4. How SERVE Works

1. A student signs in to the mobile app and picks a night canteen. It
   defaults to the canteen linked to their hostel.
2. They browse that canteen's menu, add items to their cart and check out.
3. They pay online. There is **no cash on delivery** and **no delivery to
   rooms**.
4. They get an order number (for example `SV1024`) and follow its status live.
5. Canteen staff see the order immediately, then mark it preparing, ready
   and collected.
6. When the order is **ready**, the student walks over and collects it.

## 5. Key Features

All of the following are **planned**. The phase that delivers each one is
shown in brackets.

- Canteen-specific menus served from the database. Nothing is hardcoded in
  the apps. (Phase 4–5)
- A cart tied to one canteen at a time, with confirmation before switching
  canteens. (Phase 5)
- Server-side pricing and totals. Prices and totals sent by clients are never
  trusted. (Phase 4)
- Online payment, built as a mock provider first in a Razorpay-ready design,
  with idempotency protection against duplicate orders. (Phase 9)
- Real-time order status, menu and canteen updates over authenticated
  Socket.IO. (Phase 8)
- Staff menu management and pausing/resuming orders, scoped strictly to the
  staff member's assigned canteen. (Phase 4, 6)
- Admin management of canteens, staff approval and canteen assignment.
  (Phase 4, 7)

## 6. Three Interfaces

| Interface | Users | Form factor | Status |
|---|---|---|---|
| **Student App** | Students | Mobile only (Flutter). Bottom navigation: Home · Menu · Orders · Profile; cart in the header | Planned (Phase 5) |
| **Staff Dashboard** | Canteen staff | Desktop/tablet web, sidebar navigation | Planned (Phase 6) |
| **Admin Portal** | Administrators | Desktop/tablet web, sidebar navigation | Planned (Phase 7) |

All three talk to **one shared backend**.

## 7. System Architecture

```
 Student App (Flutter)   Staff Dashboard (React)   Admin Portal (React)
          │                        │                        │
          │  1. Firebase Authentication (email/password) -> ID token
          │  2. REST over HTTPS   Authorization: Bearer <token>
          │  3. Socket.IO         token-authenticated, server-assigned rooms
          ▼                        ▼                        ▼
 ┌──────────────── Shared backend: Node.js · Express · Socket.IO ───────────────┐
 │  Firebase proves identity -> PostgreSQL decides role, status, canteen access │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     ▼  Prisma
                               PostgreSQL
```

- **PostgreSQL is the source of truth** for users, roles, hostels, canteens,
  menus, prices, availability, staff assignments, change requests, orders,
  payments and notifications.
- The backend works out who the caller is, and which canteen they may act on,
  from the verified Firebase token. It never trusts IDs, roles, canteen
  assignments, prices or totals sent by a client.

Details: [docs/architecture.md](docs/architecture.md).

## 8. Tech Stack

| Layer | Technology | Status |
|---|---|---|
| Student App | Flutter 3.47.4 + Dart 3.13.3 | Planned |
| Staff Dashboard | React 19 + TypeScript + Vite | Planned |
| Admin Portal | React 19 + TypeScript + Vite | Planned |
| Backend | Node.js + TypeScript + Express + Socket.IO | Express foundation **implemented**; Socket.IO planned |
| Database | PostgreSQL + Prisma | Connection **implemented**; schema planned (Phase 2) |
| Authentication | Firebase Authentication + Firebase Admin | Planned (Phase 3) |
| Payments | Mock provider, Razorpay-ready | Planned (Phase 9) |

## 9. User Roles

| Role | How the account is created | Can do |
|---|---|---|
| **Student** | Self-registration (Firebase email/password, then a backend registration step with name, email and hostel). An optional university email-domain restriction is configurable. | Browse active canteens, order, pay, track, view history and notifications |
| **Staff** | Self-registration, then a canteen access request reviewed by an admin | After approval, manage orders, the menu and the order-taking status of their **assigned canteen only** |
| **Admin** | Bootstrapped by an operator script; never self-assigned | Manage canteens, review staff requests, assign or reassign or deactivate staff |

Roles live in PostgreSQL. A user who registers through the student flow can
only ever become a Student.

## 10. Canteen Structure

Each student belongs to a **hostel**, and each hostel belongs to a **night
canteen**. Hostels and canteens are stored as separate database records, so
new hostel towers can be added without code changes.

| Hostels | Night canteen |
|---|---|
| Krishna + Godavari | Krishna & Godavari Night Canteen |
| Yamuna + Narmada | Yamuna & Narmada Night Canteen |
| New Hostel | New Hostel Night Canteen |
| Vedavathi | Vedavathi Night Canteen |
| Ganga A + Ganga B | Ganga A & Ganga B Night Canteen |

A student's default canteen comes from their hostel. They may also order from
any other canteen that is **active** and **accepting orders**. The backend
re-checks this on every order. The mapping above is seed data (Phase 2), not
application code.

## 11. Order Lifecycle

```
PLACED -> PAYMENT_CONFIRMED -> PREPARING -> READY -> COLLECTED

CANCELLED is also a possible terminal state.
```

Only valid transitions are allowed, and the backend enforces them. Staff see
an order only after payment is confirmed. Each order item keeps a snapshot of
the item name, unit price and quantity, so later menu changes never alter
past orders.

## 12. Project Structure

The planned monorepo layout. Entries marked *(planned)* don't exist yet.

```
serve/
├── backend/            Node.js + TypeScript + Express + Prisma   (Phase 1 – present)
├── student-app/        Flutter mobile app                        (planned – Phase 5)
├── staff-dashboard/    React + TypeScript + Vite                 (planned – Phase 6)
├── admin-portal/       React + TypeScript + Vite                 (planned – Phase 7)
├── e2e/                Cross-application end-to-end tests        (planned – Phase 10)
├── docs/               Architecture, API, database, development  (present)
├── brand/              Official logo location and palette        (present; logo pending)
├── firebase.json       Firebase Auth Emulator configuration      (planned – Phase 3)
├── .env.example        Documented environment variables          (present)
├── .gitignore
├── package.json        npm workspaces
└── README.md
```

Current backend layout:

```
backend/
├── prisma/schema.prisma      generator + datasource (models arrive in Phase 2)
├── prisma.config.ts          Prisma CLI configuration
├── scripts/db-setup-local.sh idempotent local role/database creation
├── src/
│   ├── config/               env validation, logger
│   ├── lib/                  errors, Prisma client factory
│   ├── middleware/           request logging, error handling
│   ├── modules/health/       health endpoints
│   ├── app.ts                Express application
│   └── server.ts             process entry point
└── tests/                    unit + integration (real PostgreSQL)
```

## 13. Local Development Setup

Only the backend can be run at this stage.

### Prerequisites

- Node.js 22.12 or newer (see `.nvmrc`) and npm 10+
- PostgreSQL 16 running locally on port 5432

### Steps

```bash
# 1. Install dependencies (npm workspaces)
npm install

# 2. Create the local PostgreSQL role "serve" and databases serve_dev + serve_test.
#    Safe to re-run; never drops anything.
SERVE_DB_PASSWORD='choose-a-password' npm run db:setup:local
#    If your superuser is only reachable as the postgres OS user:
#    SERVE_DB_PASSWORD='...' PSQL_ADMIN="sudo -u postgres psql -d postgres" npm run db:setup:local

# 3. Create env files from the template (both are gitignored)
cp .env.example backend/.env
cp .env.example backend/.env.test
#    backend/.env      -> NODE_ENV=development, DATABASE_URL .../serve_dev
#    backend/.env.test -> NODE_ENV=test,        DATABASE_URL .../serve_test
#    In both: set the database password and PAYMENT_SECRET (openssl rand -hex 32)

# 4. Run the backend with live reload on http://localhost:5001
npm run dev:backend

# 5. Check it
curl http://localhost:5001/api/health
curl http://localhost:5001/api/health/db
```

Production-style build and start:

```bash
npm run build
npm run start --workspace backend    # sets NODE_ENV=production; needs production variables
```

The backend uses port **5001**. Port 5000 is rejected because it conflicts
with macOS AirPlay Receiver. The full guide is in
[docs/development.md](docs/development.md).

## 14. Environment Variables

Every variable is documented in [`.env.example`](.env.example) and validated
at startup. The server refuses to start on invalid configuration, and the
error names the variable without printing its value.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | no | `development` (default), `test`, `production` |
| `PORT` | no | Default `5001`; `5000` rejected |
| `DATABASE_URL` | yes | `postgresql://…` |
| `CORS_ORIGINS` | yes | Comma-separated exact origins; production requires https and no localhost |
| `PAYMENT_MODE` | no | `mock` (default) or `razorpay` |
| `PAYMENT_SECRET` | yes | At least 32 characters |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | production | Used from Phase 3 |
| `FIREBASE_AUTH_EMULATOR_HOST` | no | Development/test only; rejected in production |
| `TRUST_PROXY`, `LOG_LEVEL`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | no | See `.env.example` |

| Environment | Configuration source | Database |
|---|---|---|
| development | `backend/.env` | `serve_dev` |
| test | `backend/.env.test` | `serve_test` |
| production | Platform environment / secrets manager only (no file is read) | Managed PostgreSQL |

## 15. Testing

```bash
npm test             # backend: Vitest + Supertest against the real serve_test database
npm run typecheck
npm run lint
npm run format:check
npm run build
```

The current suite (Phase 1) covers environment validation, log redaction,
both health endpoints (including a real unreachable-database case), security
headers, CORS, request IDs, the error format and rate limiting. HTTP and the
database are not mocked. Cross-application end-to-end tests are planned for
Phase 10.

## 16. Security

Implemented in Phase 1:

- Startup validation of all configuration. In production, localhost or
  plain-http CORS origins and the Firebase emulator are rejected, and Firebase
  credentials are required.
- `helmet` security headers with a strict content security policy.
- An exact-origin CORS allowlist with no cookie credentials (the API uses
  Bearer tokens).
- Rate limiting on the API (health checks are exempt) and a 100 kB JSON body
  limit.
- Structured logs that redact authorization headers, tokens, passwords,
  signatures and keys.
- One central error handler that never exposes stack traces or internal
  details.
- `.gitignore` rules that keep env files, private keys and service-account
  JSON out of the repository.

Planned:

- Firebase ID-token verification with roles and canteen scope taken from
  PostgreSQL (Phase 3).
- Per-canteen data isolation for staff and validated state transitions
  (Phase 4).
- Authenticated Socket.IO with server-assigned rooms (Phase 8).
- HMAC-verified payments with idempotency keys (Phase 9).
- A full security audit (Phase 11).

## 17. Current Development Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, backend foundation, environment configuration, PostgreSQL/Prisma connection, health endpoints | **Complete** |
| 2 | Database schema, migrations, seed data | Not started |
| 3 | Firebase authentication, roles, authorization | Not started |
| 4 | Backend REST APIs | Not started |
| 5 | Student App (Flutter) | Not started |
| 6 | Staff Dashboard (React) | Not started |
| 7 | Admin Portal (React) | Not started |
| 8 | Socket.IO realtime | Not started |
| 9 | Mock payments and verification | Not started |
| 10 | Full end-to-end testing | Not started |
| 11 | Production configuration and security audit | Not started |
| 12 | Documentation and deployment preparation | Not started |

## 18. Future Enhancements

- Razorpay payments in place of the mock provider
- Firebase Cloud Messaging for background push notifications
- AWS deployment (containerised backend, managed PostgreSQL, static web hosting)
- A Socket.IO Redis adapter for running several backend instances
- Student hostel/canteen change requests (the data model leaves room for this)

## Brand

The official SERVE logo is a transparent, hand-drawn food/leaf mark supplied
by the project owner and stored in [`brand/`](brand/). It is pending; the apps
will use only the official asset. Palette: olive `#879F2D`, dark olive
`#6F8425`, orange `#E86A2E`, black `#111111`, warm off-white `#F8F7F2`,
white `#FFFFFF`, muted grey `#5F6258`.

## 19. Contributors

Maintained by the owner of this repository. The project owner will add
contributor credits.

Contributions follow an owner-reviewed workflow: work happens on feature
branches with logical commits, and the owner reviews pull requests before
merging. Nobody commits directly to `main`, force-pushes or rewrites shared
history.

## Further documentation

- [docs/architecture.md](docs/architecture.md)
- [docs/api.md](docs/api.md)
- [docs/database.md](docs/database.md)
- [docs/development.md](docs/development.md)
