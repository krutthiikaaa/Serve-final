# SERVE — Deployment (one domain, public demo)

This guide prepares SERVE for a **demo deployment on one public domain**.
`YOUR_DOMAIN` is a placeholder throughout: no domain, server, database or
Firebase project has been created for you. Every external step below needs the
project owner's decision and accounts.

| URL | What |
|---|---|
| `https://YOUR_DOMAIN/` | Student app, Flutter web build (browser testing and demos; installable) |
| `https://YOUR_DOMAIN/staff/` | Staff dashboard (installable on desktop) |
| `https://YOUR_DOMAIN/admin/` | Admin portal (installable on desktop) |
| `https://YOUR_DOMAIN/api/…` | REST API |
| `https://YOUR_DOMAIN/socket.io/` | Socket.IO realtime (WebSocket) |

The student app's real form is the Flutter **mobile** app (Android, iOS). It
is not published to the App Store or Google Play; testers run it from a
development machine or an APK, pointed at the same domain
([section 8](#8-installability)). The web build at `/` serves browser tests and
demos.

Payments stay **simulated** (mock provider, `DEMO_MODE=true`). No real money
moves. See [section 9](#9-demo-payments).

## 1. Architecture

```
            Phone / laptop browser          Flutter app (Android / iOS)
                     │  https://YOUR_DOMAIN           │
                     ▼                                │
   ┌───────────────────────────────────┐              │
   │ TLS: Caddy / nginx / the platform │◄─────────────┘
   │ (forwards everything, incl. WS)   │
   └─────────────────┬─────────────────┘
                     ▼ http://127.0.0.1:5001
   ┌────────────────────────────────────────────────────────────┐
   │ ONE Node.js process (backend, WEB_ROOT set)                │
   │   /api/*        Express REST    (JSON 404 for unknown)     │
   │   /socket.io/*  Socket.IO       (token auth, server rooms) │
   │   /staff/*      WEB_ROOT/staff    → staff index.html       │
   │   /admin/*      WEB_ROOT/admin    → admin index.html       │
   │   /*            WEB_ROOT/student  → student index.html     │
   └───────────────┬───────────────────────────┬────────────────┘
                   ▼                           ▼
              PostgreSQL              Firebase Auth (real project)
```

- **One process, one port, one origin.** The backend serves the three built
  apps itself when `WEB_ROOT` is set. A reverse proxy only terminates TLS.
  Without `WEB_ROOT` (local development, tests) it is the API alone, exactly
  as before.
- **Same-origin calls.** The built apps call `/api` and `/socket.io` on the
  origin that served them. No API URL is baked into the web builds, and CORS
  does not apply to them.
- **One instance.** Socket.IO runs without a Redis adapter, so run exactly
  one backend instance (enough for a campus demo). Several instances would
  need sticky sessions and the Socket.IO Redis adapter.

## 2. Routing details

| Request | Result |
|---|---|
| `/staff` or `/admin` | 301 to `/staff/` or `/admin/` (query kept) |
| `/staff/orders` (any path without a file extension) | the staff app's `index.html`, so a refresh on a deep link works. Same for `/admin/…` and the student app at `/…` |
| `/staff/assets/index-AbC123.js` | the file, `Cache-Control: public, max-age=31536000, immutable` (Vite hashes the names) |
| other files (`index.html`, `manifest.json`, Flutter's `main.dart.js`, icons) | `Cache-Control: no-cache`: revalidated on every load, so a redeploy is picked up on the next reload |
| a missing file with an extension, e.g. `/staff/assets/missing.js` | JSON 404, never an HTML page |
| `/api/unknown` | JSON 404 `ROUTE_NOT_FOUND` |
| dotfiles, `..` paths | never served |
| methods other than GET/HEAD outside `/api` | 404 |

Security headers on the pages (from `backend/src/web/web-apps.ts`):
`Content-Security-Policy` with scripts only from this origin
(`'wasm-unsafe-eval'` lets the Flutter renderer compile its WebAssembly),
network access to this origin and https/wss endpoints (Firebase Auth's REST API,
and menu images, which staff may host anywhere), `frame-ancestors 'none'`,
`object-src 'none'`, `upgrade-insecure-requests` in production;
`X-Frame-Options: DENY`; `Referrer-Policy: strict-origin-when-cross-origin`
(Firebase sees your origin, so an API key restricted to `https://YOUR_DOMAIN/*`
works); HSTS. `/api` keeps its stricter `default-src 'none'` policy.

Note: the backend's HSTS header includes `includeSubDomains`. On an apex
domain this tells browsers to use https for every subdomain too.

## 3. What you need (owner decisions — nothing here was created)

| Item | Notes |
|---|---|
| A domain | `YOUR_DOMAIN`. Any registrar; a subdomain of an existing university domain also works. |
| A host for one long-running Node.js 22 process with WebSockets | A Linux VPS with Caddy or nginx, a Node platform-as-a-service that supports WebSockets and long-lived processes, or any container host (see the [Dockerfile](../Dockerfile)). Not serverless functions (no persistent WebSockets) and not a static-only host (the backend is required). |
| PostgreSQL 16 | Managed (with automated backups) or on the VPS. |
| A Firebase project | Free tier is enough. Separate from development; never `demo-…`. |
| Optional: an Android signing key | Only for the APK ([section 8](#android-apk-optional)). |
| Optional: a Mac with Xcode and an Apple ID | Only to run the native app on an iPhone ([section 8](#student-app-on-an-iphone)). A free Apple ID is enough for testing on your own devices; TestFlight and the App Store need the paid Apple Developer Program, which this demo does not require. |

## 4. Firebase (production project)

1. Create a project in the Firebase console. Under **Authentication → Sign-in
   method**, enable **Email/Password** only.
2. **Project settings → General → Your apps → Add app → Web**: note the public
   `apiKey` and `projectId`. These are public values; they go into the web
   build (`npm run build:web`).
3. **Project settings → Service accounts → Generate new private key**: this
   JSON is a secret. Copy `client_email` and `private_key` into the backend's
   environment (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) and delete the
   downloaded file. Never commit it or put it in a frontend build.
4. Optional hardening in Google Cloud → APIs & Services → Credentials, on the
   web API key: restrict **APIs** to Identity Toolkit API and Token Service
   API. A **website restriction** (`https://YOUR_DOMAIN/*`) also works for the
   web apps, but blocks the native Android and iOS builds, which call Firebase
   Auth over REST without a referrer. Either restrict the key by API only, or
   give the native builds a second key restricted to those two APIs.
5. Authorized domains (Authentication → Settings) only matter for OAuth
   redirects, which SERVE does not use. Adding `YOUR_DOMAIN` is harmless.

The emulator demo accounts (`npm run db:seed:dev-users`) do not exist in a
real project, and that script refuses to run outside development.

## 5. Environment checklist

### Backend runtime (secrets: the host's secret manager or environment settings)

Template: [deploy/production.env.example](../deploy/production.env.example).
Validation runs at startup, names the variable that is wrong, and never
prints values.

| Variable | Value | Secret |
|---|---|---|
| `NODE_ENV` | `production` | no |
| `PORT` | `5001` (or what the platform assigns; never 5000) | no |
| `DATABASE_URL` | `postgresql://…` (add `sslmode=require` for a remote database). The local `serve_dev` / `serve_test` databases are rejected. | **yes** |
| `CORS_ORIGINS` | `https://YOUR_DOMAIN` (https only; localhost rejected) | no |
| `TRUST_PROXY` | number of proxies in front, usually `1` | no |
| `WEB_ROOT` | absolute path of the `npm run build:web` output | no |
| `FIREBASE_PROJECT_ID` | the real project id (`demo-` rejected) | no |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | service account | **yes** |
| `PAYMENT_MODE` | `mock` | no |
| `DEMO_MODE` | `true` (required for `mock` in production) | no |
| `PAYMENT_SECRET` | new `openssl rand -hex 32` for this deployment | **yes** |
| `LOG_LEVEL` | `info` | no |
| `STUDENT_EMAIL_DOMAINS` | optional allowlist, e.g. your university domain | no |
| `FIREBASE_AUTH_EMULATOR_HOST` | **must be unset** (rejected in production) | — |

`TRUST_PROXY` matters: rate limits are per client IP. Too low and every user
shares the proxy's IP (and its limit); too high and clients can spoof
`X-Forwarded-For`. Set it to the exact number of proxies.

Never copy development values (`backend/.env`, the dev `PAYMENT_SECRET`, dev
database passwords) into production.

### Web build (public values only; build machine or CI)

| Variable | Value |
|---|---|
| `FIREBASE_API_KEY` | the web `apiKey` from step 4.2 |
| `FIREBASE_PROJECT_ID` | the project id |
| `FIREBASE_AUTH_DOMAIN` | optional (defaults to `<projectId>.firebaseapp.com`) |
| `API_URL` | **leave unset** for the single domain (same origin). Only for a backend on a different https origin. |

## 6. Build

On a machine with Node.js 22, npm and Flutter 3.47+:

```bash
npm ci
FIREBASE_API_KEY='<web api key>' FIREBASE_PROJECT_ID='<project id>' npm run build:web
npm run build --workspace backend
```

`npm run build:web` (`scripts/build-web.mjs`):

- builds the staff and admin apps with Vite (`base` `/staff/` and `/admin/`,
  router basename to match) and the student app with
  `flutter build web --release --base-href / --no-web-resources-cdn --csp`,
  so Flutter's renderer is served from your domain and the build contains no
  `eval`;
- puts them in `dist/web/{student,staff,admin}` (gitignored): this folder
  is `WEB_ROOT`;
- refuses `demo-` projects and non-https `API_URL`s, and refuses to delete an
  output folder it did not create.

`npm run build:web -- --local` builds a preview against the Auth Emulator for
local testing ([section 12](#12-test-it-locally-first)). A production
server refuses to serve that build.

The web builds no longer register Flutter's deprecated service worker. At the
root scope it would sit in front of `/staff/`, `/admin/` and `/api`, and could
keep serving an old version after a deploy.

## 7. Deployment sequence

Run these steps in order; each needs the owner's accounts and approval.

1. **DNS:** point `YOUR_DOMAIN` at the host (A/AAAA record to the server's IP,
   or the CNAME your platform gives you). Open ports 80 and 443.
2. **PostgreSQL:** create the database and a dedicated user; turn on automated
   backups.
3. **Firebase:** section 4.
4. **Build:** section 6. Copy `dist/web` and the repository (or the Docker
   image) to the host.
5. **Environment:** section 5, in the host's secret store.
6. **Migrate** (with the production environment loaded):

   ```bash
   npm run prisma:migrate:deploy --workspace backend
   ```

   Never run `prisma migrate dev` or `migrate reset` against production.
7. **Catalogue** (hostels, canteens, demo menus; idempotent, never changes
   existing rows; allowed in production only with `DEMO_MODE=true`):

   ```bash
   npm run db:seed --workspace backend
   ```

8. **Start** the backend: `node backend/dist/server.js`, under systemd, the
   platform's process manager, or the container. Example systemd unit:

   ```ini
   [Unit]
   Description=SERVE backend
   After=network-online.target

   [Service]
   WorkingDirectory=/srv/serve
   EnvironmentFile=/etc/serve/serve.env   # chmod 600, owned by root
   ExecStart=/usr/bin/node backend/dist/server.js
   User=serve
   Restart=on-failure
   TimeoutStopSec=15

   [Install]
   WantedBy=multi-user.target
   ```

   The log shows `SERVE backend listening …` and a `DEMO_MODE` warning.
9. **HTTPS:** [deploy/Caddyfile](../deploy/Caddyfile) (automatic Let's Encrypt
   certificates) or [deploy/nginx.conf](../deploy/nginx.conf) (with certbot).
   Replace `YOUR_DOMAIN`. Both forward everything to `127.0.0.1:5001`
   including WebSocket upgrades. On a platform that terminates TLS for you,
   skip this step.
10. **First admin:** create the user in Firebase console → Authentication →
    Add user, then link it (production environment loaded):

    ```bash
    npm run admin:create --workspace backend -- --email <admin email> --name "<name>" --confirm-production
    ```

11. **Smoke test** (read-only; never signs in or writes):

    ```bash
    npm run smoke:deploy -- https://YOUR_DOMAIN
    ```

    It checks https, `/api/health` and `/api/health/db`, every app and a deep
    link for each, the `/staff` redirect, the three manifests and their icons,
    page security headers, and a Socket.IO WebSocket upgrade (an unauthenticated
    socket must be refused with `AUTH_REQUIRED`).
12. **Walk the demo:** staff create an account at `/staff/create-account`,
    the admin approves them in `/admin/`, and a student registers at `/`,
    orders, pays with the demo gateway and collects.

### Docker (optional)

The [Dockerfile](../Dockerfile) packages the backend with a prebuilt
`dist/web` (Flutter is not in the image):

```bash
FIREBASE_API_KEY=… FIREBASE_PROJECT_ID=… npm run build:web
docker build -t serve .                      # runtime image (production deps only)
docker build --target build -t serve-tools . # migrations, seed, admin:create
docker run --env-file serve.env -p 127.0.0.1:5001:5001 serve
docker run --rm --env-file serve.env serve-tools npm run prisma:migrate:deploy --workspace backend
```

`serve.env` holds the variables from section 5 (`WEB_ROOT` is already set to
`/app/web` in the image). Keep it out of the repository and out of the build
context (`.dockerignore` excludes env files and keys).

> Not built in the preparation environment: its build containers could not
> reach the npm registry. The image's runtime layout (production
> dependencies, `backend/dist`, `WEB_ROOT`) was reproduced and tested directly
> on the host. Run `docker build` once before relying on it.

## 8. Installability

### Student app on an iPhone

**Native app (the real student app).** Needs a Mac with Xcode, the iPhone on
a cable (or the same network), and an Apple ID:

1. Open `apps/student/ios/Runner.xcworkspace` in Xcode → **Runner** target →
   **Signing & Capabilities** → choose your **Team**. With a free Apple ID,
   change the bundle identifier if Xcode reports `app.serve.serveStudent` is
   taken (for example `app.serve.serveStudent.<yourname>`).
2. On the iPhone: **Settings → Privacy & Security → Developer Mode → On**
   (iOS 16+), then trust the computer when asked.
3. Run it against the deployed domain (release mode, real Firebase project):

   ```bash
   cd apps/student
   flutter devices                       # note the iPhone's id
   flutter run --release -d <iphone-id> \
     --dart-define=API_URL=https://YOUR_DOMAIN \
     --dart-define=FIREBASE_API_KEY='<web api key>' \
     --dart-define=FIREBASE_PROJECT_ID='<project id>' \
     --dart-define=STAFF_DASHBOARD_URL=https://YOUR_DOMAIN/staff/ \
     --dart-define=ADMIN_PORTAL_URL=https://YOUR_DOMAIN/admin/
   ```

4. If iOS says "Untrusted Developer": **Settings → General → VPN & Device
   Management** → trust your Apple ID.

Apps signed with a free Apple ID stop opening after 7 days; run step 3 again.
Before deployment, the same app runs against your computer instead:
[apps/student/README.md](../apps/student/README.md#your-own-iphone-mac--xcode).

**Web build (no Mac needed).** Safari → `https://YOUR_DOMAIN/` → **Share → Add
to Home Screen**. It opens full screen (manifest `display: standalone` plus
`apple-mobile-web-app-capable`). This is the Flutter web build in Safari's
engine: live updates arrive while it is open (there are no push
notifications), and iOS may clear a web app's stored data, after which the
student signs in again.

### Student app on Android

Native: build the APK below and install it, or `flutter run --release -d
<phone-id>` with the same `--dart-define` values as for the iPhone. Web: Chrome
→ `https://YOUR_DOMAIN/` → **⋮ → Install app**.

### Staff dashboard and admin portal on desktop

Chrome or Edge → `https://YOUR_DOMAIN/staff/` (or `/admin/`) → the install
icon in the address bar → **Install**. Each has its own manifest, scope and
window.

Notes:

- Chrome's installability check passed for all three apps in the
  single-domain test suite; real-device installs have not been tried.
- **Icons:** made from the official SERVE logo (`brand/`), centred on the
  warm off-white background: the web icons in `apps/student/web/icons/`
  (all three apps use them, served at `/icons/…`), the Android launcher
  icons and the iOS app icon. See [brand/README.md](../brand/README.md).
- **One browser, one Firebase session for staff and admin:** `/staff/` and
  `/admin/` share an origin, so they share the Firebase sign-in. A staff
  member opening `/admin/` is told "You are signed in with a staff account"
  and sees no admin data, because the backend decides roles. Use separate
  browser profiles to be signed in as staff and admin at once. The student
  app keeps its own session.
- The student app's scope is `/`, which technically includes `/staff/` and
  `/admin/`. Staff should install their dashboard from `/staff/` in a normal
  browser tab, not from inside the installed student app.

### Android APK (optional)

```bash
cd apps/student
flutter build apk --release \
  --dart-define=API_URL=https://YOUR_DOMAIN \
  --dart-define=FIREBASE_API_KEY='<web api key>' \
  --dart-define=FIREBASE_PROJECT_ID='<project id>' \
  --dart-define=STAFF_DASHBOARD_URL=https://YOUR_DOMAIN/staff/ \
  --dart-define=ADMIN_PORTAL_URL=https://YOUR_DOMAIN/admin/
# → build/app/outputs/flutter-apk/app-release.apk (gitignored)
```

Release builds refuse the emulator, `demo-` projects and non-https or
localhost API URLs, and Android release builds allow https only.

**Signing.** As generated by Flutter, release builds are signed with the
build machine's **debug key**. That is fine for side-loading a demo, but an
APK signed on another machine cannot update it, and stores reject it. For a
lasting demo, create your own key:

```bash
keytool -genkey -v -keystore ~/serve-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias serve
```

Then create `apps/student/android/key.properties`:

```properties
storePassword=<…>
keyPassword=<…>
keyAlias=serve
storeFile=/home/<you>/serve-upload.jks
```

Finally, wire it up in `apps/student/android/app/build.gradle.kts` as
[Flutter's signing guide](https://docs.flutter.dev/deployment/android#sign-the-app)
describes: load `key.properties` into a `signingConfigs.create("release")`
block and use it in `buildTypes.release`. `key.properties`, `*.jks` and
`*.keystore` are already gitignored. Never commit them, and back up the
keystore: losing it means users must uninstall to update. The Gradle change
is not applied in this repository, and no APK has been built yet: the
preparation environment cannot download the Android SDK.

**Distribution.** Share the file directly (a download link, Google Drive, or
Firebase App Distribution). Testers must allow "Install unknown apps" for
their browser or file manager. Do not commit APKs.

## 9. Demo payments

What `DEMO_MODE=true` does:

- allows `PAYMENT_MODE=mock` with `NODE_ENV=production` (otherwise
  rejected at startup);
- mounts `POST /api/payments/:orderId/mock-complete` (otherwise mounted
  only outside production);
- allows the non-destructive catalogue seed in production;
- logs a warning at startup.

What it does **not** change:

- the other production checks: https-only CORS, no emulator, no `demo-`
  project, service-account credentials required, a 32+ character
  `PAYMENT_SECRET`;
- verification: `mock-complete` creates an HMAC-signed confirmation and
  runs it through the same path as a real gateway (signature, captured
  amount against the server-side order total, idempotent replay, only the
  owning student). The client never sends prices or totals;
- it cannot be combined with `PAYMENT_MODE=razorpay`.

The student payment screen says **"Demo mode: no real money is charged"**.
Treat every "paid" order in a demo as simulated, and tell canteen staff so.

### What must change before real payments

1. Finish the Razorpay adapter (`backend/src/modules/payments/razorpay.provider.ts`).
   Its API calls currently return 503 and never fake success.
2. In the student app, replace the mock step with Razorpay Checkout
   (initiate → Razorpay → `POST /api/payments/:id/verify`), and remove
   "Simulate a failed payment".
3. Environment: `PAYMENT_MODE=razorpay` with `RAZORPAY_KEY_ID`,
   `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in the secret store;
   remove `DEMO_MODE` and `PAYMENT_SECRET`.
4. In the Razorpay dashboard, set the webhook to
   `https://YOUR_DOMAIN/api/payments/webhooks/razorpay`.
5. Extend the page CSP in `backend/src/web/web-apps.ts` with the script and
   frame origins Razorpay Checkout documents at that time.
6. Run the payment test suite and a Razorpay test-mode run end to end; add
   refund and reconciliation procedures, terms and a refund policy before
   taking live money.

## 10. Operations

- **Logs:** JSON lines on stdout (pino), with request ids and redacted
  secrets. Collect them with journald or the platform's log viewer.
- **Health checks:** `GET /api/health` (process) and `GET /api/health/db`
  (database). Neither is rate-limited; use them for load balancers and uptime
  alerts.
- **Graceful shutdown:** on SIGTERM the server stops accepting connections,
  closes sockets and the database pool, and exits within 10 s. Give the
  platform a stop timeout of at least 15 s. Clients reconnect automatically
  and refetch.
- **Redeploys:** build the web apps, run `prisma migrate deploy`, then
  restart. With one instance there is a brief disconnect, and clients
  reconnect on their own. Pages revalidate (`no-cache`), so the new version
  loads on the next reload.
- **Backups:** managed PostgreSQL with daily backups and point-in-time
  recovery, or `pg_dump` on a schedule copied off the server. Test a
  restore.
- **Monitoring:** an external uptime check on `/api/health/db`, and alerts on
  restarts and on error-level log lines.
- **Scaling:** one instance only (section 1).

## 11. Security notes for the public demo

- Nobody can become staff or admin by visiting a URL. Admins exist only
  through `admin:create`; staff need an admin's approval; every request is
  authorised from PostgreSQL, never from the token, URL or local storage.
  Socket rooms are assigned by the server.
- Development-only pieces cannot reach production: the emulator and `demo-`
  projects are rejected at startup, the dev-user seed refuses non-development
  environments, a `build:web --local` preview is refused, and `mock-complete`
  exists only in mock mode, which production accepts only with
  `DEMO_MODE=true`.
- CORS stays an exact allowlist (`https://YOUR_DOMAIN`), never `*`. The web
  apps are same-origin and do not depend on it; the native apps send no
  Origin.
- Keep the Firebase Email/Password provider the only one enabled, rotate
  `PAYMENT_SECRET` if it leaks, and keep the service-account key only in the
  secret store.

## 12. Test it locally first

```bash
npm run emulators                       # separate terminal
npm run test:e2e:single-domain          # builds the apps, serves them on one origin, runs the suite
```

The single-domain suite (`e2e/tests/single-domain.spec.ts`) loads `/`,
`/staff/` and `/admin/` and deep links with a refresh; checks `/api`, Chrome's
installability verdict for all three apps, and the full flow (Flutter
student pays with the demo gateway, staff work the order live over a
WebSocket, the student sees each step, the admin sees the result); and fails
on page errors, CSP violations or broken files. With
`E2E_SINGLE_DOMAIN_URL=https://… E2E_IGNORE_HTTPS_ERRORS=1` it runs through
a local Caddy or nginx with a self-signed certificate.

To click around by hand:

```bash
npm run build:web -- --local
WEB_ROOT="$PWD/dist/web" npm run dev:backend     # then open http://localhost:5001/
npm run smoke:deploy -- http://localhost:5001
```

The apps are same-origin, so `CORS_ORIGINS` needs no change for this.

## 13. Configuration audit (what is local, what changed)

| Setting | Where | Class | Status |
|---|---|---|---|
| `localhost:5001` / `10.0.2.2` / emulator defaults | `apps/student/lib/config/app_config.dart` | local dev | kept for `flutter run`; a built web app now defaults to its own origin |
| `VITE_API_URL=http://localhost:5001`, emulator URL | `apps/*/.env.example` → `.env.development.local` | local dev | kept; never read by builds |
| Vite dev ports 5173/5174, `base: '/'` in dev | `apps/*/vite.config.ts` | local dev | kept |
| Vite `base` for builds | `apps/*/vite.config.ts` | production change | `/staff/`, `/admin/` |
| Router basename | `apps/*/src/App.tsx` | production change | from `import.meta.env.BASE_URL` |
| Logo path `/brand/serve-logo.png` | `packages/web-shared/src/ui/components.tsx` | production change | prefixed with the base URL |
| Required `VITE_API_URL` | `apps/*/src/config.ts`, `vite.config.ts` | production change | optional in builds (same origin); https only when set |
| Flutter `<base href>` | `apps/student/web/index.html` | production | `/` (`--base-href /`) |
| Flutter service worker | `apps/student/web/flutter_bootstrap.js` | production change | not registered |
| Backend CORS defaults | `.env.example` | local dev | kept; production `https://YOUR_DOMAIN` |
| Static hosting, page CSP | `backend/src/web/web-apps.ts` | production change | new, opt-in via `WEB_ROOT` |
| Mock payments in production | `backend/src/config/env.ts` | production change | only with `DEMO_MODE=true` |
| Local `serve_dev` / `serve_test` database in production | `backend/src/config/env.ts` | production change | rejected at startup |
| `demo-` Firebase project in web builds | `apps/*/vite.config.ts`, `scripts/build-web.mjs` | production change | rejected |
| Socket.IO path | default `/socket.io` on the same server | production | unchanged; WebSocket upgrades pass through Caddy/nginx |
| `firebase.json` (127.0.0.1), `firebase.phone.json` (0.0.0.0) | repo root | local dev | kept |
| E2E ports 5101/5273/5274/5455, emulator | `e2e/tests/support/constants.mjs` | test | kept |
| Test fixtures with localhost | backend, web-shared, Flutter tests | test | kept |
| Docker | none before | production | `Dockerfile`, `.dockerignore` added |

## 14. Readiness

**Verified on the local stack** (real backend process, PostgreSQL, Firebase
Auth Emulator; no mocked HTTP, database or auth):

- Student, staff and admin flows end to end, through the APIs and in real
  browsers (Playwright drives the Flutter web build and both React apps).
- PostgreSQL as the source of truth: registrations, menu changes, orders,
  payments and staff status read back from the database, and unchanged after a
  backend restart.
- Realtime: order status to the right student only, paid orders to that
  canteen's staff only, menu and pause/resume changes to students viewing the
  canteen, approval, rejection, reassignment and deactivation to the staff
  member; reconnects re-verify the token; expired, invalid and missing tokens
  are refused.
- Authorization on the server: students and staff are refused on admin routes,
  staff only see their own canteen, client prices and role headers are ignored.
- Production builds of all three apps, and the single-domain layout (`/`,
  `/staff/`, `/admin/`, `/api`, `/socket.io`) served by one process.

**Not verified yet:** a real deployment (domain, TLS, managed database, real
Firebase project), `docker build`, the Android APK build, the iOS build, and
any real phone. The native builds need the Android SDK or a Mac with Xcode,
which the preparation environment does not have.

**Before deploying, the owner provides:** the domain and DNS access; a host
for one Node.js 22 process with WebSockets; PostgreSQL 16 with backups; a
Firebase project (web API key, project id, service account); a new
`PAYMENT_SECRET`; and the first admin's email. Then follow
[section 7](#7-deployment-sequence).
