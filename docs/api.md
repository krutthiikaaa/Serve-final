# SERVE — API reference

**Status: frozen backend contract.** Every endpoint below exists and is
covered by `backend/tests/integration/`. Response shapes are pinned by strict
schemas in `backend/tests/helpers/contract.ts`; an added or missing field
fails the contract smoke test. For a client-oriented walkthrough with real
payloads, see [frontend-integration.md](frontend-integration.md).

Base URL: `http://localhost:5001/api` in development (configurable; there is
no production default).

## Conventions

| Topic | Rule |
|---|---|
| Authentication | `Authorization: Bearer <Firebase ID token>`. Verified with Firebase Admin, including a revocation check. |
| Authorization | The role, staff status and canteen assignment come from **PostgreSQL**. No client-sent role, id, canteen id, price or total is ever trusted. |
| Success body | Single resource: `{ "data": … }`. Paginated list: `{ "data": [...], "nextCursor": "<id>" \| null }`. Small, bounded lists (`/hostels`, `/canteens`, `/admin/canteens`, `/admin/hostels`, menus) are `{ "data": [...] }`. `/notifications` adds `unreadCount`. |
| Health exception | `/api/health` and `/api/health/db` return a bare object, because load-balancer probes read them. |
| Request bodies | **Strict.** Unknown fields are rejected with `422 VALIDATION_ERROR` (e.g. `totalPaise`, `pricePaise`, `role`, `canteenId` where not part of the contract). Query strings ignore unknown parameters. |
| Pagination | `?limit=1..100` (default 20) `&cursor=<id from nextCursor>`, newest first. Out-of-range values return 422. |
| Money | Integer **paise** everywhere. ₹120 = `12000`. Item prices are 100–1,000,000 paise (₹1–₹10,000); an order totals at most ₹10,00,000. |
| Ids | UUIDs. A malformed id returns `422 VALIDATION_ERROR`. |
| Headers | Every response has `X-Request-Id`. A replayed order has `Idempotent-Replayed: true`. Both are exposed to browsers through CORS. |
| Idempotency | `Idempotency-Key` header on `POST /orders` (8–128 chars, `[A-Za-z0-9_-]`). |
| Rate limits | Global: `RATE_LIMIT_MAX` (default 300) requests per `RATE_LIMIT_WINDOW_MS` (default 60 s) per IP on `/api/*`, excluding health. Sensitive: `SENSITIVE_RATE_LIMIT_MAX` (default 20) per minute **per user**, applied to registration, order creation, payment initiate/verify/mock-complete and webhooks. Responses include `RateLimit` / `RateLimit-Policy` headers. |
| Visibility | A resource outside your scope (another student's order, another canteen's item or order) returns **404**, so its existence is never revealed. |

### Errors

```json
{ "error": { "code": "ITEM_UNAVAILABLE", "message": "This item is currently unavailable.",
             "details": { "items": [{ "menuItemId": "…", "reason": "UNAVAILABLE" }] }, "requestId": "…" } }
```

`details` is present only where useful. For `VALIDATION_ERROR` it is a list of
`{ path, message }`.

