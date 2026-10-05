# SERVE — Frontend integration guide

How the **Student app (Flutter)**, **Staff dashboard (React)** and **Admin
portal (React)** connect to the backend. Every request and payload below was
captured from the running backend. The full reference is
[api.md](api.md); response shapes are pinned by
`backend/tests/helpers/contract.ts` and exercised end to end by
`backend/tests/integration/contract-smoke.test.ts`.

---

## 1. Ground rules

| The server is authoritative for | The client owns |
|---|---|
| identity and role (`/api/auth/me`) | UI and navigation state |
| staff approval status and canteen assignment | selected category, filters, search |
| canteens, menus, prices, availability | loading/error display state |
| quotes, order totals, order numbers | the **local convenience cart** |
| payment status and order status | form drafts |
| notifications and unread counts | |

- **Never** decode the Firebase token to decide the role. Ask `/api/auth/me`.
- **Never** send prices, totals, roles, user ids or canteen ids the API doesn't ask for. Request bodies are strict: unknown fields get `422 VALIDATION_ERROR`.
- **Money** is integer paise. Display it as `₹ ${(paise / 100).toFixed(2)}`, or drop the decimals when they're zero. Never compute totals for submission.
- **Cart flow:** keep a local cart for convenience (one canteen at a time). Call `POST /api/cart/quote` before showing checkout. `POST /api/orders` re-validates everything; treat its response as the truth.

## 2. Configuration

| Setting | Student (Flutter `--dart-define`) | Staff / Admin (Vite `.env.local`) |
|---|---|---|
| API base URL | `API_URL=http://localhost:5001` | `VITE_API_URL=http://localhost:5001` |
| Firebase project | `FIREBASE_PROJECT_ID=demo-serve` | `VITE_FIREBASE_PROJECT_ID=demo-serve` |
| Auth emulator (dev only) | `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` | `VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099` |
| Other portals (role screen) | `STAFF_DASHBOARD_URL`, `ADMIN_PORTAL_URL` | — |

REST lives under `${API_URL}/api`. Socket.IO connects to `${API_URL}` (path `/socket.io`).

### CORS (browser clients only)

The backend allows **exact origins** from `CORS_ORIGINS` (backend env). The
default development value covers the staff dashboard and the admin portal:

```dotenv
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
```

- **Flutter on Android/iOS** sends no `Origin`, so no CORS configuration is needed.
- **Flutter web** (`flutter run -d chrome --web-port 5555`) needs its origin added: `CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:5555`.
- Production: list the real `https://` origins only. Localhost and plain `http` origins are rejected at startup, and `*` is never used.
- Browsers can read `X-Request-Id`, `Idempotent-Replayed` and `RateLimit*`. There are no cookies (Bearer tokens), so do not use `credentials: 'include'`.

## 3. Authentication flow

```
Firebase sign-in (email/password)  ─►  Firebase ID token (1 h)
  ─►  Authorization: Bearer <token>  ─►  Express
  ─►  Firebase Admin verifyIdToken (+ revocation check)
  ─►  PostgreSQL account lookup (role, status, canteen)
  ─►  response
```

- Get the token right before each request (`user.getIdToken()` in Flutter, `auth.currentUser.getIdToken()` on the web). The SDK refreshes it automatically.
- On `401`:
  - `AUTH_TOKEN_EXPIRED`: refresh once with `getIdToken(true)` and retry.
  - `AUTH_TOKEN_REVOKED`, `AUTH_USER_DISABLED`, `AUTH_TOKEN_INVALID`: sign out.
- After sign-in, call `GET /api/auth/me` and route on the result:

