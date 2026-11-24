# SERVE

### Order. Track. Collect.

> **Under active development.** The **backend** (PostgreSQL, Google sign-in
> through Better Auth, REST API, mock payments, Socket.IO realtime) and **all three
> client apps** (Flutter Student App, React Staff Dashboard, React Admin
> Portal) are implemented and integrated, with unit, widget, integration and
> end-to-end tests. Not done yet: real Razorpay payments, push notifications
> and production deployment. See
> [Current Development Status](#17-current-development-status).

> **Sign-in is role-specific (Better Auth).** Students: Google only, verified
> `@srmap.edu.in` accounts. Staff: email + password (any address; PENDING until
> an admin approves). Admins: email + password, `@srmap.edu.in`, provisioned
> with `admin:create`. The backend enforces the method per role.
> [docs/authentication.md](docs/authentication.md) is authoritative, and
> [docs/development.md](docs/development.md) is the local setup guide
> (Windows PowerShell included); some older pages under `docs/` still describe
> Firebase.

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

<img width="1482" height="555" alt="image" src="https://github.com/user-attachments/assets/5c71d512-858f-44a8-af08-70808d5e8287" />


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
| **Student App** | Students | Mobile (Flutter: Android, iOS); not published to the App Store or Google Play. The same code's web build runs in the browser on the demo domain for testing and demos. Bottom navigation: Home · Menu · Orders · Profile; cart in the header | **Implemented** |
| **Staff Dashboard** | Canteen staff | Desktop/tablet web, sidebar navigation; installable from Chrome/Edge | **Implemented** |
| **Admin Portal** | Administrators | Desktop/tablet web, sidebar navigation; installable from Chrome/Edge | **Implemented** |

All three talk to **one shared backend**.

## 7. System Architecture

```
 Student App (Flutter)   Staff Dashboard (React)   Admin Portal (React)
          │                        │                        │
          │  1. Sign-in (Better Auth): students Google (@srmap.edu.in);
          │     staff and admins email + password -> session
          │  2. REST over HTTPS   HttpOnly session cookie (web) or Bearer (mobile)
          │  3. Socket.IO         session-authenticated, server-assigned rooms
          ▼                        ▼                        ▼
 ┌──────────────── Shared backend: Node.js · Express · Socket.IO ───────────────┐
 │  Better Auth proves identity -> PostgreSQL decides role, status, canteen access │
 └───────────────────────────────────┬──────────────────────────────────────────┘
                                     ▼  Prisma
                               PostgreSQL
```

- **PostgreSQL is the source of truth** for users, roles, hostels, canteens,
  menus, prices, availability, staff assignments, change requests, orders,
  payments and notifications.
- The backend works out who the caller is, and which canteen they may act on,
  from the verified Better Auth session. It never trusts IDs, roles, canteen
  assignments, prices or totals sent by a client.

For a deployment, one backend process can also serve the three built apps on
a single domain: the student app at `/`, the staff dashboard at `/staff/`, the
admin portal at `/admin/`, with `/api` and `/socket.io` on the same origin.
See [docs/deployment.md](docs/deployment.md).

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
| Authentication | Better Auth: Google OAuth for students (verified `@srmap.edu.in` only); email + password (scrypt) for staff and admins | **Implemented** (automated tests use a test-only stand-in for Google; real Google sign-in needs your own OAuth client) |
| Payments | Mock provider, Razorpay-ready | Mock **implemented**; Razorpay API calls pending |

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
├── deploy/               Caddy and nginx configs, production env template
├── scripts/              dev-student, build-web (single-domain build), smoke-deploy
├── docs/                 Architecture, API, database, development, frontend, deployment
├── brand/                Official logo location and palette (logo pending)
├── .env.example          Documented environment variables (all apps)
├── Dockerfile            Optional single-domain image (backend + prebuilt web apps)
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
│   ├── lib/           errors, Prisma, Better Auth configuration, session verifier
│   ├── middleware/    authentication + role guards, rate limits, logging, errors
│   ├── modules/       auth, canteens, menu, orders, payments, change-requests,
│   │                  staff, admin, notifications, students, health
│   ├── realtime/      event outbox + Socket.IO server
│   ├── web/           single-domain hosting of the built web apps (WEB_ROOT)
│   ├── app.ts         Express composition
│   └── server.ts      HTTP + Socket.IO entry point
└── tests/             unit + integration (PostgreSQL + Better Auth)
```

## 13. Local Development Setup

### Prerequisites

- Node.js 22.12 or newer (see `.nvmrc`) and npm 10+
- PostgreSQL 16 running locally on port 5432
- A Google OAuth web client of your own for **student** sign-in (Google Cloud
  console → Google Auth Platform → Clients). Staff and admin sign-in need no
  Google client. Step by step: [docs/development.md](docs/development.md).
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

# 3. Create env files from the templates (both are gitignored), then fill in
#    your own values. Never copy anyone else's secrets.
cp backend/.env.example backend/.env
cp backend/.env.example backend/.env.test   # then apply the TEST notes at its end
#    BETTER_AUTH_SECRET:  openssl rand -base64 32
#    PAYMENT_SECRET:      openssl rand -hex 32
#    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (student sign-in): your own Google
#      OAuth web client with redirect URI http://localhost:5001/api/auth/callback/google
#      and JavaScript origin http://localhost:5555

# 4. Apply migrations and seed canteens, hostels and menus
#    (back up an existing database first: pg_dump serve_dev > backup.sql)
npm run prisma:migrate:deploy --workspace backend
npm run db:seed --workspace backend

# 5. Provision your admin account (asks for its password at a hidden prompt)
npm run admin:create --workspace backend -- --email you@srmap.edu.in --name "Your Name"

# 6. Optional: development staff/admin/student accounts
#    (set DEV_*_EMAIL variables; see .env.example; asks for one password)
npm run db:seed:dev-users --workspace backend

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

# Student app (mobile; needs Flutter 3.47+). See apps/student/README.md.
npm run dev:student                           # browser on http://localhost:5555
npm run dev:student -- -d emulator-5554       # Android emulator (`flutter devices` lists ids)
```

Open the apps at `http://localhost:…` (not `127.0.0.1`), so the session cookie
is sent. Students sign in to the student app with **Continue with Google**
using a verified `@srmap.edu.in` account, then register (name + hostel). Staff
use **Request access** on the staff dashboard (name, any email, password,
canteen) and stay pending until an admin approves them; then they sign in with
their email and password. Admins sign in to the admin portal with the email
and password from `admin:create`; there is no public admin registration.

The student app's development defaults point at the local backend (Android
emulators reach your machine as `10.0.2.2`). Google sign-in on a phone or
emulator needs the backend on a public https URL (`BETTER_AUTH_URL`, e.g. a
tunnel): see [docs/authentication.md](docs/authentication.md#native-app-android--ios).
If the student app doesn't start, see
[apps/student/README.md](apps/student/README.md#troubleshooting).

Production-style build and start:

```bash
npm run build
npm run start --workspace backend    # sets NODE_ENV=production; needs production variables
```

Deployment on one domain (student `/`, staff `/staff/`, admin `/admin/`, API
`/api`) with installable web apps and demo payments: see
[docs/deployment.md](docs/deployment.md). In short:

```bash
npm run build:web                                            # → dist/web (WEB_ROOT)
npm run smoke:deploy -- https://YOUR_DOMAIN                  # read-only checks after deploying
```

The backend uses port **5001**. Port 5000 is rejected because it conflicts
with macOS AirPlay Receiver. The full guide is in
[docs/development.md](docs/development.md).

## 14. Environment Variables

Every backend variable is documented in [`backend/.env.example`](backend/.env.example)
(all apps: [`.env.example`](.env.example)) and validated
at startup. The server refuses to start on invalid configuration, and the
error names the variable without printing its value.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | no | `development` (default), `test`, `production` |
| `PORT` | no | Default `5001`; `5000` rejected |
| `DATABASE_URL` | yes | `postgresql://…` |
| `CORS_ORIGINS` | yes | Comma-separated exact origins; production requires https and no localhost |
| `BETTER_AUTH_URL` | production | Public backend URL; Google redirect URI is `<it>/api/auth/callback/google`. Development default `http://localhost:5001` |
| `BETTER_AUTH_SECRET` | yes (not in tests) | At least 32 characters (`openssl rand -base64 32`); unique per environment and per developer |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google sign-in; production | Your own Google OAuth web client; both or neither |
| `GOOGLE_REQUIRE_HOSTED_DOMAIN` | no | `true` (default) also requires Google's `hd=srmap.edu.in` claim |
| `AUTH_TEST_SIGN_IN` | tests only | Test-only sign-in endpoint; refused unless `NODE_ENV=test` |
| `STUDENT_APP_URL`, `STAFF_DASHBOARD_URL`, `ADMIN_PORTAL_URL` | production | App URLs trusted as sign-in return addresses; local ports by default |
| `PAYMENT_MODE` | no | `mock` (default; in production only with `DEMO_MODE=true`) or `razorpay` |
| `DEMO_MODE` | no | `true` declares a public demo: mock payments allowed in production, no real money moves; every other production rule still applies |
| `WEB_ROOT` | no | Folder of built web apps (`npm run build:web`) to serve on the same domain; unset = API only |
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
npm test                # backend suite (needs PostgreSQL and backend/.env.test), then every workspace
npm run typecheck
npm run lint
npm run format:check
npm run build
```

The backend suite runs against the real `serve_test` database, which every run
recreates from the migrations, and the real Better Auth stack (the Google flow
runs with only Google's token endpoint replaced in-process). It covers:
- database constraints and seed idempotency
- role-specific sign-in (Google for students, passwords for staff and admins),
  the `@srmap.edu.in` rule, sessions, password changes and registration
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
npm run test:e2e:single-domain               # built apps + API + Socket.IO on one origin (needs Flutter)
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

- Role-specific sign-in through Better Auth, enforced by the backend on every
  session, REST request and Socket.IO connection: Google for students
  (verified `@srmap.edu.in` only), email + password (scrypt) for staff and
  admins. Database-backed sessions in HttpOnly cookies (Bearer tokens on
  mobile). Roles, staff status and canteen scope come from PostgreSQL only.
- Strict per-canteen isolation for staff, and per-student isolation for orders
  and notifications. Out-of-scope resources return 404.
- Server-side prices and totals, a backend-enforced order state machine,
  idempotent order creation, and amount-verified, replay-safe payments.
- Authenticated Socket.IO with rooms assigned by the server.
- Startup validation of all configuration. Production rejects localhost or
  plain-http CORS origins or auth URLs, missing Google credentials, the
  test-only sign-in and the mock payment provider (unless `DEMO_MODE=true` explicitly declares a demo).
- `helmet` headers with a strict CSP (`default-src 'none'` on the API; a
  same-origin script policy on the served web apps), an exact-origin CORS allowlist, global
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
- Only public configuration (the API URL) is built into the apps; no sign-in
  secret or client ID is. Production builds refuse localhost/plain-http API
  URLs.
- Socket.IO clients never name rooms.

A pre-deployment audit (configuration, secrets, authorization, realtime
isolation, a live end-to-end check against PostgreSQL)
is complete. Still planned: an independent security review of a deployed
instance and the real Razorpay integration.

## 17. Current Development Status

The backend master task combined database, authentication, REST APIs,
payments and realtime into backend Phases 2–5. Phase 6 built and integrated
the three client apps.

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, backend foundation, environment configuration, health endpoints | **Complete** |
| 2 | Database schema, migration, seed data | **Complete** |
| 3 | Authentication, roles, authorization (now role-specific via Better Auth) | **Complete** |
| 4 | REST APIs: canteens, menus, cart, orders, mock payments, staff, admin, notifications | **Complete** |
| 5 | Socket.IO realtime and the critical end-to-end backend flow | **Complete** |
| — | Backend audit and contract freeze | **Complete** |
| 6 | Student App (Flutter) | **Complete** |
| 6 | Staff Dashboard (React) | **Complete** |
| 6 | Admin Portal (React) | **Complete** |
| 6 | Cross-application end-to-end tests | **Complete** |
| — | Single-domain demo deployment preparation (routing, installable apps, configs, docs) | **Complete** (not deployed) |
| — | UI/UX polish and official branding | **Complete** (approved) |
| — | Pre-deployment integration and security audit | **Complete** (local stack; see [docs/deployment.md](docs/deployment.md#14-readiness)) |
| — | Real Razorpay integration | Not started |
| — | Independent security review of a deployed instance | Not started |

## 18. Future Enhancements

- Razorpay payments in place of the mock provider
- Background push notifications (FCM / APNs)
- A live deployment on the owner's domain (prepared: [docs/deployment.md](docs/deployment.md))
- A Socket.IO Redis adapter for running several backend instances
- Student hostel/canteen change requests (the data model leaves room for this)

## Brand

The official SERVE logo (a hand-drawn food/leaf mark supplied by the project
owner) is in [`brand/`](brand/) with the rules for using it; the tagline is
"Order. Track. Collect.". All three apps and the app icons use that file;
nothing redraws or imitates it. Palette: olive `#879F2D`, dark olive
`#6F8425`, orange `#E86A2E`, black `#111111`, warm off-white `#F8F7F2`,
white `#FFFFFF`, plus the accessible shades listed in
[brand/README.md](brand/README.md).

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
- [docs/deployment.md](docs/deployment.md)
- [apps/student/README.md](apps/student/README.md)
