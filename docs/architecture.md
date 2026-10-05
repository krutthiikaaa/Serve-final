# SERVE — Architecture

_Status: the backend is implemented and its contract is frozen (database,
authentication, REST API, payments, realtime). The three client apps are
planned; [frontend-integration.md](frontend-integration.md) describes how they
connect._

## 1. System overview

```
Flutter Student App ──┐
React Staff Dashboard ─┼──► Express backend (REST + Socket.IO) ──► PostgreSQL
React Admin Portal ────┘              │
                                      └──► Firebase Admin (token verification)

   Firebase Authentication : who you are (identity)
   PostgreSQL              : what you may do (roles, assignments) + all application state
   Socket.IO               : realtime delivery of committed changes
```

Each client signs in with the Firebase SDK and sends the ID token with every
REST call (`Authorization: Bearer …`) and on the Socket.IO handshake
(`auth.token`). The backend verifies the token, loads the account from
PostgreSQL, and makes every authorization decision from that database record.

## 2. Backend layout

```
backend/src/
├── config/         env.ts (validated config: the only reader of process.env), logger.ts
├── lib/            errors, prisma client, firebase verifier, prisma error helpers, time
├── middleware/     auth (authenticate + role guards), rate limits, request logging, errors
├── http/           zod validation helpers, keyset pagination
├── realtime/       events.ts (Outbox, rooms, publisher contract), socket-server.ts
├── modules/
│   ├── auth/            principal resolution, registration, admin bootstrap, /api/auth
│   ├── canteens/        visibility rules, menu read models, /api/canteens /api/menu /api/hostels
│   ├── menu/            menu management (staff + admin scopes)
│   ├── orders/          pricing, state machine, order service, /api/cart /api/orders
│   ├── payments/        provider interface, mock + Razorpay adapters, payment service, routes
│   ├── change-requests/ staff access / reassignment workflow
│   ├── staff/           dashboard, order-taking toggle, /api/staff
│   ├── admin/           canteens, hostels, staff management, /api/admin
│   ├── notifications/   writer (inside transactions) + read API
│   ├── students/        recommendations
│   └── health/
├── services.ts     builds every service from the AppContext
├── context.ts      AppContext: env, logger, prisma, verifier, events, payments
├── app.ts          Express composition
└── server.ts       HTTP server + Socket.IO + graceful shutdown
```

Dependencies are injected through `AppContext`. The test suite therefore runs
the real composition against PostgreSQL and the Firebase Auth Emulator, with
nothing mocked.

## 3. Request pipeline

1. `trust proxy` (configurable hop count)
2. Request logging with `X-Request-Id` and redacted secrets
3. `helmet`: strict CSP, HSTS, nosniff, frame protection
4. Exact-origin CORS (Bearer tokens, no cookies)
5. Payment webhooks with a **raw** body, mounted before JSON parsing so signatures cover the exact bytes
6. JSON body parser (100 kB)
7. `/api/health`, which is not rate limited
8. Global per-IP rate limit on `/api`
9. Feature routers. Each one authenticates first and then applies role guards. Sensitive routes add a per-user rate limit.
10. 404 handler, then the central error handler (stable `{ error: { code, message, requestId } }`)

## 4. Authentication and authorization

```
ID token ──► FirebaseIdentityVerifier.verifyIdToken(token, checkRevoked=true)
         ──► uid ──► resolvePrincipal(prisma, uid) ──► Student | Staff | Admin | null
```

- Token problems (expired, revoked, disabled, malformed) return **401**. Firebase being unreachable returns **503**.
- Guards: `currentStudent`, `currentStaff` (not deactivated), `currentApprovedStaff` (APPROVED with a canteen), `currentAdmin`, `currentPrincipal`. Wrong role → `403 FORBIDDEN_ROLE`; registered in Firebase only → `403 ACCOUNT_NOT_REGISTERED`.
- **Registration:** students self-register (the token email must match; the hostel is validated; an optional domain allowlist applies). Staff self-register as PENDING. Admins come only from the `admin:create` bootstrap.
- **Canteen isolation:** staff routes never accept a canteen id for authorization. The scope is `Staff.canteenId` from the database. Resources from another canteen return 404.
- **Emulator vs production:** `FIREBASE_AUTH_EMULATOR_HOST` selects the emulator. Production rejects the emulator and `demo-` projects, and requires service-account credentials. Switching is configuration-only.

## 5. Orders, pricing and idempotency