| `/me` result | Student app | Staff dashboard | Admin portal |
|---|---|---|---|
| `registered:false` | show registration | show staff registration | "Not an admin" screen; sign out |
| `role:"STUDENT"` | home | "wrong portal", sign out | same |
| `role:"STAFF"`, `status:"PENDING"` / `"REJECTED"` | "wrong portal" | Awaiting Approval screen | same |
| `role:"STAFF"`, `status:"APPROVED"` | "wrong portal" | dashboard for `canteen` | same |
| `role:"STAFF"`, `status:"DEACTIVATED"` | — | "access removed", sign out | — |
| `role:"ADMIN"` | "wrong portal" | "wrong portal" | dashboard |

Real `/api/auth/me` for a new Firebase user:

```json
{ "data": { "registered": false, "role": null, "firebaseUid": "e8uQr65qxkgrpIxCie4Nwoanx7R8", "email": "asha@example.edu" } }
```

## 4. Socket.IO flow (all clients)

1. Sign in with Firebase.
2. Connect with a **function** for `auth`, so every reconnect sends a fresh token:

```ts
import { io } from 'socket.io-client';
const socket = io(import.meta.env.VITE_API_URL, {
  auth: (cb) => auth.currentUser!.getIdToken().then((token) => cb({ token })),
});
socket.on('connect_error', (err) => console.warn(err.data?.code)); // e.g. ACCOUNT_NOT_REGISTERED
```

(Flutter: `socket_io_client` with `OptionBuilder().setAuth({'token': token})`,
rebuilt with a fresh token before reconnecting.)

3. The server verifies the token and **assigns rooms**. There is no "join room" API, and room names are not an authorization mechanism.
4. Listen for events. Every event has the same envelope:

```json
{ "type": "order.ready", "occurredAt": "2026-10-05T19:42:58.920Z", "data": { "order": { … }, "previousStatus": "PREPARING" } }
```

5. When the ID token expires, the server sends `auth.expired` and disconnects. Socket.IO reconnects, the `auth` callback supplies a new token, and the rooms are reassigned.
6. **After every (re)connect, refetch authoritative state over REST:** the active order, the staff order board, `/auth/me`, the unread count. Events are not replayed.

