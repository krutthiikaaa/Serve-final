# SERVE — Student app (Flutter)

The student side of SERVE: browse your night canteen's menu, order, pay
online, and collect in person when the order is ready. There is no delivery and
no cash on delivery.

Flutter 3.47 / Dart 3.13. Platforms: Android, iOS and web.

## Run it locally

Follow this copy-pasteable setup guide to start the local development environment. You will need three terminal windows.

### Terminal 1 — Firebase Emulators
Start the Firebase Auth emulator to handle authentication locally without hitting production servers.
```bash
npm run emulators
```
*Note: This terminal must remain open while testing locally.*

### Terminal 2 — Backend
Start the backend API and Socket.IO server.
```bash
npm run dev:backend
```
The backend should start on port `5001`. You can check its health endpoint by opening `http://localhost:5001/api/health` in your browser.

### Terminal 3 — Student App
Launch the Flutter Student App in the browser.
```bash
npm run dev:student
```
Once it builds, open the Student App at **http://localhost:5555**.

---

### Seed Development Accounts

Before you can log in, you must create demo accounts in the emulator and local database. Wait until **both** the Firebase Emulator (Terminal 1) and the Backend (Terminal 2) are running, then open a new terminal and run:

```bash
DEV_SEED_PASSWORD='dev-password-123' npm run db:seed:dev-users --workspace backend
```
*(This is safe to rerun at any time. It's idempotent and updates existing accounts.)*

This script creates the development student account you can use to sign in to the Student App:
- **Email:** `student@serve.dev`
- **Password:** `dev-password-123`

*(Note: These are local development credentials only. Never use them in production.)*

### Troubleshooting

- **Firebase emulator connection failures:** Ensure Terminal 1 (`npm run emulators`) is running and not failing with port conflicts.
- **CORS errors:** If the browser console shows CORS errors, make sure you added `http://localhost:5555` to the `CORS_ORIGINS` in your root `.env` (or `backend/.env`) file and restarted the backend.
- **Port conflicts:** If port `5001`, `9099`, or `5555` is in use, you must stop the conflicting service or macOS feature (e.g., AirPlay Receiver on port `5000` is close, but we use `5001`).
- **Missing Flutter:** The `dev:student` command requires Flutter to be installed and available in your PATH. If it says Flutter is missing, [install Flutter](https://docs.flutter.dev/get-started/install).
- **Failed login:** If the login fails but the backend is running, try re-running the seed script. The emulator's memory gets wiped if it was restarted, so you may need to recreate the users.

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
