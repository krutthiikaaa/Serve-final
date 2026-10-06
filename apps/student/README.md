# SERVE — Student app (Flutter)

The student side of SERVE: browse your night canteen's menu, order, pay
online, and collect in person when the order is ready. There is no delivery and
no cash on delivery.

Flutter 3.47 / Dart 3.13. Platforms: Android, iOS and web.

## Run it locally

Start the backend stack first (PostgreSQL, Firebase Auth Emulator, backend on
`:5001`; see [docs/development.md](../../docs/development.md)), then:

```bash
cd apps/student
flutter pub get

# Android emulator (the host machine is 10.0.2.2 from the emulator)
flutter run \
  --dart-define=API_URL=http://10.0.2.2:5001 \
  --dart-define=FIREBASE_AUTH_EMULATOR_HOST=10.0.2.2:9099

# iOS simulator / desktop browser
flutter run -d chrome --web-port 5555 \
  --dart-define=API_URL=http://localhost:5001 \
  --dart-define=FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  --dart-define=STAFF_DASHBOARD_URL=http://localhost:5173 \
  --dart-define=ADMIN_PORTAL_URL=http://localhost:5174
```

Flutter **web** calls the API from the browser, so its origin must be in the
backend's `CORS_ORIGINS` (for example `http://localhost:5555`). Android and iOS
send no `Origin` and need no CORS entry.

Demo account (emulator only, after `npm run db:seed:dev-users --workspace backend`):
`student@serve.dev` with your `DEV_SEED_PASSWORD`.

## Configuration (`--dart-define`)

| Key | Default | Notes |
|---|---|---|
| `API_URL` | `http://localhost:5001` | Backend origin. REST lives under `/api`, Socket.IO at `/socket.io`. |
| `FIREBASE_API_KEY` | `demo-api-key` | Public Firebase web API key. |
| `FIREBASE_PROJECT_ID` | `demo-serve` | `demo-*` projects only work with the emulator. |
| `FIREBASE_AUTH_EMULATOR_HOST` | — | `host:port` of the Auth Emulator. Development only. |
| `STAFF_DASHBOARD_URL` / `ADMIN_PORTAL_URL` | — | Opened from the role-selection screen. |

Only public values go here. Firebase Admin credentials, database passwords and
payment secrets exist only on the backend.

**Release builds** (`flutter build apk|ipa|web --release`) refuse to start with
the emulator configured, a `demo-` project, or a non-`https` / localhost
`API_URL` (see `lib/config/app_config.dart`). Android release builds keep the
platform default of HTTPS only; plain HTTP is allowed in debug builds for the
local backend.

## Structure

```
lib/
  main.dart                 wires config → auth → API → realtime → app
  app.dart                  providers + AuthGate (routes on /api/auth/me, owns the session lifecycle)
  config/app_config.dart    --dart-define values and release validation
  core/                     ApiException + messages, formatting (paise → ₹), UUIDs
  services/auth/            Firebase Auth over REST, secure session store, AuthController
  services/api/             ApiClient (bearer, token-refresh retry, error envelope), ServeApi, models
  services/realtime/        Socket.IO with token callback, auth.expired refresh, connection epoch
  state/                    cart (one canteen), selected canteen, notifications badge
  ui/                       screens, widgets, navigation, live-reload mixin
```

Screens: splash, role selection, login, registration, home, canteen selection,
menu, food details, cart, checkout (pickup only), payment (mock gateway), order
confirmation, order tracking, orders, order details, notifications, profile.
The bottom navigation is exactly Home, Menu, Orders and Profile.

See [docs/frontend-architecture.md](../../docs/frontend-architecture.md) for the
design decisions (why Firebase Auth runs over REST, how realtime refetching
works, what the client never sends).

## Logo

Put the official transparent logo at `assets/images/serve_logo.png` (copy it
from `/brand/`). Until then the app shows the text wordmark "SERVE"; the logo is
never redrawn. Menu items without an `imageUrl` show a category placeholder.

## Tests

```bash
flutter analyze
flutter test                                    # unit + widget tests (fakes, no network)

# The real service layer against a running backend + Auth Emulator:
SERVE_INTEGRATION=1 DEV_SEED_PASSWORD='…' flutter test --tags integration
```

The web build is also driven end to end by Playwright
(`E2E_STUDENT_WEB=1 npm run test:e2e`, see [e2e](../../e2e)).
