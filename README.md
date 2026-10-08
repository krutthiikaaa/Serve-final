# SERVE

### Order. Track. Collect.

> **Under active development.** The **backend** (PostgreSQL, Firebase
> authentication, REST API, mock payments, Socket.IO realtime) and **all three
> client apps** (Flutter Student App, React Staff Dashboard, React Admin
> Portal) are implemented and integrated, with unit, widget, integration and
> end-to-end tests. Not done yet: real Razorpay payments, push notifications
> and production deployment. See
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

Implemented in the backend (API + realtime):

- Canteen-specific menus served from PostgreSQL. Unavailable items stay
  visible but cannot be ordered.
- Server-side pricing and totals. Prices, totals, roles and identities sent by
  clients are never trusted.
- Orders with immutable item snapshots, public order numbers (`SV1001`, …)
  and `Idempotency-Key` protection against duplicates.
- Online payment through a provider abstraction: a mock provider for
  development and a Razorpay adapter (signature verification done; API calls
  pending). Amounts are verified and every payment event is processed once.
- Realtime order status, menu, canteen and staff-assignment updates over
  authenticated Socket.IO, with rooms assigned by the server.
- Staff menu management and pausing/resuming orders, strictly limited to the
  staff member's assigned canteen.
- Admin management of canteens, hostels, staff approval, assignment and
  deactivation.
- Persistent notifications for order and staff events.

Implemented in the client apps:

- **Student App:** registration with hostel, canteen selection, menu with
  live availability, one-canteen cart with a switch confirmation, server
  quotes, pickup-only checkout, mock payment, a large order number, live
  order tracking, order history, notifications and profile.
- **Staff Dashboard:** onboarding and approval states, live counters, an
  order board (New → Preparing → Ready → Collected) fed by paid orders only,
  menu management with prices in rupees, pause/resume, notifications.
- **Admin Portal:** platform dashboard, canteen activation and pausing,
  staff change-request review, staff assignment and deactivation,
  notifications.

## 6. Three Interfaces

| Interface | Users | Form factor | Status |
|---|---|---|---|
| **Student App** | Students | Mobile (Flutter: Android, iOS; web build for testing). Bottom navigation: Home · Menu · Orders · Profile; cart in the header | **Implemented** |
| **Staff Dashboard** | Canteen staff | Desktop/tablet web, sidebar navigation | **Implemented** |
| **Admin Portal** | Administrators | Desktop/tablet web, sidebar navigation | **Implemented** |

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
| Student App | Flutter 3.47.4 + Dart 3.13.3 (provider, http, socket_io_client) | **Implemented** |
| Staff Dashboard | React 19 + TypeScript + Vite 8 | **Implemented** |
| Admin Portal | React 19 + TypeScript + Vite 8 | **Implemented** |
| Shared web code | `packages/contracts` (zod contract + types), `packages/web-shared` | **Implemented** |
| Backend | Node.js + TypeScript + Express + Socket.IO | **Implemented** |
| Database | PostgreSQL + Prisma | **Implemented** (schema, migration, seed) |
| Authentication | Firebase Authentication + Firebase Admin | **Implemented** (Auth Emulator in development; a real project is configuration-only) |
| Payments | Mock provider, Razorpay-ready | Mock **implemented**; Razorpay API calls pending |

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
re-checks this on every order. The mapping above is seed data in PostgreSQL,
not application code. Admins can add hostels or remap them through the API.

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

The monorepo layout:

```
serve/
├── backend/              Node.js + TypeScript + Express + Socket.IO + Prisma
├── apps/
│   ├── student/          Flutter student app (Android, iOS, web)
│   ├── staff/            React staff dashboard (Vite, port 5173)
│   └── admin/            React admin portal (Vite, port 5174)
├── packages/
│   ├── contracts/        Frozen API contract: zod schemas + TypeScript types
│   └── web-shared/       API client, auth, realtime, UI kit shared by staff + admin
├── e2e/                  Playwright end-to-end tests (isolated stack)
├── docs/                 Architecture, API, database, development, frontend
├── brand/                Official logo location and palette (logo pending)
├── firebase.json         Firebase Auth Emulator configuration
├── .env.example          Documented backend environment variables
├── package.json          npm workspaces
└── README.md
```

Backend layout:

```
backend/
├── prisma/            schema.prisma, migrations/, seed.ts
├── scripts/           db-setup-local.sh, create-admin.ts, seed-dev-users.ts
├── src/
│   ├── config/        env validation, logger
│   ├── lib/           errors, Prisma, Firebase verifier
│   ├── middleware/    authentication + role guards, rate limits, logging, errors
│   ├── modules/       auth, canteens, menu, orders, payments, change-requests,
│   │                  staff, admin, notifications, students, health
│   ├── realtime/      event outbox + Socket.IO server
│   ├── app.ts         Express composition
│   └── server.ts      HTTP + Socket.IO entry point
└── tests/             unit + integration (PostgreSQL + Firebase Auth Emulator)
```

## 13. Local Development Setup

### Prerequisites

- Node.js 22.12 or newer (see `.nvmrc`) and npm 10+
- PostgreSQL 16 running locally on port 5432
- Java 21 and the Firebase CLI (`npm install -g firebase-tools`) for the Auth Emulator
- Flutter 3.47 (Dart 3.13) for the student app

### Steps

```bash
# 1. Install dependencies (npm workspaces)
npm install

# 2. Create the local PostgreSQL role "serve" and databases serve_dev + serve_test.
#    Safe to re-run; never drops anything.
SERVE_DB_PASSWORD='choose-a-password' npm run db:setup:local
#    If your superuser is only reachable as the postgres OS user:
#    SERVE_DB_PASSWORD='...' PSQL_ADMIN="sudo -u postgres psql -d postgres" npm run db:setup:local

# 3. Create env files from the template (both are gitignored), then edit them
cp .env.example backend/.env
cp .env.example backend/.env.test
#    See docs/development.md for the exact values for each file.

# 4. Start the Firebase Auth Emulator (separate terminal)
npm run emulators

# 5. Apply migrations and seed canteens, hostels and menus
npm run prisma:migrate:deploy --workspace backend
npm run db:seed --workspace backend

# 6. Optional: emulator demo accounts (admin, approved staff, pending staff, student)
DEV_SEED_PASSWORD='choose-a-password' npm run db:seed:dev-users --workspace backend

# 7. Run the backend with live reload on http://localhost:5001
npm run dev:backend
curl http://localhost:5001/api/health
curl http://localhost:5001/api/health/db
```

Then the client apps (each in its own terminal):

```bash
# Staff dashboard (http://localhost:5173) and admin portal (http://localhost:5174)
cp apps/staff/.env.example apps/staff/.env.development.local
cp apps/admin/.env.example apps/admin/.env.development.local
npm run dev:staff
npm run dev:admin

# Student app in Chrome on http://localhost:5555 (needs Flutter 3.47+)
npm run dev:student
# ...or on an Android emulator / other device (see `flutter devices`)
npm run dev:student -- -d emulator-5554
```