| Status | Codes |
|---|---|
| 400 | `INVALID_JSON`, `IDEMPOTENCY_KEY_REQUIRED`, `BAD_REQUEST` |
| 401 | `AUTH_REQUIRED`, `AUTH_TOKEN_INVALID`, `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_REVOKED`, `AUTH_USER_DISABLED` |
| 403 | `ACCOUNT_NOT_REGISTERED`, `ACCOUNT_DISABLED`, `FORBIDDEN_ROLE`, `STAFF_NOT_APPROVED`, `STAFF_DEACTIVATED`, `EMAIL_DOMAIN_NOT_ALLOWED` |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND`, `CANTEEN_NOT_FOUND`, `MENU_ITEM_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `ORDER_NOT_FOUND`, `NOTIFICATION_NOT_FOUND`, `STAFF_NOT_FOUND`, `HOSTEL_NOT_FOUND`, `CHANGE_REQUEST_NOT_FOUND`, `PAYMENT_NOT_FOUND`, `WEBHOOK_NOT_CONFIGURED` |
| 409 | `ALREADY_REGISTERED`, `EMAIL_IN_USE`, `CANTEEN_INACTIVE`, `CANTEEN_NOT_ACCEPTING_ORDERS`, `INVALID_STATUS_TRANSITION`, `ORDER_STATE_CHANGED`, `ORDER_NOT_AWAITING_PAYMENT`, `ALREADY_PAID`, `PAYMENT_NOT_INITIATED`, `CHANGE_REQUEST_PENDING`, `CHANGE_REQUEST_ALREADY_REVIEWED`, `ALREADY_ASSIGNED`, `STAFF_ALREADY_DEACTIVATED`, `CATEGORY_EXISTS`, `MENU_ITEM_EXISTS`, `CANTEEN_NAME_TAKEN`, `CANTEEN_SLUG_TAKEN`, `HOSTEL_EXISTS`, `CONFLICT` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `VALIDATION_ERROR`, `EMAIL_REQUIRED`, `EMAIL_MISMATCH`, `INVALID_HOSTEL`, `HOSTEL_INACTIVE`, `INVALID_CATEGORY`, `INVALID_CANTEEN`, `INVALID_SLUG`, `DUPLICATE_ITEM`, `ITEM_NOT_FOUND`, `ITEM_UNAVAILABLE`, `ORDER_TOTAL_TOO_LARGE`, `IDEMPOTENCY_KEY_INVALID`, `IDEMPOTENCY_KEY_REUSED`, `PAYMENT_ORDER_MISMATCH`, `PAYMENT_SIGNATURE_INVALID`, `PAYMENT_FAILED`, `PAYMENT_AMOUNT_MISMATCH`, `WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_INVALID` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` (details are logged server-side only) |
| 503 | `DATABASE_UNAVAILABLE`, `AUTH_UNAVAILABLE`, `PAYMENT_PROVIDER_NOT_IMPLEMENTED` |

---

## Health (public)

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ status, service, uptimeSeconds, timestamp }` |
| GET | `/health/db` | `200 { status:"ok", database:"postgresql", latencyMs, timestamp }`, or `503 DATABASE_UNAVAILABLE` |

