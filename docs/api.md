# SERVE — API reference

Base URL: `http://localhost:5001/api` in development. It is configurable, and
there is no production default. Every endpoint below exists in the backend and
is covered by the integration suite in `backend/tests/integration/`.

## Conventions

| Topic | Rule |
|---|---|
| Authentication | `Authorization: Bearer <Firebase ID token>`. The token is verified with Firebase Admin, including a revocation check. |
| Authorization | The role, staff status and canteen assignment come from **PostgreSQL**. Client-sent roles, user ids, canteen ids, prices or totals are never trusted. |
| Responses | Single resource: `{ "data": … }`. Lists: `{ "data": [...], "nextCursor": "<id>" \| null }`. |
| Pagination | `?limit=1..100` (default 20) `&cursor=<id from nextCursor>`, newest first. |
| Money | Integer **paise** (`pricePaise`, `totalPaise`, `amountPaise`). ₹120 = `12000`. |
| Ids | UUIDs. A malformed id returns `422 VALIDATION_ERROR`. |
| Request id | Every response carries `X-Request-Id`. Error bodies include it. |
| Idempotency | `Idempotency-Key` header on `POST /orders` (8–128 chars, `[A-Za-z0-9_-]`). |
| Rate limits | Global per-IP limit on `/api/*`, excluding health. A stricter per-user limit applies to registration, order creation, payments and webhooks (`SENSITIVE_RATE_LIMIT_*`). |
| Visibility | A resource outside your scope (another student's order, another canteen's item) returns **404**, so existence is never revealed. |

### Errors

```json
{ "error": { "code": "ITEM_UNAVAILABLE", "message": "This item is currently unavailable.", "details": { "menuItemIds": ["…"] }, "requestId": "…" } }
```

| Status | Typical codes |
|---|---|
| 400 | `INVALID_JSON`, `IDEMPOTENCY_KEY_REQUIRED` |
| 401 | `AUTH_REQUIRED`, `AUTH_TOKEN_INVALID`, `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_REVOKED`, `AUTH_USER_DISABLED` |
| 403 | `ACCOUNT_NOT_REGISTERED`, `ACCOUNT_DISABLED`, `FORBIDDEN_ROLE`, `STAFF_NOT_APPROVED`, `STAFF_DEACTIVATED`, `EMAIL_DOMAIN_NOT_ALLOWED` |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND`, `CANTEEN_NOT_FOUND`, `ORDER_NOT_FOUND`, `MENU_ITEM_NOT_FOUND`, … |
| 409 | `ALREADY_REGISTERED`, `EMAIL_IN_USE`, `CANTEEN_INACTIVE`, `CANTEEN_NOT_ACCEPTING_ORDERS`, `INVALID_STATUS_TRANSITION`, `ALREADY_PAID`, `CHANGE_REQUEST_PENDING`, `*_EXISTS`, … |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `VALIDATION_ERROR`, `ITEM_UNAVAILABLE`, `ITEM_NOT_FOUND`, `DUPLICATE_ITEM`, `IDEMPOTENCY_KEY_REUSED`, `PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_SIGNATURE_INVALID`, `PAYMENT_FAILED`, … |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` (details logged server-side only) |
| 503 | `DATABASE_UNAVAILABLE`, `AUTH_UNAVAILABLE`, `PAYMENT_PROVIDER_NOT_IMPLEMENTED` |

---

## Health (public)

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ status, service, uptimeSeconds, timestamp }` |
| GET | `/health/db` | `200 { status:"ok", database:"postgresql", latencyMs }`, or `503 DATABASE_UNAVAILABLE` |

## Auth — any verified Firebase user

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/auth/me` | — | Account from PostgreSQL. An unregistered user gets `{ registered:false, role:null, firebaseUid, email }`. |
| POST | `/auth/student/register` | `{ name, email, hostelId }` | `201`. Creates **only** a Student. The `email` must equal the token's email. The hostel must exist and be active. Optional domain restriction via `STUDENT_EMAIL_DOMAINS`. Rate limited. |
| POST | `/auth/staff/register` | `{ name, email, requestedCanteenId? }` | `201`. Creates a `PENDING` staff account with no canteen. Optionally creates an access request, which notifies admins. |

`/auth/me` returns the role-specific fields:
- **Student:** `hostel {id,name}`, `defaultCanteen {id,name,isActive,isAcceptingOrders}`
- **Staff:** `status`, `canteen`, `pendingChangeRequest`
- **Admin:** base fields only

There is **no admin registration endpoint**. Admins are created with the
`admin:create` script (see [development.md](development.md)).

## Hostels — public