- `priceCart` reads current prices, availability and canteen state from PostgreSQL. Client prices and totals are discarded by schema validation.
- `POST /api/orders` requires `Idempotency-Key`. Uniqueness is enforced by (`studentId`, `idempotencyKey`), plus a SHA-256 `requestHash` that detects a key reused with a different body. Concurrent duplicates collapse onto the winner of the unique constraint.
- One transaction creates the Order, its OrderItem snapshots, the PENDING Payment and a notification.
- The state machine in `orders/order-state.ts` is enforced with conditional updates (`WHERE status = <expected>`), so concurrent changes cannot skip states.

## 6. Payments

```
initiate ──► provider.createOrder(amount = Payment.amountPaise)        (server total)
client pays on the gateway (mock: simulateCheckout)
verify   ──► provider.verifyPaymentSignature()                         HMAC
         ──► provider.fetchPayment()   captured amount and order match (server-to-server)
         ──► transaction: ProcessedPaymentEvent(provider, eventId) ── duplicate? → no-op
                          Payment PENDING→SUCCESS, Order PLACED→PAYMENT_CONFIRMED,
                          notification
         ──► after commit: order:status_updated (student), order:created (kitchen)
```

- **MockPaymentProvider:** development and test only. It is rejected in production, and `mock-complete` is only mounted in mock mode outside production. It is stateless: the captured amount and outcome are encoded in the HMAC-signed mock payment id, so a restart between initiate and complete strands nothing.
- **Refund ordering:** a staff cancellation of a paid order commits `CANCELLED` first and refunds afterwards. A concurrent `PREPARING` can therefore never end with money refunded for an order still being cooked. If the provider refund fails, the payment stays `SUCCESS` with `failureReason = "Refund pending…"` and the error is logged.
- **RazorpayPaymentProvider:** signature verification is implemented as documented by Razorpay. API calls are pending and return `503 PAYMENT_PROVIDER_NOT_IMPLEMENTED`; they never fake success.
- **Webhooks:** verified over the raw body, and replay-safe through `ProcessedPaymentEvent`.

## 7. Realtime

- Services record changes in an `Outbox` during the transaction. `outbox.flush(events)` runs **after commit**, so no event can describe uncommitted state. A rolled-back transaction emits nothing. Events are published before room commands, so a deactivated staff member still receives `staff.deactivated` before the disconnect.
- Wire format: every event is `{ type, occurredAt, data }`, with dot-style names (`order.ready`, `menu.item_price_changed`, `staff.canteen_assigned`, …). Order events carry the full order in the representation for each room's audience (student view vs staff/admin view). Staff only ever see paid orders; `order.payment_confirmed` is their new-order signal.
- Token expiry: the socket remembers the expiry of its handshake token. At expiry it emits `auth.expired` and disconnects. The client reconnects with a fresh token and is re-verified, and its rooms are re-derived, from scratch.
- Socket.IO authenticates the handshake exactly like REST and assigns rooms on the server: `student:<id>`, `staff:<id>`, `canteen:<id>` (approved staff), `admin:<id>` and `admin`. The one client-initiated room is the read-only `canteen-public:<id>`, joined through a validated `menu:subscribe`.
- Room commands follow committed assignment changes. Approval or reassignment moves the staff member's live sockets to the new canteen room; deactivation disconnects them.
- `RealtimeBridge` lets Express be created before Socket.IO attaches to the same HTTP server.
- Scaling past one instance requires the Socket.IO Redis adapter (planned). The room commands already use cross-node-safe APIs (`fetchSockets`, `disconnectSockets`).

The event catalogue is in [api.md](api.md#realtime-socketio).

## 8. Environments

| | development | test | production |
|---|---|---|---|
| Config source | `backend/.env` | `backend/.env.test` | platform env / secrets manager only |
| Database | `serve_dev` | `serve_test` (recreated per run) | managed PostgreSQL |
| Firebase | Auth Emulator (`demo-serve`) | Auth Emulator | real project, service account |
| Payments | mock | mock | Razorpay (adapter API calls pending) |
| CORS | localhost allowed | localhost allowed | https only, no localhost |

## 9. Clients (planned phases)

| Client | Uses |
|---|---|
| Student app (Flutter) | `/auth/*`, `/hostels`, `/canteens/*`, `/menu/*`, `/cart/quote`, `/orders/*`, `/payments/*`, `/students/me/recommendations`, `/notifications/*`; socket rooms `student:*` + `menu:subscribe` |
| Staff dashboard (React) | `/auth/*`, `/staff/*`, `/notifications/*`; rooms `staff:*`, `canteen:*` |
| Admin portal (React) | `/auth/me`, `/admin/*`, `/notifications/*`; rooms `admin`, `admin:*` |