## Auth — any verified Firebase user

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/auth/me` | — | The account from PostgreSQL (shapes below). |
| POST | `/auth/student/register` | `{ name, email, hostelId }` | `201` with the `/auth/me` body. Creates **only** a Student. `email` must equal the token's email (case-insensitive). The hostel must exist and be active. Optional `STUDENT_EMAIL_DOMAINS` allowlist (empty by default). Rate limited. |
| POST | `/auth/staff/register` | `{ name, email, requestedCanteenId? }` | `201`. Creates a `PENDING` staff account with no canteen. The optional access request notifies admins. |

`/auth/me` shapes:

- **Unregistered:** `{ registered:false, role:null, firebaseUid, email }`
- **Student:** `{ registered:true, role:"STUDENT", id, firebaseUid, name, email, isActive, hostel:{id,name}, defaultCanteen:{id,name,isActive,isAcceptingOrders} }`
- **Staff:** `{ …base, role:"STAFF", status, canteen:{id,name,isActive,isAcceptingOrders}|null, pendingChangeRequest:{id,status,createdAt,requestedCanteen:{id,name}}|null }`
- **Admin:** `{ …base, role:"ADMIN" }`

There is **no admin registration endpoint**. Admins come only from the
`admin:create` script.

## Hostels — public

| GET | `/hostels` | `{ data: [{ id, name, canteen: {id,name} }] }`. Active hostels, sorted by name. |
|---|---|---|

## Canteens & menu — any authenticated user

Students and unregistered users see active canteens. Staff also see their own
canteen, and admins see every canteen. Invisible canteens return 404.

| Method | Path | Response `data` |
|---|---|---|
| GET | `/canteens` | `[canteen]` |
| GET | `/canteens/:id` | `canteen` |
| GET | `/canteens/:canteenId/menu` | `{ canteen, categories: [category + items: [item]] }`. Active categories and items; empty categories are omitted; an empty menu gives `categories: []`. |
| GET | `/canteens/:canteenId/categories` | `[category + itemCount]` |
| GET | `/menu/items/:id` | `item + category:{id,name} + canteen` |

- `canteen` = `{ id, name, slug, location, openingHours, isActive, isAcceptingOrders, status }`, where `status` is `ACCEPTING_ORDERS` \| `PAUSED` \| `INACTIVE`.
- `category` = `{ id, canteenId, name, sortOrder, isActive, updatedAt }`
- `item` = `{ id, canteenId, categoryId, name, description, pricePaise, imageUrl, isAvailable, isActive, availability, isOrderable, updatedAt }`
  - `availability`: `AVAILABLE` (orderable), `UNAVAILABLE` (temporarily off, e.g. sold out), `INACTIVE` (removed, or its category is disabled)
  - `isOrderable`: true only when `availability = AVAILABLE` and the canteen is active and accepting orders

## Cart — students

| Method | Path | Body | Response `data` |
|---|---|---|---|
| POST | `/cart/quote` | `{ canteenId, items: [{ menuItemId, quantity }] }`, 1–50 distinct items, quantity 1–20 | `{ canteen:{id,name}, items:[{ menuItemId, itemName, unitPricePaise, quantity, lineTotalPaise }], itemCount, subtotalPaise, totalPaise, currency:"INR" }` |

Prices are read from PostgreSQL. `totalPaise = subtotalPaise` (no fees and no
delivery). Errors:
- `404 CANTEEN_NOT_FOUND`
- `409 CANTEEN_INACTIVE` / `CANTEEN_NOT_ACCEPTING_ORDERS`
- `422 DUPLICATE_ITEM` / `ORDER_TOTAL_TOO_LARGE`
- `422 ITEM_NOT_FOUND` (at least one item is not on this canteen's menu) or `ITEM_UNAVAILABLE`. Both list **every** problem item in `details.items[] = { menuItemId, reason: NOT_IN_CANTEEN | INACTIVE | UNAVAILABLE }`.

## Orders — students (own orders only)

| Method | Path | Notes |
|---|---|---|
| POST | `/orders` | Header `Idempotency-Key` required; same body as the quote. `201` with `order`. One transaction creates the order, immutable item snapshots, a `PENDING` payment and an `ORDER_PLACED` notification. The same key and body returns `200` with the original order and `Idempotent-Replayed: true`. The same key with a different body returns `422 IDEMPOTENCY_KEY_REUSED`. Rate limited. |
| GET | `/orders?status=active\|past\|all` | Paginated. `active` = PLACED, PAYMENT_CONFIRMED, PREPARING, READY. `past` = COLLECTED, CANCELLED. |
| GET | `/orders/:id` | |
| POST | `/orders/:id/cancel` | Only while `PLACED` (unpaid). The payment becomes FAILED. |

`order` (student view) =
`{ id, orderNumber ("SV1002"), status, totalPaise, currency, canteen:{id,name}, items:[{ id, menuItemId|null, itemName, unitPricePaise, quantity, lineTotalPaise }], payment:{ provider, status, amountPaise, currency, paidAt, refundedAt, failureReason }, createdAt, updatedAt, paidAt, preparingAt, readyAt, collectedAt, cancelledAt, cancelReason, timeline:[{ status, at }] }`.

- `timeline` lists the statuses the order has actually reached, in order.
- Staff and admin views add `student:{id,name}`. Contact details are never included.

### Status lifecycle

```
PLACED ─► PAYMENT_CONFIRMED ─► PREPARING ─► READY ─► COLLECTED
  │              │
  └► CANCELLED ◄─┘