| GET | `/hostels` | Active hostels with their default canteen `{ id, name, canteen: {id,name} }`. |
|---|---|---|

## Canteens & menu — any authenticated user

Students and unregistered users see active canteens only. Staff also see
their own canteen, and admins see every canteen. Invisible canteens return 404.

| Method | Path | Response |
|---|---|---|
| GET | `/canteens` | `[{ id, name, slug, location, openingHours, isActive, isAcceptingOrders, status }]`, where `status` is `ACCEPTING_ORDERS` \| `PAUSED` \| `INACTIVE` |
| GET | `/canteens/:id` | One canteen |
| GET | `/canteens/:canteenId/menu` | `{ canteen, categories: [{ id, name, sortOrder, items: [item] }] }`. Active categories and items only; empty categories are omitted. An empty menu returns `categories: []` (no fallback data). |
| GET | `/canteens/:canteenId/categories` | `[{ …category, itemCount }]` |
| GET | `/menu/items/:id` | `item` plus `category {id,name}` and `canteen` |

`item` = `{ id, canteenId, categoryId, name, description, pricePaise, imageUrl, isAvailable, isActive, isOrderable, updatedAt }`.
`isOrderable` is true only when the item is available, its category is
active, and the canteen is active and accepting orders. Unavailable items are
returned so the UI can show them disabled.

## Cart — students

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/cart/quote` | `{ canteenId, items: [{ menuItemId, quantity 1..20 }] }` (1–50 distinct items) | `{ canteen, items: [{ menuItemId, name, unitPricePaise, quantity, lineTotalPaise }], totalPaise, currency:"INR" }` |

Prices are read from PostgreSQL. Any `price`, `lineTotal` or `total` field in
the body is discarded. Errors: `404 CANTEEN_NOT_FOUND`, `409 CANTEEN_INACTIVE`
/ `CANTEEN_NOT_ACCEPTING_ORDERS`, `422 ITEM_NOT_FOUND` (not on this canteen's
menu) / `ITEM_UNAVAILABLE` / `DUPLICATE_ITEM`.

## Orders — students (own orders only)

| Method | Path | Notes |
|---|---|---|
| POST | `/orders` | Header `Idempotency-Key` required. Same body as the quote. `201` with the order. Creates the order, immutable item snapshots, a `PENDING` payment and an `ORDER_PLACED` notification in **one transaction**. Repeating the same key and body returns `200` with the original order and `Idempotent-Replayed: true`. The same key with a different body returns `422 IDEMPOTENCY_KEY_REUSED`. Rate limited. |
| GET | `/orders?status=active\|past\|all` | Paginated. `active` = PLACED, PAYMENT_CONFIRMED, PREPARING, READY. `past` = COLLECTED, CANCELLED. |
| GET | `/orders/:id` | `404` unless it is your order. |
| POST | `/orders/:id/cancel` | Only while `PLACED` (unpaid). The payment is marked FAILED. |

Order shape: `{ id, orderNumber ("SV1024"), status, totalPaise, currency, canteen {id,name}, items: [{ id, menuItemId, itemName, unitPricePaise, quantity, lineTotalPaise }], payment: { provider, status, amountPaise, currency, paidAt }, createdAt, updatedAt, paidAt, preparingAt, readyAt, collectedAt, cancelledAt, cancelReason }`.
Staff and admin views add `student {id,name}`.

### Status lifecycle

```
PLACED ─► PAYMENT_CONFIRMED ─► PREPARING ─► READY ─► COLLECTED
  │              │
  └► CANCELLED ◄─┘
```

- `PAYMENT_CONFIRMED` is set **only** by payment verification.
- Staff may set `PREPARING`, `READY`, `COLLECTED`, and `CANCELLED` (from `PAYMENT_CONFIRMED`, which refunds through the provider).
- Students may cancel only `PLACED` orders.
- Any other move returns `409 INVALID_STATUS_TRANSITION`.

## Payments — students (own orders only)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/payments/:orderId/initiate` | — | Creates (or reuses, while pending) a provider order for the **server** total: `{ orderId, orderNumber, provider, providerOrderId, amountPaise, currency }`. Allowed when the order is PLACED, the payment is PENDING or FAILED, and the canteen still accepts orders. |
| POST | `/payments/:orderId/verify` | `{ providerOrderId, providerPaymentId, signature }` | Verifies the signature, fetches the captured payment from the provider, checks the order match and that the **amount equals the order total**, records the event once, then sets Payment `SUCCESS` and Order `PAYMENT_CONFIRMED`. A repeat with the same payment returns `200` with `Idempotent-Replayed: true`. |
| POST | `/payments/:orderId/mock-complete` | `{ outcome?: "success"\|"failure", capturedAmountPaise? }` | **Development/test only.** Mounted only when `PAYMENT_MODE=mock` and `NODE_ENV≠production`. Simulates the gateway and then runs the same verification as `/verify`. Returns `{ order, confirmation }`. |
| POST | `/payments/webhooks/razorpay` | raw JSON | Signature (`X-Razorpay-Signature`) is verified over the raw body. Each `X-Razorpay-Event-Id` is processed once. Returns 404 unless `PAYMENT_MODE=razorpay`. |

