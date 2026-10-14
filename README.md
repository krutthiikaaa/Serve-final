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

## 18. Future Enhancements

- Razorpay payments in place of the mock provider
- Firebase Cloud Messaging for background push notifications
- AWS deployment (containerised backend, managed PostgreSQL, static web hosting)
- A Socket.IO Redis adapter for running several backend instances
- Student hostel/canteen change requests (the data model leaves room for this)
