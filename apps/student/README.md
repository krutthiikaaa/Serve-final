# SERVE — Student app (Flutter)

The student side of SERVE: browse your night canteen's menu, order, pay
online, and collect in person when the order is ready. There is no delivery and
no cash on delivery.

Flutter 3.47 / Dart 3.13. Platforms: Android, iOS and web.

## Run it locally

Requirements: **Flutter 3.47 or newer** (`flutter --version`) and the backend
stack running: PostgreSQL, the Firebase Auth Emulator and the backend on
`:5001` (see [docs/development.md](../../docs/development.md)).

```bash
npm run dev:student                        # from the repository root: Chrome on http://localhost:5555
npm run dev:student -- -d emulator-5554    # Android emulator (any id from `flutter devices`)

# The same thing without npm:
cd apps/student
flutter run -d chrome --web-port 5555
```

No `--dart-define` flags are needed locally. Development builds default to the
backend on port 5001 and the Firebase Auth Emulator on port 9099, using
`localhost` on the web, iOS simulator and desktop, and `10.0.2.2` (the host
machine) on an Android emulator.

The web version calls the API from the browser, so the backend's
`CORS_ORIGINS` must include `http://localhost:5555` (it does in
`.env.example`). If you run the web app on another port, add that origin too.

Demo account (emulator only, after `npm run db:seed:dev-users --workspace backend`):
`student@serve.dev` with your `DEV_SEED_PASSWORD`. The emulator forgets
accounts when it restarts, so re-run the seed after each restart.

### Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| `version solving failed` / `requires SDK version ^3.13.3` | Flutter is older than 3.47 | `flutter upgrade` |
| `Flutter was not found` (from `npm run dev:student`) | Flutter isn't on your PATH | Install Flutter, or set `FLUTTER_BIN` to the `flutter` executable |
| `No supported devices connected` | Only desktop devices are available, and this app targets mobile + web | Use `npm run dev:student` (Chrome), or start an Android emulator / iOS simulator first |
| "Unable to connect to SERVE" on the role screen or after sign-in | Backend not running, or the web origin isn't allowed | Start `npm run dev:backend`; add `http://localhost:5555` to `CORS_ORIGINS` in `backend/.env` and restart the backend |
| "Incorrect email or password" for `student@serve.dev` | The emulator restarted and lost the demo accounts | `DEV_SEED_PASSWORD='…' npm run db:seed:dev-users --workspace backend` |
| "Unable to reach the sign-in service" | The Auth Emulator isn't running | `npm run emulators` |
| Works in Chrome but not on an Android emulator | A custom `API_URL` uses `localhost` | Drop the flag (the default is `10.0.2.2`) or use `10.0.2.2` |
| Physical phone can't connect | `localhost` on the phone is the phone itself | Pass your computer's LAN address: `--dart-define=API_URL=http://<ip>:5001 --dart-define=FIREBASE_AUTH_EMULATOR_HOST=<ip>:9099`, and start the emulator with `--host 0.0.0.0` |

## Configuration (`--dart-define`)

| Key | Default | Notes |
|---|---|---|
| `API_URL` | `http://localhost:5001` (`http://10.0.2.2:5001` on an Android emulator) | Backend origin. REST lives under `/api`, Socket.IO at `/socket.io`. |
| `FIREBASE_API_KEY` | `demo-api-key` | Public Firebase web API key. |
| `FIREBASE_PROJECT_ID` | `demo-serve` | `demo-*` projects only work with the emulator. |
| `FIREBASE_AUTH_EMULATOR_HOST` | `127.0.0.1:9099` (`10.0.2.2:9099` on Android) for `demo-` projects in development builds | `host:port` of the Auth Emulator. Never used by release builds. |
| `STAFF_DASHBOARD_URL` / `ADMIN_PORTAL_URL` | `http://localhost:5173` / `:5174` in development builds | Opened from the role-selection screen. |

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