Razorpay status: signature verification is implemented. Order creation,
payment lookup and refunds are **not implemented yet** and return
`503 PAYMENT_PROVIDER_NOT_IMPLEMENTED`; they never report a fake success.

## Students

| GET | `/students/me/recommendations?canteenId=` | `{ basis: "MOST_ORDERED"\|"POPULAR"\|"MENU", items: [item] }`. Up to 4 items, defaulting to the student's hostel canteen. |
|---|---|---|

## Staff

Every route requires a staff account. The canteen is **always** the one
assigned to the caller in PostgreSQL; no route accepts a canteen id for
authorization.

| Method | Path | Requires | Notes |
|---|---|---|---|
| POST | `/staff/change-requests` | staff (not deactivated) | `{ requestedCanteenId, notes? }`. One pending request at a time. Rejected applicants go back to PENDING. |
| GET | `/staff/change-requests` | staff | Own requests, paginated |
| GET | `/staff/dashboard` | approved | `{ canteen, orders: { active, pending, preparing, ready }, today: { since, orderCount, revenuePaise } }`. "Today" is the IST calendar day. |
| PATCH | `/staff/canteen/status` | approved | `{ isAcceptingOrders }`. Pause or resume. Cannot resume an inactive canteen. |
| GET | `/staff/orders?status=active\|PAYMENT_CONFIRMED\|PREPARING\|READY\|COLLECTED\|CANCELLED` | approved | **Paid** orders of the caller's canteen only, paginated |
| GET | `/staff/orders/:id` | approved | |
| PATCH | `/staff/orders/:id/status` | approved | `{ status: PREPARING\|READY\|COLLECTED\|CANCELLED, reason? }` |
| GET | `/staff/menu` | approved | Full menu including inactive categories and items |
| POST | `/staff/menu/categories` | approved | `{ name, sortOrder? }` |
| PATCH | `/staff/menu/categories/:id` | approved | `{ name?, sortOrder?, isActive? }` |
| DELETE | `/staff/menu/categories/:id` | approved | Soft delete (`isActive=false`) |
| POST | `/staff/menu/items` | approved | `{ categoryId, name, pricePaise, description?, imageUrl?, isAvailable? }`. The category must belong to the caller's canteen. |
| PATCH | `/staff/menu/items/:id` | approved | `{ categoryId?, name?, description?, pricePaise?, imageUrl?, isAvailable?, isActive? }` |
| PATCH | `/staff/menu/items/:id/price` | approved | `{ pricePaise }` (100 – 10,000,000) |
| PATCH | `/staff/menu/items/:id/availability` | approved | `{ isAvailable }` |
| DELETE | `/staff/menu/items/:id` | approved | Soft delete |

## Admin

Every route requires an active Admin account in PostgreSQL.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/dashboard` | Canteen counts (total, active, accepting), staff (active, pending), pending change requests, today's orders and revenue |
| GET / POST | `/admin/canteens` | List with counts / create `{ name, slug?, location?, openingHours?, isActive?, isAcceptingOrders? }`. The slug is derived from the name if omitted. |
| GET / PATCH | `/admin/canteens/:id` | Details with hostels, staff and menu summary / update any field (activate, deactivate, open or close ordering) |
| GET / POST | `/admin/hostels` | List / create `{ name, canteenId }` |
| PATCH | `/admin/hostels/:id` | `{ name?, canteenId?, isActive? }`. Remaps a hostel to a canteen. |
| GET | `/admin/staff?status=&canteenId=` | Paginated |
| GET | `/admin/staff/:id` | Includes recent change requests |
| PATCH | `/admin/staff/:id/assignment` | `{ canteenId }`. Approves and assigns, or reassigns. Closes a matching pending request. |
| POST | `/admin/staff/:id/deactivate` | Clears the assignment, rejects pending requests and disconnects the staff member's sockets |
| GET | `/admin/change-requests?status=` | Paginated |
| POST | `/admin/change-requests/:id/approve` | `{ notes? }`. Assigns the requested canteen and records the reviewer and timestamp. |
| POST | `/admin/change-requests/:id/reject` | `{ notes? }`. A new applicant becomes REJECTED; an already-approved staff member keeps their current canteen. |
| GET | `/admin/orders?canteenId=&status=` and `/admin/orders/:id` | Read-only. No admin status override exists. |
| GET | `/admin/canteens/:canteenId/menu` | Managed menu of any canteen |
| POST | `/admin/canteens/:canteenId/menu/categories`, `/admin/canteens/:canteenId/menu/items` | Create in any canteen |
| PATCH | `/admin/menu/categories/:id`, `/admin/menu/items/:id`, `/admin/menu/items/:id/price`, `/admin/menu/items/:id/availability` | Update in any canteen |

## Notifications — any registered account (own notifications only)

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?unread=true\|false` | Paginated, plus `unreadCount` |
| PATCH | `/notifications/:id/read` | `404` for someone else's notification |
| PATCH | `/notifications/read-all` | `{ updated }` |

