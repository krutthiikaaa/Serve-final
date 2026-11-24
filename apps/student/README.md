# SERVE — Student app (Flutter)

The student side of SERVE: browse your night canteen's menu, order, pay
online, and collect in person when the order is ready. There is no delivery and
no cash on delivery.

Flutter 3.47 / Dart 3.13. It is a **mobile app for Android and iOS**. A web
build of the same code exists only for quick previews in a browser and for the
automated end-to-end tests.

## Run it

Requirements: **Flutter 3.47 or newer** (`flutter --version`) and the backend
stack running on your computer: PostgreSQL and the backend on `:5001` (see
[docs/development.md](../../docs/development.md), which also covers Windows
PowerShell). Commands run from the repository root.

Students sign in with **Google only** (verified `@srmap.edu.in` accounts),
through the backend; the backend needs your own Google OAuth client for that
(`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, see the development guide).
Staff and admins do not use this app to sign in: they use the staff dashboard
and admin portal with their email and password.

### Android emulator (easiest)

1. Start an emulator (Android Studio → Device Manager → ▶).
2. `npm run dev:student -- -d emulator-5554` (the id comes from `flutter devices`).

No other settings are needed: the app reaches your computer as `10.0.2.2`.

### iOS simulator (Mac)

`npm run dev:student -- -d "iPhone 16"` (any simulator from `flutter devices`).

### Your own phone (same Wi-Fi as your computer)

1. Android: turn on Developer options → USB debugging and connect the phone
   (USB or wireless debugging). It should appear in `flutter devices`.
2. `npm run dev:student -- -d <phone-id> --lan`. This finds your computer's
   network address and points the app at it.
3. If the phone still can't connect, allow port 5001 through your computer's
   firewall.
4. Google sign-in on a phone or emulator needs the backend on a public https
   URL registered with Google (`BETTER_AUTH_URL`, e.g. a tunnel): see
   [docs/authentication.md](../../docs/authentication.md#native-app-android--ios).

The debug build allows plain `http://` to your computer; release builds only
talk to an `https://` backend.

### Your own iPhone (Mac + Xcode)

Not yet tried on a real iPhone; these are the standard Flutter steps.

1. One-time signing: open `ios/Runner.xcworkspace` in Xcode → **Runner**
   target → **Signing & Capabilities** → pick your **Team** (a free Apple ID
   works). If the bundle id `app.serve.serveStudent` is taken, use your own,
   e.g. `app.serve.serveStudent.<yourname>`.
2. On the iPhone: **Settings → Privacy & Security → Developer Mode → On**
   (iOS 16+), connect it by cable and trust the computer.
3. Start the backend as usual, then
   `npm run dev:student -- -d <iphone-id> --lan` (`flutter devices` shows the
   id). iPhone and Mac must be on the same Wi-Fi.
4. Allow **Local Network** when iOS asks (debug builds talk to your Mac). If
   you declined: Settings → SERVE → Local Network.
5. "Untrusted Developer": **Settings → General → VPN & Device Management** →
   trust your Apple ID. Builds signed with a free Apple ID expire after 7 days.

After deployment, run it against the public domain in release mode instead:
[docs/deployment.md](../../docs/deployment.md#student-app-on-an-iphone).

### In a browser (quick preview only)

`npm run dev:student` opens it in Chrome on http://localhost:5555. The backend's
`CORS_ORIGINS` must include `http://localhost:5555` (it does in
`.env.example`).

### Signing in

Tap **Student → Continue with Google** and choose your `@srmap.edu.in` Google
account. The first time, enter your name and hostel. Other Google accounts
(e.g. Gmail) are refused, and a staff or admin address is told to use the
staff dashboard or admin portal with its email and password.

### Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| `version solving failed` / `requires SDK version ^3.13.3` | Flutter is older than 3.47 | `flutter upgrade` |
| `Flutter was not found` (from `npm run dev:student`) | Flutter isn't on your PATH | Install Flutter, or set `FLUTTER_BIN` to the `flutter` executable |
| `No supported devices connected` | No phone, emulator or simulator is running (desktop isn't a target) | Start an Android emulator / iOS simulator, connect your phone, or use `npm run dev:student` for Chrome |
| "Unable to connect to SERVE" on the role screen or after sign-in | Backend not running, or the web origin isn't allowed | Start `npm run dev:backend`; add `http://localhost:5555` to `CORS_ORIGINS` in `backend/.env` and restart the backend |
| "This account is not eligible to use SERVE…" | The Google account is not `@srmap.edu.in` | Use your SRM University-AP Google account |
| "Google sign-in is for students only…" | The address belongs to a staff or admin account | Use the staff dashboard / admin portal with email + password |
| Google: `redirect_uri_mismatch` | The OAuth client's redirect URI is not `<BETTER_AUTH_URL>/api/auth/callback/google` | Fix it in the Google Cloud console (see docs/development.md) |
| Works in Chrome but not on an Android emulator | A custom `API_URL` uses `localhost` | Drop the flag (the default is `10.0.2.2`) or use `10.0.2.2` |
| Your own phone can't connect | `localhost` on the phone is the phone itself | Run `npm run dev:student -- -d <phone-id> --lan`; same Wi-Fi; allow port 5001 in the firewall |

## Configuration (`--dart-define`)

| Key | Default | Notes |
|---|---|---|
| `API_URL` | `http://localhost:5001` (`http://10.0.2.2:5001` on an Android emulator); a **built** web app uses the origin that serves it | Backend origin. REST lives under `/api`, Socket.IO at `/socket.io`. |
| `STAFF_DASHBOARD_URL` / `ADMIN_PORTAL_URL` | `http://localhost:5173` / `:5174` in development builds; `/staff/` and `/admin/` on the serving origin for a built web app | Opened from the role screen's Staff / Admin options (they sign in there with email + password). |

Only public values go here. Google OAuth credentials, database passwords and
payment secrets exist only on the backend.

**Release builds** (`flutter build apk|ipa|web --release`) refuse to start with
a non-`https` / localhost `API_URL` (see `lib/config/app_config.dart`). Android release builds keep the
platform default of HTTPS only; plain HTTP is allowed in debug builds for the
local backend.

## Demo deployment, installing on a phone, APK

The native app is the real student app; it is not published to the App
Store or Google Play. Against the deployed domain it runs from Xcode or
`flutter run --release` on an iPhone, and as an APK on Android, with
`--dart-define=API_URL=https://YOUR_DOMAIN`. The
web build is served at `/` on the same domain for browser tests and demos
(installable from Safari or Chrome). `npm run build:web` (repository root)
builds it; it does not register Flutter's service worker
(`web/flutter_bootstrap.js`). Details, signing and distribution:
[docs/deployment.md](../../docs/deployment.md#8-installability).

## Structure

```
lib/
  main.dart                 wires config → auth → API → realtime → app
  app.dart                  providers + AuthGate (routes on /api/auth/me, owns the session lifecycle)
  config/app_config.dart    --dart-define values and release validation
  core/                     ApiException + messages, formatting (paise → ₹), UUIDs
  services/auth/            Google sign-in via the backend (Better Auth), secure session store, AuthController
  services/api/             ApiClient (bearer / cookie session, error envelope), ServeApi, models
  services/realtime/        Socket.IO with token callback, auth.expired refresh, connection epoch
  state/                    cart (one canteen), selected canteen, notifications badge
  ui/                       screens, widgets, navigation, live-reload mixin
```

Screens: splash, role selection, login, registration, home, canteen selection,
menu, food details, cart, checkout (pickup only), payment (mock gateway), order
confirmation, order tracking, orders, order details, notifications, profile.
The bottom navigation is exactly Home, Menu, Orders and Profile.

See [docs/frontend-architecture.md](../../docs/frontend-architecture.md) for the
design decisions (how realtime refetching works, what the client never sends;
its sign-in sections predate Better Auth — see
[docs/authentication.md](../../docs/authentication.md)).

## Logo

`assets/images/serve_logo.png` is the official logo from `/brand/` (same
file; see [brand/README.md](../../brand/README.md)). It is never redrawn, boxed
or recoloured; the app icons are made from it. Menu items without an
`imageUrl` show a category placeholder.

## Tests

```bash
flutter analyze
flutter test                                    # unit + widget tests (fakes, no network)

# The real service layer against a running test backend (NODE_ENV=test,
# AUTH_TEST_SIGN_IN=true) and an approved staff account with the KITCHEN and
# CASHIER capabilities (staff sign in with email + password):
SERVE_INTEGRATION=1 API_URL=http://localhost:5101 \
  SERVE_STAFF_EMAIL='…' SERVE_STAFF_PASSWORD='…' flutter test --tags integration
```

The web build is also driven end to end by Playwright
(`E2E_STUDENT_WEB=1 npm run test:e2e`, see [e2e](../../e2e)).
