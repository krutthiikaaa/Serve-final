# SERVE — Frontend architecture

How the three client apps are built and how they integrate with the frozen
backend contract ([api.md](api.md), [frontend-integration.md](frontend-integration.md)).

| App | Path | Stack | Dev URL |
|---|---|---|---|
| Student app | `apps/student` | Flutter 3.47 / Dart 3.13, provider, http, socket_io_client, flutter_secure_storage | `flutter run` (web: `:5555`) |
| Staff dashboard | `apps/staff` | React 19, TypeScript, Vite 8, react-router 7, `@firebase/auth`, socket.io-client | `http://localhost:5173` |
| Admin portal | `apps/admin` | same as staff | `http://localhost:5174` |
| Shared contract | `packages/contracts` | zod 4 schemas + inferred types | — |
| Shared web code | `packages/web-shared` | API client, auth, realtime, notifications, UI kit, styles | — |

## 1. Principles

- **The backend decides.** Every screen is routed from `GET /api/auth/me`.
  No client reads a role from the Firebase token, the URL or local storage.
- **The backend calculates.** Clients never send prices, totals, user ids,
  student ids, staff ids or canteen assignments. Displayed totals come from
  the quote (`POST /api/cart/quote`) or the order itself.
- **No fake functionality.** Every button calls the real API. There are no
  stubbed endpoints, hard-coded responses or optimistic "success" states;
  lists change only after the backend confirms.
- **Events trigger, REST confirms.** Realtime events update the UI
  immediately, and every (re)connection refetches the authoritative state,
  because events are not replayed.
- **Only public configuration in clients.** API URL, Firebase web API key and
  project id. Firebase Admin credentials, database passwords and payment
  secrets exist only on the backend.

## 2. One contract for backend and web clients

`packages/contracts/src/index.ts` holds the frozen response contract as
**strict** zod schemas. The backend's contract-smoke test validates live
responses against these schemas, and the React apps import the inferred
TypeScript types (`StaffOrder`, `MenuItem`, `ChangeRequest`, `ServerEvents`, …).
A field added to or removed from a response therefore breaks the backend test
and the web typecheck at the same time. Hand-written DTOs are not used in the
web apps.

The Flutter app mirrors the same shapes in `lib/services/api/models.dart`.
Its parsing is pinned by unit tests and by the integration test that runs the
real service layer against the backend.

## 3. Authentication

### Web (staff, admin)

- The modular `@firebase/app` + `@firebase/auth` packages (the umbrella
  `firebase` package pulled in Firestore/gRPC with audit findings and is not
  used).
- `AuthProvider` (web-shared) keeps one state machine:
  `initializing → signedOut | loadingAccount → ready | error`, driven by
  `onIdTokenChanged`, then loads `/api/auth/me`.
- The API client asks Firebase for the current token before each request.
  On `401 AUTH_TOKEN_EXPIRED` it force-refreshes once and retries; any other
  `401` signs the user out.
- The staff app lets people create a Firebase account and register as PENDING
  staff. The admin portal has **no** registration: admins come from the
  bootstrap script.

### Flutter: Firebase Authentication over REST (decision)

The student app talks to Firebase Authentication through its documented REST
API (Identity Toolkit `accounts:signUp` / `accounts:signInWithPassword`, Secure
Token `token` refresh) instead of the `firebase_auth` plugin.

Why:
- It works identically against the **Auth Emulator** and production, with no
  `google-services.json` / `GoogleService-Info.plist` needed for development.
- The whole auth layer runs in the Dart VM, so the integration test exercises
  the exact client code against the real emulator and backend.
- Email/password is the only sign-in method in scope.

Consequences:
- The ID token is verified exactly as before: the backend's Firebase Admin
  SDK checks signature and revocation on every request and socket handshake.
- `AuthController` stores **only** the refresh token, uid and email in
  `flutter_secure_storage` (Keychain / Android keystore), refreshes the ID
  token two minutes before expiry or on demand, and shares one refresh between
  concurrent callers.
- Adding Google sign-in or other providers later would mean switching to the
  `firebase_auth` plugin behind the same `AuthController` interface.

Registration: `createAccount` creates the Firebase user without leaving the
registration screen; the app then calls `/api/auth/student/register` and only
then switches to the signed-in app. If that step is abandoned, the next sign-in
shows "Complete your profile" (the backend reports `registered: false`).

## 4. API clients and errors

| | Web (`packages/web-shared/src/api.ts`) | Flutter (`lib/services/api/`) |
|---|---|---|
| Base | `${VITE_API_URL}/api` | `${API_URL}/api` |
| Auth | `Authorization: Bearer <Firebase ID token>` | same |
| Expired token | one forced refresh + retry | same |
| Errors | `ApiError(status, code, message, details, requestId)` | `ApiException(...)` |
| Typed endpoints | `apps/staff/src/api/staff.ts`, `apps/admin/src/api/admin.ts` | `ServeApi` |