```

- `PAYMENT_CONFIRMED` is set **only** by payment verification.
- Staff set `PREPARING`, `READY`, `COLLECTED`, and `CANCELLED` (from `PAYMENT_CONFIRMED` only, which refunds the payment). Staff can never set `PLACED` or `PAYMENT_CONFIRMED` (`422`).
- Students cancel only `PLACED` orders.
- Any other move returns `409 INVALID_STATUS_TRANSITION` with `details: { from, to }`. A lost race returns `409 ORDER_STATE_CHANGED`.
- Updates are conditional (`WHERE status = <expected>`), so concurrent requests cannot skip states.

## Payments — students (own orders only)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/payments/:orderId/initiate` | — | Creates (or reuses, while pending) a provider order for the **server** total: `{ orderId, orderNumber, provider, providerOrderId, amountPaise, currency }`. Allowed when the order is PLACED, the payment is PENDING or FAILED, and the canteen still accepts orders. |
| POST | `/payments/:orderId/verify` | `{ providerOrderId, providerPaymentId, signature }` | Verifies the signature, asks the provider what was captured, checks the order match and **amount = order total**, records the event once, then sets Payment `SUCCESS` and Order `PAYMENT_CONFIRMED`. Returns `order`. A repeat returns `200` with `Idempotent-Replayed: true`. |
| POST | `/payments/:orderId/mock-complete` | `{ outcome?: "success"\|"failure", capturedAmountPaise? }` | **Development/test only.** Mounted only when `PAYMENT_MODE=mock` and `NODE_ENV≠production`. Simulates the gateway, then runs `/verify`. Returns `{ order, confirmation }`. Failure returns `422 PAYMENT_FAILED` (retry with `initiate`). |
| POST | `/payments/webhooks/razorpay` | raw JSON | The `X-Razorpay-Signature` is verified over the raw body. Each `X-Razorpay-Event-Id` is processed once. Returns 404 unless `PAYMENT_MODE=razorpay`. |

Razorpay: signature verification is implemented. Order creation, payment
lookup and refunds return `503 PAYMENT_PROVIDER_NOT_IMPLEMENTED` until the
integration is done; they never report a fake success.

## Students

| GET | `/students/me/recommendations?canteenId=` | `{ basis: "MOST_ORDERED"\|"POPULAR"\|"MENU", items: [item] }`. Up to 4 items, defaulting to the hostel's canteen. |
|---|---|---|

## Staff

The canteen is **always** the caller's assignment in PostgreSQL. No staff
route accepts a canteen id.

| Method | Path | Requires | Notes |
|---|---|---|---|
| POST | `/staff/change-requests` | staff (not deactivated) | `{ requestedCanteenId, notes? }`. `201`. One pending request at a time. A rejected applicant becomes PENDING again. |
| GET | `/staff/change-requests` | staff | Own requests, paginated (`changeRequest`, see Admin) |
| GET | `/staff/dashboard` | approved | `{ canteen, orders:{ active, awaitingPreparation, preparing, ready }, today:{ since, orderCount, revenuePaise } }`. "Today" is the IST calendar day; revenue counts paid, non-cancelled orders. |
| PATCH | `/staff/canteen/status` | approved | `{ isAcceptingOrders }` → `canteen`. Cannot resume an inactive canteen. |
| GET | `/staff/orders?status=active\|PAYMENT_CONFIRMED\|PREPARING\|READY\|COLLECTED\|CANCELLED` | approved | **Paid** orders of the caller's canteen, staff view, paginated |
| GET | `/staff/orders/:id` | approved | |
| PATCH | `/staff/orders/:id/status` | approved | `{ status: PREPARING\|READY\|COLLECTED\|CANCELLED, reason? }` → `order`. A paid order is cancelled first and then refunded. If the refund fails, the order stays CANCELLED and `payment.failureReason` says the refund is pending. |
| GET | `/staff/menu` | approved | `[category + items]`, including inactive ones |
| POST | `/staff/menu/categories` | approved | `{ name, sortOrder? }` → `201 category` |
| PATCH | `/staff/menu/categories/:id` | approved | `{ name?, sortOrder?, isActive? }` (at least one field) |
| DELETE | `/staff/menu/categories/:id` | approved | Soft delete (`isActive=false`) |
| POST | `/staff/menu/items` | approved | `{ categoryId, name, pricePaise, description?, imageUrl?, isAvailable? }` → `201 item`. The category must belong to the caller's canteen. |
| PATCH | `/staff/menu/items/:id` | approved | `{ categoryId?, name?, description?, pricePaise?, imageUrl?, isAvailable?, isActive? }` |
| PATCH | `/staff/menu/items/:id/price` | approved | `{ pricePaise }` |
| PATCH | `/staff/menu/items/:id/availability` | approved | `{ isAvailable }` |
| DELETE | `/staff/menu/items/:id` | approved | Soft delete |