The full event catalogue is in [api.md](api.md#realtime-socketio).

---

## 5. Student app (Flutter)

### Registration

```http
GET /api/hostels                      (no auth)
→ { "data": [ { "id": "1c35…", "name": "Krishna", "canteen": { "id": "9703…", "name": "Krishna & Godavari Night Canteen" } }, … ] }

POST /api/auth/student/register
{ "name": "Asha Rao", "email": "asha@example.edu", "hostelId": "1c35f533-3387-4777-8af8-31a066006c3d" }
→ 201
{ "data": { "registered": true, "role": "STUDENT", "id": "cfef0fa5-…", "firebaseUid": "e8uQ…", "name": "Asha Rao",
  "email": "asha@example.edu", "isActive": true,
  "hostel": { "id": "1c35…", "name": "Krishna" },
  "defaultCanteen": { "id": "9703…", "name": "Krishna & Godavari Night Canteen", "isActive": true, "isAcceptingOrders": true } } }
```

Errors to handle:
- `409 ALREADY_REGISTERED`: go to home.
- `409 EMAIL_IN_USE`
- `422 EMAIL_MISMATCH`
- `422 INVALID_HOSTEL` / `HOSTEL_INACTIVE`
- `403 EMAIL_DOMAIN_NOT_ALLOWED`: show "use your university email".

### Home and canteen selection

- **Current canteen:** `defaultCanteen` from `/me`, or the student's selection.
- `GET /api/canteens` lists the canteens for the selector. Use `status` to show **Accepting** / **Paused**.
- `GET /api/students/me/recommendations?canteenId=…` returns `{ basis, items }`. Show "Your Most Ordered" when `basis = MOST_ORDERED`, otherwise "Popular with Students".
- **Switching canteens with a non-empty cart:** confirm with the user, then clear the cart. This is client-side; the server rejects mixed-canteen orders anyway.
- Active order card: `GET /api/orders?status=active&limit=1`.

### Menu

`GET /api/canteens/:canteenId/menu` (real response, trimmed):

```json
{ "data": {
  "canteen": { "id": "9703…", "name": "Krishna & Godavari Night Canteen", "slug": "krishna-godavari",
               "location": "Between Krishna and Godavari hostels", "openingHours": "9:00 PM – 3:00 AM",
               "isActive": true, "isAcceptingOrders": true, "status": "ACCEPTING_ORDERS" },
  "categories": [ { "id": "958c…", "canteenId": "9703…", "name": "Sandwiches", "sortOrder": 10, "isActive": true,
                    "updatedAt": "2026-10-05T18:41:33.762Z",
    "items": [ { "id": "e341…", "canteenId": "9703…", "categoryId": "958c…", "name": "Chicken Cheese Grilled Sandwich",
                 "description": "Spiced chicken and melted cheese, grilled crisp.", "pricePaise": 8500, "imageUrl": null,
                 "isAvailable": true, "isActive": true, "availability": "AVAILABLE", "isOrderable": true,
                 "updatedAt": "2026-10-05T18:41:33.788Z" } ] } ] } }
```

- Enable the **+** button only when `isOrderable`. Show "Unavailable" when `availability = "UNAVAILABLE"`, or when the canteen is paused (`canteen.status`).
- `imageUrl: null` means use the category placeholder.
- An empty `categories` array means "No items available at this canteen right now."
- Live updates: `socket.emitWithAck('menu:subscribe', { canteenId })`, then handle `menu.item_price_changed`, `menu.item_availability_changed`, `menu.item_updated`, `menu.category_updated` and `canteen.status_changed`. Patch the local menu from `data`, or refetch.
- Item details: `GET /api/menu/items/:id`.

### Cart → quote → order

```http
POST /api/cart/quote
{ "canteenId": "9703…", "items": [ { "menuItemId": "7ee4…", "quantity": 2 }, { "menuItemId": "fdaa…", "quantity": 1 } ] }
→ { "data": { "canteen": { "id": "9703…", "name": "Krishna & Godavari Night Canteen" },
     "items": [ { "menuItemId": "7ee4…", "itemName": "Paneer Roll", "unitPricePaise": 10000, "quantity": 2, "lineTotalPaise": 20000 },
                { "menuItemId": "fdaa…", "itemName": "Masala Tea", "unitPricePaise": 2500, "quantity": 1, "lineTotalPaise": 2500 } ],
     "itemCount": 3, "subtotalPaise": 22500, "totalPaise": 22500, "currency": "INR" } }
```

Problem items come back together:

```json
{ "error": { "code": "ITEM_UNAVAILABLE", "message": "This item is currently unavailable.",
  "details": { "items": [ { "menuItemId": "…", "reason": "UNAVAILABLE" }, { "menuItemId": "…", "reason": "INACTIVE" } ] }, "requestId": "…" } }
```

Mark those lines in the cart (`NOT_IN_CANTEEN` / `INACTIVE`: remove; `UNAVAILABLE`: "sold out").

Place the order with a key generated **once per checkout attempt**, and reuse
it on retries (for example after a timeout):

```http
POST /api/orders
Idempotency-Key: checkout-1791229378422
{ "canteenId": "9703…", "items": [ { "menuItemId": "7ee4…", "quantity": 2 }, { "menuItemId": "fdaa…", "quantity": 1 } ] }
→ 201
{ "data": { "id": "d8c5c17f-…", "orderNumber": "SV1002", "status": "PLACED", "totalPaise": 22500, "currency": "INR",
  "canteen": { "id": "9703…", "name": "Krishna & Godavari Night Canteen" },
  "items": [ { "id": "59a5…", "menuItemId": "7ee4…", "itemName": "Paneer Roll", "unitPricePaise": 10000, "quantity": 2, "lineTotalPaise": 20000 },
             { "id": "7339…", "menuItemId": "fdaa…", "itemName": "Masala Tea", "unitPricePaise": 2500, "quantity": 1, "lineTotalPaise": 2500 } ],
  "payment": { "provider": "MOCK", "status": "PENDING", "amountPaise": 22500, "currency": "INR", "paidAt": null, "refundedAt": null, "failureReason": null },
  "createdAt": "2026-10-05T19:42:58.710Z", "updatedAt": "2026-10-05T19:42:58.710Z",
  "paidAt": null, "preparingAt": null, "readyAt": null, "collectedAt": null, "cancelledAt": null, "cancelReason": null,
  "timeline": [ { "status": "PLACED", "at": "2026-10-05T19:42:58.710Z" } ] } }
```

- Repeating the same request returns `200` with `Idempotent-Replayed: true` and the same order.
- Sending `totalPaise` or `pricePaise` returns `422 VALIDATION_ERROR` ("Unrecognized key").
- `409 CANTEEN_NOT_ACCEPTING_ORDERS` means: "This canteen is currently not accepting orders."

### Payment (mock now, Razorpay later)

```http
POST /api/payments/:orderId/initiate
→ { "data": { "orderId": "d8c5…", "orderNumber": "SV1002", "provider": "MOCK",
              "providerOrderId": "mock_order_4d84…", "amountPaise": 22500, "currency": "INR" } }
```

- **Development (mock):** show a "Pay ₹225" sheet, then call `POST /api/payments/:orderId/mock-complete` with `{ "outcome": "success" }`. The response is `{ order: {status:"PAYMENT_CONFIRMED", …}, confirmation }`. `{ "outcome": "failure" }` returns `422 PAYMENT_FAILED`; offer a retry, which calls `initiate` again.
- **Razorpay (future):** open Checkout with `providerOrderId` and `amountPaise`, then send Razorpay's result to `POST /api/payments/:orderId/verify` as `{ providerOrderId, providerPaymentId, signature }`. The UI flow is the same; only the gateway step changes.
- Show the confirmation screen with `orderNumber` in large type.

### Order tracking and history

- `GET /api/orders/:id` for details. Draw the timeline from `timeline[]` (reached steps) and `status` (current). `CANCELLED` is terminal; show `cancelReason`.
- Live updates: `order.payment_confirmed`, `order.preparing`, `order.ready` (show "Your order is ready for pickup" with the order number), `order.collected` and `order.cancelled`. Each carries `data.order`, the full student view, so the screen can be replaced directly.
- History: `GET /api/orders?status=active` and `?status=past`, paginated with `limit` and `cursor`.

### Notifications

- `GET /api/notifications` returns `{ data, nextCursor, unreadCount }`. The bell badge uses `unreadCount`.
- `PATCH /api/notifications/:id/read` and `PATCH /api/notifications/read-all`.
- Live: `notification.created` (prepend it and increment the badge).

Real list entry:

```json
{ "id": "2f24…", "type": "ORDER_READY", "title": "Ready for pickup",
  "message": "Your order is ready for pickup. Show order #SV1002 at the counter.",
  "orderId": "d8c5…", "data": { "status": "READY", "orderNumber": "SV1002" }, "readAt": null, "createdAt": "2026-10-05T19:42:58.916Z" }
```

### Profile and logout

- Profile data comes from `/me` (name, email, hostel, default canteen).
- Logout: Firebase `signOut()`, disconnect the socket, and clear the local cart and cached data.

---

## 6. Staff dashboard (React)

### Registration and approval state

- `POST /api/auth/staff/register` with `{ name, email, requestedCanteenId? }` returns a `PENDING` account.
- Request (or re-request) access with `POST /api/staff/change-requests` and `{ requestedCanteenId, notes? }`. View history with `GET /api/staff/change-requests`.
- **Awaiting Approval** screen: show `/me.pendingChangeRequest`, and keep the socket connected. On `staff.approved` / `staff.canteen_assigned`, refetch `/me` and go to the dashboard. The server has already moved the socket into the canteen room, so no client action is needed. On `staff.rejected`, show the rejection and offer a new request.
- Until approved, every operational route returns `403 STAFF_NOT_APPROVED`.

Real `/me` for an approved staff member:

```json
{ "data": { "registered": true, "role": "STAFF", "id": "2e8f…", "firebaseUid": "7fa5…", "name": "Dev Staff (K&G)",
  "email": "staff.kg@serve.dev", "isActive": true, "status": "APPROVED",
  "canteen": { "id": "9703…", "name": "Krishna & Godavari Night Canteen", "isActive": true, "isAcceptingOrders": true },
  "pendingChangeRequest": null } }
```

### Dashboard and canteen status

```json
GET /api/staff/dashboard
{ "data": { "canteen": { …canteen, "status": "ACCEPTING_ORDERS" },
  "orders": { "active": 1, "awaitingPreparation": 1, "preparing": 0, "ready": 0 },
  "today": { "since": "2026-10-05T18:30:00.000Z", "orderCount": 2, "revenuePaise": 42500 } } }
```

- Pause or resume ordering with `PATCH /api/staff/canteen/status` and `{ "isAcceptingOrders": false }`. A `409 CANTEEN_INACTIVE` response means only an admin can reactivate the canteen.

### Order board

- `GET /api/staff/orders?status=active` (paginated, **paid orders only**, the caller's canteen only). Columns: `PAYMENT_CONFIRMED` (new), `PREPARING`, `READY`. History: `?status=COLLECTED` / `CANCELLED`.
- Each order has `orderNumber`, `createdAt`, `items[]` (name and quantity), `totalPaise`, `payment.status` and `student:{id,name}`.
- Advance an order with `PATCH /api/staff/orders/:id/status` and `{ "status": "PREPARING" | "READY" | "COLLECTED" | "CANCELLED", "reason"? }`.
  - `409 INVALID_STATUS_TRANSITION` / `ORDER_STATE_CHANGED`: refetch the order (another device changed it).
- Live:
  - `order.payment_confirmed` adds a card to the "New" column. Optionally play a sound.
  - `order.preparing`, `order.ready` and `order.collected` move the card.
  - `order.cancelled` removes it.

### Menu management

- `GET /api/staff/menu` returns every category with every item, including inactive ones.
- Categories:
  - `POST /api/staff/menu/categories` with `{ name, sortOrder? }`
  - `PATCH /api/staff/menu/categories/:id` with `{ name?, sortOrder?, isActive? }`
  - `DELETE /api/staff/menu/categories/:id` (soft delete)
- Items:
  - `POST /api/staff/menu/items` with `{ categoryId, name, pricePaise, description?, imageUrl?, isAvailable? }`
  - `PATCH /api/staff/menu/items/:id`, or `…/price` with `{ pricePaise }`, or `…/availability` with `{ isAvailable }`
  - `DELETE /api/staff/menu/items/:id` (soft delete)
- Convert rupees to paise on input (`Math.round(rupees * 100)`), allowed range ₹1–₹10,000. The server re-validates.
- Errors: `409 CATEGORY_EXISTS` / `MENU_ITEM_EXISTS`, `422 INVALID_CATEGORY`. A `404` means the resource belongs to another canteen; this cannot happen through the UI.

### Notifications

The same three endpoints as the student app. Staff receive `STAFF_APPROVED`,
`STAFF_REJECTED`, `STAFF_CANTEEN_ASSIGNED` and `STAFF_DEACTIVATED`.

On `staff.deactivated` the server disconnects the socket. Sign out and show
"access removed".

---

## 7. Admin portal (React)

- `/me` must return `role:"ADMIN"`. A deactivated admin gets `403 ACCOUNT_DISABLED`.
- **Dashboard:** `GET /api/admin/dashboard` (real response):

```json
{ "data": { "canteens": { "total": 5, "active": 5, "acceptingOrders": 5, "paused": 0, "inactive": 0 },
  "staff": { "active": 1, "pending": 1, "rejected": 0, "deactivated": 0 },
  "pendingChangeRequests": 1,
  "orders": { "active": 1, "awaitingPreparation": 0, "preparing": 0, "ready": 1 },
  "today": { "since": "2026-10-05T18:30:00.000Z", "orderCount": 2, "revenuePaise": 42500,
             "createdByStatus": { "PLACED": 0, "PAYMENT_CONFIRMED": 0, "PREPARING": 0, "READY": 1, "COLLECTED": 1, "CANCELLED": 0 } } } }
```

- **Canteens:**
  - `GET /api/admin/canteens` (with counts), `POST` to create, `GET /api/admin/canteens/:id` (hostels, staff, menu summary)
  - `PATCH /api/admin/canteens/:id` with `{ isActive?, isAcceptingOrders?, name?, … }`
  - Menu of any canteen: `GET /api/admin/canteens/:id/menu`, plus the `/api/admin/menu/...` editing routes.
- **Hostels:** `GET` / `POST /api/admin/hostels`, and `PATCH /api/admin/hostels/:id` with `{ canteenId }` to remap.
- **Change requests:** `GET /api/admin/change-requests?status=PENDING`, then `POST …/:id/approve` or `…/:id/reject` with `{ notes? }`.
- **Staff:** `GET /api/admin/staff?status=…`, `GET /api/admin/staff/:id`, `PATCH …/:id/assignment` with `{ canteenId }`, `POST …/:id/deactivate`.
- **Orders (read-only):** `GET /api/admin/orders?canteenId=&status=`, `GET /api/admin/orders/:id`.
- **Live:**
  - `change_request.created` increments the pending badge.
  - `change_request.updated`, `staff.*` and `canteen.status_changed` refresh the affected rows.
  - `order.*` can drive live counters.

---

## 8. Error handling

| Status | Meaning | What the client does |
|---|---|---|
| 401 | Not authenticated (`AUTH_*`) | Refresh the token once on `AUTH_TOKEN_EXPIRED`; otherwise sign out and show login |
| 403 | Authenticated but not allowed (`FORBIDDEN_ROLE`, `STAFF_NOT_APPROVED`, `ACCOUNT_DISABLED`, `ACCOUNT_NOT_REGISTERED`) | Route to the right screen (registration, awaiting approval, wrong portal) |
| 404 | Not found or not yours | "Not found"; drop the stale item from the local cache |
| 409 | State conflict (paused canteen, invalid transition, already paid, duplicates) | Show `message`; refetch the resource |
| 422 | Validation or business rule | Show `message`; for `VALIDATION_ERROR` map `details[].path` to form fields; for cart errors use `details.items` |
| 429 | Rate limited | Back off and retry after `Retry-After` |
| 503 | Dependency down (`DATABASE_UNAVAILABLE`, `AUTH_UNAVAILABLE`) | "Unable to connect to SERVE. Please try again." Retry later; do **not** sign out |
| network error | Backend unreachable | "Unable to connect to SERVE. Please try again." |

Always log `error.requestId` (it is also in the `X-Request-Id` header) so a
failure can be traced in the backend logs.

## 9. Local development quick start

```bash
npm run emulators                                    # Firebase Auth Emulator
npm run dev:backend                                  # API + Socket.IO on :5001
DEV_SEED_PASSWORD='…' npm run db:seed:dev-users --workspace backend
```

This gives you `student@serve.dev`, `staff.kg@serve.dev` (approved, K&G),
`staff.pending@serve.dev` and `admin@serve.dev`. Point the Firebase SDKs at the
emulator (`connectAuthEmulator` / `useAuthEmulator('127.0.0.1', 9099)`). See
[development.md](development.md) for full setup.