User-facing messages (both clients):

| Status | Message |
|---|---|
| network / 503 | "Unable to connect to SERVE. Please try again." |
| 401 | "Your session has expired. Please sign in again." (and sign-out) |
| 403 | backend message, e.g. "Please use your university email address." |
| 404 | backend message ("…not found") |
| 409 | backend message; screens refetch the affected record |
| 422 | field errors from `details[].path` next to the fields; cart issues mark lines |
| 429 | "Too many requests. Please wait a moment and try again." |

Stack traces and internal errors are never shown.

## 5. Realtime

Both stacks connect to `${API_URL}` with the `websocket` transport and an
**auth callback**, so every handshake (including reconnects) sends a fresh
token. The server assigns rooms; clients never send room names. The one
client-initiated subscription is the public, read-only `menu:subscribe
{ canteenId }` used by the student app.

- `auth.expired` → the next handshake forces a token refresh, then the client
  reconnects (the server disconnects expired sockets).
- `connectionEpoch` (web) / `epoch` (Flutter) increments on every connect.
  Screens use it as a dependency and refetch their REST data.
- Order events carry the full order. Clients keep whichever copy has the
  newest `updatedAt`, so a late event can never move an order backwards.
- The Flutter `LiveReload` mixin also refetches when the app returns to the
  foreground.

| App | Events used |
|---|---|
| Student | `order.payment_confirmed/preparing/ready/collected/cancelled`, `menu.*`, `canteen.status_changed`, `notification.created` |
| Staff | `order.payment_confirmed` (new-order signal + toast), `order.preparing/ready/collected/cancelled`, `menu.*`, `canteen.status_changed`, `staff.approved/rejected/canteen_assigned/deactivated`, `change_request.updated`, `notification.created` |
| Admin | `change_request.created/updated`, `staff.*`, `canteen.status_changed`, `order.*`, `notification.created` |

## 6. State

- **React:** local component state plus `useResource(fetcher, deps)` (loading
  / error / reload with a stale-response guard). Cross-cutting state lives in
  contexts: auth, realtime, notifications (unread badge), toasts and the typed
  API client.
- **Flutter:** `provider` with `ChangeNotifier`s: `AuthController`,
  `CartController`, `CanteenSelection`, `NotificationsController`, `HomeTabs`.
  `AuthGate` starts realtime and notifications for a registered student and
  clears the cart, selection and socket on sign-out.

## 7. Money and the cart

- All amounts are integer paise. `formatRupees` (web) and `formatRupees`
  (Flutter) only display them.
- Staff type prices in rupees; `rupeesToPaise` converts with integer maths
  (`"99.50"` → `9950`) and the form enforces the backend range (₹1–₹10,000)
  before sending.
- The student cart belongs to **one canteen**. Adding from, or switching to,
  another canteen asks: *"Your cart contains items from another canteen.
  Switching canteens will clear your current cart."* (Cancel / Switch Canteen).
- The cart screen re-quotes after every change (debounced). `ITEM_UNAVAILABLE`
  details mark lines: `UNAVAILABLE` → "Sold out" (checkout blocked until
  removed); `INACTIVE` / `NOT_IN_CANTEEN` → removed with a notice.
- Checkout generates **one `Idempotency-Key` per checkout attempt** and reuses
  it on retries, so a timeout can never create two orders. The payment screen
  shows the order's total; if it differs from the quote, the student is told.
- Availability: `AVAILABLE` → can be added; `UNAVAILABLE` → shown, disabled;
  `INACTIVE` → hidden. A paused canteen shows its menu with a banner.

## 8. Screens and endpoints

**Student:** splash · role selection (opens `STAFF_DASHBOARD_URL` /
`ADMIN_PORTAL_URL`) · login · registration (`/hostels`, `/auth/student/register`)
· home (`/canteens/:id/menu`, `/students/me/recommendations`,
`/orders?status=active&limit=1`) · canteen selection (`/canteens`) · menu ·
food details (`/menu/items/:id`) · cart (`/cart/quote`) · checkout
(`POST /orders`) · payment (`/payments/:id/initiate`, `/mock-complete`) ·
confirmation · tracking (`/orders/:id` + events) · orders (`/orders?status=active|past`,
cursor pagination) · order details (pay later, `POST /orders/:id/cancel` while
unpaid) · notifications · profile/logout. Bottom navigation: Home, Menu,
Orders, Profile. Header: logo, notifications badge, olive cart button.

**Staff:** login · create account · complete registration
(`/auth/staff/register`) · access status (pending / rejected with re-request
via `/staff/change-requests` / deactivated) · dashboard (`/staff/dashboard`,
`PATCH /staff/canteen/status`) · order board (`/staff/orders?status=active`,
`PATCH /staff/orders/:id/status`; history tabs for collected / cancelled) ·
menu (`/staff/menu`, category and item CRUD, availability, disable) ·
notifications · account (reassignment request + history).