The student app's development defaults already point at the local backend and
the Auth Emulator (Android emulators reach your machine as `10.0.2.2`). The
backend's `CORS_ORIGINS` must include `http://localhost:5555` for the web
version (it is in `.env.example`). If the student app doesn't start or can't
sign in, see the troubleshooting table in
[apps/student/README.md](apps/student/README.md#troubleshooting).

Provision an admin explicitly (there is no public admin registration):

```bash
ADMIN_BOOTSTRAP_PASSWORD='choose-a-password' \
  npm run admin:create --workspace backend -- --email ops@serve.dev --name "Ops Admin"
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
| `FIREBASE_PROJECT_ID` | yes | `demo-serve` with the emulator; a real project id in production (`demo-` is rejected there) |
| `FIREBASE_AUTH_EMULATOR_HOST` | no | Development/test only; rejected in production |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | without emulator | Service-account values (never commit the JSON) |
| `STUDENT_EMAIL_DOMAINS` | no | Optional university email-domain allowlist; empty disables it |
| `PAYMENT_MODE` | no | `mock` (default, development/test only) or `razorpay` (required in production) |
| `PAYMENT_SECRET` | mock mode | At least 32 characters |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | razorpay mode | Placeholders only until the Razorpay integration is completed |
| `TRUST_PROXY`, `LOG_LEVEL`, `RATE_LIMIT_*`, `SENSITIVE_RATE_LIMIT_*` | no | See `.env.example` |

| Environment | Configuration source | Database |
|---|---|---|
| development | `backend/.env` | `serve_dev` |
| test | `backend/.env.test` | `serve_test` |
| production | Platform environment / secrets manager only (no file is read) | Managed PostgreSQL |

## 15. Testing

```bash
npm run test:emulator   # starts a temporary Firebase Auth Emulator and runs the backend suite
npm test                # same suite, if `npm run emulators` is already running
npm run typecheck
npm run lint
npm run format:check
npm run build
```

The backend suite runs against the real `serve_test` database, which every run
recreates from the migrations, and against the real Firebase Auth Emulator. It
covers:
- database constraints and seed idempotency
- token verification and registration
- menu management and cross-canteen isolation
- cart quotes, orders, idempotency and the state machine
- payments, including amount mismatch and replayed events
- staff approval and admin operations
- notifications
- Socket.IO authentication and room isolation
- a security sweep over every protected route
- a critical end-to-end flow (admin approval through to realtime pickup)

HTTP, the database and authentication are not mocked.

Client apps and end-to-end:

```bash
npm run test --workspace @serve/web-shared   # shared API client, realtime, formatting
npm run test --workspace @serve/staff        # staff dashboard components
npm run test --workspace @serve/admin        # admin portal components
(cd apps/student && flutter analyze && flutter test)
npm run test:e2e                             # Playwright: isolated backend on serve_test + both web apps
E2E_STUDENT_WEB=1 npm run test:e2e           # also builds and drives the Flutter web app
```

The end-to-end suite starts its own backend on `serve_test` (reset and seeded
per run) and its own copies of the web apps, so development data is never
touched. It covers the critical flow (staff onboarding, admin approval, paid
order, live kitchen progress, pickup), realtime isolation between canteens and
students, live menu changes, canteen pausing, staff deactivation, cancellation
with refund, cross-portal access control, and visual captures of every
screen.

## 16. Security

Implemented:

- Firebase ID-token verification with revocation checks. Roles, staff status
  and canteen scope come from PostgreSQL only.
- Strict per-canteen isolation for staff, and per-student isolation for orders
  and notifications. Out-of-scope resources return 404.
- Server-side prices and totals, a backend-enforced order state machine,
  idempotent order creation, and amount-verified, replay-safe payments.
- Authenticated Socket.IO with rooms assigned by the server.
- Startup validation of all configuration. Production rejects localhost or
  plain-http CORS origins, the Firebase emulator, `demo-` projects and the
  mock payment provider.
- `helmet` headers with a strict CSP, an exact-origin CORS allowlist, global
  and per-user rate limits, request-size limits, and zod validation of all
  input.
- Redacted structured logs, and a central error handler that never exposes
  internals.
- `.gitignore` rules for env files, private keys and service-account JSON.

Client apps:

- Routing is decided only by `/api/auth/me`; no client trusts a role from the
  token, the URL or local storage.
- Clients never send prices, totals, user ids or canteen assignments; totals
  shown come from the backend quote or order.
- Only public configuration (API URL, Firebase web key) is built into the
  apps. Production builds refuse emulator settings, demo projects and
  localhost/plain-http API URLs.
- Socket.IO clients never name rooms.

Planned: a full production security audit and the real Razorpay integration.

## 17. Current Development Status

The backend master task combined database, authentication, REST APIs,
payments and realtime into backend Phases 2–5. Phase 6 built and integrated
the three client apps.

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, backend foundation, environment configuration, health endpoints | **Complete** |
| 2 | Database schema, migration, seed data | **Complete** |
| 3 | Firebase authentication, roles, authorization | **Complete** |
| 4 | REST APIs: canteens, menus, cart, orders, mock payments, staff, admin, notifications | **Complete** |
| 5 | Socket.IO realtime and the critical end-to-end backend flow | **Complete** |
| — | Backend audit and contract freeze | **Complete** |
| 6 | Student App (Flutter) | **Complete** |
| 6 | Staff Dashboard (React) | **Complete** |
| 6 | Admin Portal (React) | **Complete** |
| 6 | Cross-application end-to-end tests | **Complete** |
| — | Real Razorpay integration | Not started |
| — | Production security audit and deployment preparation | Not started |

## 18. Future Enhancements

- Razorpay payments in place of the mock provider
- Firebase Cloud Messaging for background push notifications
- AWS deployment (containerised backend, managed PostgreSQL, static web hosting)
- A Socket.IO Redis adapter for running several backend instances
- Student hostel/canteen change requests (the data model leaves room for this)

## Brand

The official SERVE logo is a transparent, hand-drawn food/leaf mark supplied
by the project owner and stored in [`brand/`](brand/). It is pending. Every
app has an empty logo slot and shows the plain text wordmark "SERVE" until the
official file is added; nothing imitates the logo. Palette: olive `#879F2D`, dark olive
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
- [docs/frontend-integration.md](docs/frontend-integration.md)
- [docs/frontend-architecture.md](docs/frontend-architecture.md)
- [apps/student/README.md](apps/student/README.md)