Notification: `{ id, type, title, message, orderId, data, readAt, createdAt }`.
Types: `ORDER_PLACED`, `PAYMENT_CONFIRMED`, `ORDER_PREPARING`, `ORDER_READY`,
`ORDER_COLLECTED`, `ORDER_CANCELLED`, `STAFF_ACCESS_REQUESTED`,
`STAFF_APPROVED`, `STAFF_REJECTED`, `STAFF_CANTEEN_ASSIGNED`,
`STAFF_DEACTIVATED`, `CANTEEN_UPDATE`.

---

## Realtime (Socket.IO)

Connect to the backend origin (default path `/socket.io`):

```js
const socket = io(API_ORIGIN, { auth: { token: firebaseIdToken } });
```

The handshake verifies the token with Firebase and loads the account from
PostgreSQL. A rejected handshake emits `connect_error` with `err.data.code`
set to `AUTH_REQUIRED`, `AUTH_TOKEN_INVALID`, `AUTH_TOKEN_REVOKED`,
`ACCOUNT_NOT_REGISTERED` or `ACCOUNT_DISABLED`.

**Rooms are assigned by the server.** Clients cannot join rooms.

| Account | Rooms |
|---|---|
| Student | `student:<studentId>` |
| Approved staff | `staff:<staffId>`, `canteen:<assignedCanteenId>` |
| Pending/rejected staff | `staff:<staffId>` |
| Admin | `admin:<adminId>`, `admin` |

Client-to-server events:

| Event | Payload | Ack |
|---|---|---|
| `menu:subscribe` | `{ canteenId }` | `{ ok:true, canteenId }` or `{ ok:false, error:{code} }`. Joins the read-only `canteen-public:<id>` room for a canteen you can see, leaving any previous one. |
| `menu:unsubscribe` | — | — |

Server-to-client events, all emitted **after** the database commit:

| Event | Rooms | Payload |
|---|---|---|
| `order:created` | `canteen:<id>`, `admin` | `{ order }`. Emitted when an order is **paid** (a new order for the kitchen). |
| `order:status_updated` | `student:<id>`, `canteen:<id>`, `admin` | `{ orderId, orderNumber, canteenId, status, previousStatus, updatedAt }` |
| `order:cancelled` | same | same |
| `menu:item_updated` | `canteen-public:<id>`, `canteen:<id>` | `{ item, change: "created"\|"updated" }` |
| `menu:price_updated` | same | `{ itemId, canteenId, pricePaise, previousPricePaise }` |
| `menu:availability_updated` | same | `{ itemId, canteenId, isAvailable, isActive, isOrderable }` |
| `menu:category_updated` | same | `{ category }` |
| `canteen:order_taking_updated` | `canteen-public:<id>`, `canteen:<id>`, `admin` | `{ canteenId, isActive, isAcceptingOrders, status }` |
| `change_request:created` | `admin` | `{ changeRequest }` |
| `change_request:updated` | `staff:<id>`, `admin` | `{ changeRequest }` |
| `staff:approved`, `staff:canteen_assignment_updated` | `staff:<id>`, `admin` | `{ staffId, status, canteen }`. The staff member's live sockets are moved to the new canteen room. |
| `staff:rejected` | `staff:<id>`, `admin` | `{ staffId, status }` |
| `staff:deactivated` | `staff:<id>`, `admin` | `{ staffId, status }`. The staff member's sockets are then disconnected. |
| `notification:created` | recipient room | `{ notification }` |

On reconnect, the token is verified again and rooms are reassigned. Clients
should then refetch authoritative state through REST (for example the active
order or the staff order queue). Firebase ID tokens expire after one hour;
reconnect with a fresh token when they do.