**Admin:** login · dashboard (`/admin/dashboard`, `/admin/orders`) · canteens
(`/admin/canteens`, create, edit, pause/resume, activate/deactivate) · canteen
detail (`/admin/canteens/:id`) · change requests (`/admin/change-requests`,
approve / reject with notes) · staff (`/admin/staff` filters, detail,
assign / reassign via `/admin/staff/:id/assignment`, deactivate) ·
notifications.

## 9. UI system

- Palette: olive `#879F2D`, dark olive `#6F8425`, orange `#E86A2E`, ink
  `#111111`, paper `#F8F7F2`, muted `#5F6258`. Web tokens live in
  `packages/web-shared/src/styles.css`; Flutter in `lib/theme/serve_theme.dart`.
  The admin portal uses a dark sidebar for a more administrative look.
- **Logo slot:** web apps load `/brand/serve-logo.png`, Flutter loads
  `assets/images/serve_logo.png`. While the official file is missing, both show
  a plain text wordmark. The logo is never redrawn and never placed in a box.
- **Food images:** `imageUrl` when present, otherwise a per-category
  placeholder icon.
- **Accessibility:** status is shown with icon + text (never colour alone);
  forms use labelled fields with inline errors; dialogs trap Escape and return
  focus; buttons have accessible names (Flutter tooltips / semantics labels,
  menu rows announced as buttons); `prefers-reduced-motion` disables web
  animations. The Flutter web build is driven in tests through its
  accessibility tree, which keeps those labels honest.
- **Feedback:** loading skeletons/spinners, empty states, error states with
  retry, connection banners, toasts / snack bars, and subtle animations
  (cards rising in, quantity control and badge transitions, confirmation
  check).
- **Responsive:** the web sidebar collapses to icons below 960 px and the order
  board stacks below 1100 px.

## 10. Configuration and builds

| | Web | Flutter |
|---|---|---|
| Dev config | `apps/*/.env.development.local` (copy `.env.example`) | `--dart-define` |
| API | `VITE_API_URL` | `API_URL` |
| Firebase | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_AUTH_EMULATOR_URL` (dev) | `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_EMULATOR_HOST` (dev) |
| Production guard | `vite build` fails without the required variables, with the emulator set, or with a localhost API URL | release builds throw on emulator, `demo-` project, non-https or localhost API |

The development env file is deliberately named `.env.development.local`:
Vite never loads it for production builds, so a developer's emulator settings
cannot leak into a release. CI builds pass real values through the
environment (for gates: `VITE_API_URL=https://api.serve.example
VITE_FIREBASE_API_KEY=… VITE_FIREBASE_PROJECT_ID=serve-prod npm run build`).

Browser clients need their exact origin in the backend `CORS_ORIGINS`
(`:5173`, `:5174`, plus `:5555` for Flutter web). Mobile builds send no origin.
Android allows plain HTTP only in debug builds; iOS allows local networking
only.

## 11. Testing

| Layer | Where | What |
|---|---|---|
| Shared web | `packages/web-shared/tests` (Vitest) | API client retry and errors, money conversion, realtime provider (handshake token, no rooms, epoch, auth.expired), notifications |
| Staff / admin | `apps/*/tests` (Vitest + Testing Library) | routing by `/me`, order board rules, menu forms, change-request review, staff management, dashboards; fake API + fake socket |
| Student | `apps/student/test/unit`, `test/widget` | services, cart rules, models, every main screen with fake services |
| Student integration | `apps/student/test/integration` (`--tags integration`) | the real service layer against the running backend + emulator |
| End-to-end | `e2e/` (Playwright 1.56.1) | isolated backend on `serve_test`, both web apps, and optionally the Flutter web build; critical flow, realtime isolation, operations, access control, visual captures |

Playwright is pinned to 1.56.1 because that version matches the Chromium
build preinstalled in the development container (`/opt/pw-browsers`); no
browser download is needed. The E2E backend launcher refuses any database not
ending in `_test`.

## 12. Notes and deviations

- **Recommendation heading for the `MENU` basis.** The contract returns
  `MOST_ORDERED`, `POPULAR` or `MENU` (no order history anywhere yet). The app
  shows "Your Most Ordered" and "Popular with Students" for the first two and
  "From the Menu" for `MENU`, so it never claims popularity that does not
  exist.
- **pg deprecation warning.** Under concurrent load the backend may log
  `Calling client.query() when the client is already executing a query`. The
  stack trace points into `@prisma/adapter-pg`'s transaction handling (Prisma
  7.10 with pg 8.23), not SERVE code; pg queues the queries, so behaviour is
  unaffected.

## 13. Deferred

- Razorpay Checkout in the student app (the payment screen already isolates
  the gateway step; the backend adapter's API calls are pending).
- Push notifications (Firebase Cloud Messaging) for a closed app.
- Official logo and app icons (slots exist; Flutter launcher icons are still
  the framework defaults).
- Persisting the cart across app restarts, and localisation.