## Admin

Every route requires an **active** Admin account in PostgreSQL.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/dashboard` | `{ canteens:{ total, active, acceptingOrders, paused, inactive }, staff:{ active, pending, rejected, deactivated }, pendingChangeRequests, orders:{ active, awaitingPreparation, preparing, ready }, today:{ since, orderCount, revenuePaise, createdByStatus:{ PLACED…CANCELLED } } }` |
| GET / POST | `/admin/canteens` | List (`canteen + counts:{ hostels, activeStaff, menuItems }`) / create `{ name, slug?, location?, openingHours?, isActive?, isAcceptingOrders? }`. The slug is derived from the name if omitted. |
| GET / PATCH | `/admin/canteens/:id` | `canteen + hostels + staff + menuSummary` / update any canteen field |
| GET / POST | `/admin/hostels` | `[{ id, name, isActive, canteen:{id,name} }]` / create `{ name, canteenId }` |
| PATCH | `/admin/hostels/:id` | `{ name?, canteenId?, isActive? }` |
| GET | `/admin/staff?status=&canteenId=` | Paginated `{ id, name, email, status, createdAt, updatedAt, canteen:{id,name}\|null }` |
| GET | `/admin/staff/:id` | Includes the last 20 change requests |
| PATCH | `/admin/staff/:id/assignment` | `{ canteenId }`. Approves and assigns, or reassigns. Closes a matching pending request. |
| POST | `/admin/staff/:id/deactivate` | Clears the assignment, rejects pending requests and disconnects the staff member's sockets |
| GET | `/admin/change-requests?status=` | Paginated `changeRequest` = `{ id, status, notes, reviewNotes, staff:{id,name,email,status}, requestedCanteen, fromCanteen, reviewedBy, reviewedAt, createdAt }` |
| POST | `/admin/change-requests/:id/approve` | `{ notes? }` |
| POST | `/admin/change-requests/:id/reject` | `{ notes? }`. A new applicant becomes REJECTED; an approved staff member keeps their current canteen. |
| GET | `/admin/orders?canteenId=&status=`, `/admin/orders/:id` | Read-only (admin view). No status override exists. |
| GET | `/admin/canteens/:canteenId/menu` | Managed menu of any canteen |
| POST | `/admin/canteens/:canteenId/menu/categories`, `/admin/canteens/:canteenId/menu/items` | Same bodies as the staff routes |
| PATCH | `/admin/menu/categories/:id`, `/admin/menu/items/:id`, `/admin/menu/items/:id/price`, `/admin/menu/items/:id/availability` | Same bodies as the staff routes |

## Notifications — any registered, active account (own notifications only)

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?unread=true\|false` | Paginated, plus `unreadCount` |
| PATCH | `/notifications/:id/read` | `404` for someone else's notification |
| PATCH | `/notifications/read-all` | `{ updated }` |

`notification` = `{ id, type, title, message, orderId, data, readAt, createdAt }`.

Types:
- Students: `ORDER_PLACED`, `PAYMENT_CONFIRMED`, `ORDER_PREPARING`, `ORDER_READY`, `ORDER_COLLECTED`, `ORDER_CANCELLED`
- Admins: `STAFF_ACCESS_REQUESTED`
- Staff: `STAFF_APPROVED`, `STAFF_REJECTED`, `STAFF_CANTEEN_ASSIGNED`, `STAFF_DEACTIVATED`
- Reserved: `CANTEEN_UPDATE`

Menu changes are delivered in realtime only and are not stored as notifications.

---

## Realtime (Socket.IO)

```js
const socket = io(API_ORIGIN, { auth: (cb) => getFreshIdToken().then((token) => cb({ token })) });
```

- **Handshake:** the token is verified with Firebase (revocation checked) and the account is loaded from PostgreSQL. A rejected handshake emits `connect_error` with `err.data.code`: `AUTH_REQUIRED`, `AUTH_TOKEN_INVALID`, `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_REVOKED`, `AUTH_USER_DISABLED`, `ACCOUNT_NOT_REGISTERED`, `ACCOUNT_DISABLED` or `AUTH_UNAVAILABLE`.
- **Token expiry:** when the token used for the handshake expires, the server emits `auth.expired` and disconnects. The client reconnects with a fresh token; the `auth` callback above does this automatically. On every reconnect the account and rooms are re-derived from scratch.
- **Rooms are assigned by the server.** Clients cannot join rooms.

| Account | Rooms |
|---|---|
| Student | `student:<studentId>` |
| Approved staff | `staff:<staffId>`, `canteen:<assignedCanteenId>` |
| Pending/rejected staff | `staff:<staffId>` |
| Admin | `admin:<adminId>`, `admin` |

Client → server:

| Event | Payload | Ack |
|---|---|---|
| `menu:subscribe` | `{ canteenId }` | `{ ok:true, canteenId }` or `{ ok:false, error:{code} }`. Joins the read-only `canteen-public:<id>` room for a canteen you can see, replacing any previous one. |
| `menu:unsubscribe` | — | — |

Server → client. **Every** event uses one envelope, published only **after** the database commit:

```json
{ "type": "order.ready", "occurredAt": "2026-10-05T19:42:58.920Z", "data": { … } }
```

| Event (`type`) | Delivered to | `data` |
|---|---|---|
| `order.created` | owner student, admin | `{ order, previousStatus: null }` |
| `order.payment_confirmed` | owner student, the canteen's staff, admin | `{ order, previousStatus }`. For staff this is the **new-order signal**: staff never see unpaid orders. |
| `order.preparing`, `order.ready`, `order.collected` | owner student, the canteen's staff, admin | `{ order, previousStatus }` |
| `order.cancelled` | owner student, admin, and the canteen's staff if the order was paid | `{ order, previousStatus }` |
| `menu.item_updated` | `canteen-public:<id>`, `canteen:<id>` | `{ item, change: "created"\|"updated" }` |
| `menu.item_price_changed` | same | `{ itemId, canteenId, pricePaise, previousPricePaise }` |
| `menu.item_availability_changed` | same | `{ itemId, canteenId, isAvailable, isActive, availability, isOrderable }` |
| `menu.category_updated` | same | `{ category }` |
| `canteen.status_changed` | `canteen-public:<id>`, `canteen:<id>`, admin | `{ canteenId, isActive, isAcceptingOrders, status }` |
| `change_request.created` | admin | `{ changeRequest }` |
| `change_request.updated` | the staff member, admin | `{ changeRequest }` |
| `staff.approved` | the staff member, admin | `{ staffId, status, canteen:{id,name} }`. First approval only. |
| `staff.canteen_assigned` | the staff member, admin | `{ staffId, status, canteen:{id,name} }`. Every (re)assignment. The live sockets are moved to the new `canteen:<id>` room by the server. |
| `staff.rejected` | the staff member, admin | `{ staffId, status }` |
| `staff.deactivated` | the staff member, admin | `{ staffId, status }`. Delivered, then the staff member's sockets are disconnected. |
| `notification.created` | the recipient | `{ notification }`, identical to the stored row |
| `auth.expired` | the expiring socket | `{ reason: "TOKEN_EXPIRED" }` |

In each event, `order` is shaped for its audience: the student view for the
student room, the staff/admin view (with `student:{id,name}`) for the canteen
and admin rooms. After a reconnect, refetch authoritative state over REST.
