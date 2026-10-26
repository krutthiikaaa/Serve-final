# SERVE — Deployment guide (one domain, public demo)

This guide takes SERVE from this repository to a public demo on **one
domain**, step by step. `YOUR_DOMAIN` is a placeholder throughout. No domain,
server, database or Firebase project has been created for you, and no hosting
provider has been chosen: every external step needs the owner's accounts and
approval.

| URL | What |
|---|---|
| `https://YOUR_DOMAIN/` | Student app, Flutter web build (browser testing and demos; installable) |
| `https://YOUR_DOMAIN/staff/` | Staff dashboard (desktop/tablet; installable) |
| `https://YOUR_DOMAIN/admin/` | Admin portal (desktop/tablet; installable) |
| `https://YOUR_DOMAIN/api/…` | REST API |
| `https://YOUR_DOMAIN/socket.io/` | Socket.IO realtime (WebSocket over TLS) |

The student app's real form is the Flutter **mobile** app (Android, iOS). It
is not published to the App Store or Google Play: testers install an APK or
run it from Xcode, pointed at the same domain (steps 15–17). Payments stay
**simulated** (mock provider, `DEMO_MODE=true`); no real money moves
([appendix B](#b-demo-payments-and-razorpay)).

```
                INTERNET (HTTPS)
          ┌──────────────┴───────────────┐
   phone / laptop browser       Flutter app (Android / iOS)
          └──────────────┬───────────────┘
                         ▼  https://YOUR_DOMAIN
          ┌───────────────────────────────┐
          │ Caddy (or nginx): TLS, passes │
          │ everything incl. WebSockets   │
          └──────────────┬────────────────┘
                         ▼  serve:5001 / 127.0.0.1:5001
   ┌──────────────────────────────────────────────────────────┐
   │ ONE Node.js process (backend image, WEB_ROOT set)        │
   │   /api/*        Express REST    (JSON 404 for unknown)   │
   │   /socket.io/*  Socket.IO       (token auth, server rooms)│
   │   /staff/*      staff dashboard (React build)            │
   │   /admin/*      admin portal    (React build)            │
   │   /*            student web app (Flutter web build)      │
   └──────────────┬──────────────────────────┬────────────────┘
                  ▼                          ▼
             PostgreSQL 16           Firebase Auth (real project)
```

- **One process, one port, one origin.** The backend serves the three built
  web apps itself. The reverse proxy only terminates TLS. The built apps call
  `/api` and `/socket.io` on the origin that served them: no API URL is baked
  into the web builds, and CORS does not apply to them.
- **One instance.** Socket.IO runs without a Redis adapter, so run exactly one
  backend instance (enough for a campus demo).
- **Local development is unchanged:** student `:5555`, staff `:5173`, admin
  `:5174`, backend `:5001` ([development.md](development.md)).

**On Render** (no server to manage, the generated `onrender.com` address,
HTTPS included): use the [render.yaml](../render.yaml) Blueprint and follow
[render.md](render.md). The rest of this guide covers your own server, and
its Firebase, testing, mobile, backup and security steps apply to Render too.

**The whole deployment in commands** (Docker Compose on one server; each step
is explained below):

```bash
# server (Docker), repository checked out
cp deploy/production.env.example deploy/serve.env      # then fill it in (step 6)
export SERVE_DOMAIN=YOUR_DOMAIN
export FIREBASE_API_KEY='<web api key>' FIREBASE_PROJECT_ID='<project id>'   # public; for the web build
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml --profile tools run --rm migrate
docker compose -f deploy/docker-compose.yml --profile tools run --rm migrate npm run db:seed --workspace backend
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml --profile tools run --rm migrate \
  npm run admin:create --workspace backend -- --email <admin email> --name "<name>" --confirm-production

# any machine
npm run smoke:deploy -- https://YOUR_DOMAIN
```

---

## 1. Requirements

| You need | Why |
|---|---|
| A domain | `YOUR_DOMAIN` (step 2) |
| A Linux server with Docker (or Node.js 22) | Runs the backend and the proxy (step 3) |
| PostgreSQL 16 | The database (step 4) |
| A Firebase project | Sign-in for all three apps (step 5) |
| Node.js 22 and Flutter 3.47+ | Only to build without Docker (the image builds everything itself) and for the mobile app |
| Optional: Android SDK (Android Studio) | The student APK (step 16) |
| Optional: a Mac with Xcode and an Apple ID | The student app on an iPhone (step 17) |

## 2. Domain

1. Buy or pick a domain (any registrar; a subdomain of an existing university
   domain also works).
2. In its DNS settings, add an **A** record (and **AAAA** for IPv6) pointing
   at your server's public IP, or the CNAME your platform gives you.
3. Make sure ports **80** and **443** reach the server (firewall / security
   group). Caddy needs both to obtain the certificate.
4. Wait until `nslookup YOUR_DOMAIN` returns the server's IP.

## 3. Hosting / server

SERVE needs **one long-running Node.js process that accepts WebSockets**, plus
PostgreSQL. That rules out serverless functions (no persistent WebSockets) and
static-only hosting (the backend is required). Any of these works; none has
been chosen:

- **A Linux VPS** (2 GB RAM is comfortable) running Docker Compose: the SERVE
  container behind a Caddy container ([deploy/docker-compose.yml](../deploy/docker-compose.yml)).
  This is the path this guide follows.
- **The same VPS without Docker:** Node.js 22 under systemd, with Caddy or
  nginx installed on the host (steps 9–10 show both).
- **A container platform** that supports WebSockets and long-lived
  containers: run the SERVE image ([Dockerfile](../Dockerfile)) and let the
  platform terminate TLS. **Render** is prepared: [render.md](render.md).

## 4. PostgreSQL

Use **PostgreSQL 16**, either a managed database (automated backups and
point-in-time recovery included; recommended) or PostgreSQL on the server.

1. Create a database (e.g. `serve`) and a dedicated user that owns it.
2. Build the connection string:
   `postgresql://<user>:<password>@<host>:5432/serve?schema=public`.
   For a database on another machine append `&sslmode=require`. From inside
   Docker Compose, a database on the host itself is `host.docker.internal`
   (PostgreSQL must then listen on the Docker bridge, not only 127.0.0.1).
3. It goes into `DATABASE_URL` (step 6). The local development databases
   `serve_dev` and `serve_test` are rejected in production.

PostgreSQL is the only source of truth: accounts, roles, canteens, menus,
orders and payments. Backups: step 20.

## 5. Firebase production project

1. Create a project in the Firebase console. **Authentication → Sign-in
   method:** enable **Email/Password** only.
2. **Project settings → General → Your apps → Add app → Web.** Note the
   public `apiKey` and `projectId`. They go into the web build (step 8) and the
   mobile app (step 15). They are public by design.
3. **Project settings → Service accounts → Generate new private key.** This
   JSON is a **secret**. Copy `client_email` and `private_key` into the
   backend environment (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`), then
   delete the downloaded file. Never commit it or put it in a frontend build.
4. Optional hardening (Google Cloud → APIs & Services → Credentials, the web
   API key): restrict **APIs** to Identity Toolkit API and Token Service API.
   A **website restriction** (`https://YOUR_DOMAIN/*`) works for the web apps
   but blocks the native Android and iOS builds, which call Firebase Auth over
   REST without a referrer. Either restrict by API only, or give the native
   builds a second key restricted to those two APIs.
5. Authorized domains only matter for OAuth redirects, which SERVE does not
   use. Adding `YOUR_DOMAIN` is harmless.

The backend verifies every Firebase ID token (including revocation) and reads
roles, staff approval and canteen assignment from PostgreSQL only. The
emulator demo accounts do not exist in a real project; the script that
creates them refuses to run outside development.

## 6. Environment variables

### Backend (secret; on the server only)

Copy [deploy/production.env.example](../deploy/production.env.example) to
`deploy/serve.env` (Docker Compose; gitignored) or `/etc/serve/serve.env`
(systemd; `chmod 600`) and fill it in. Validation runs at startup, names any
wrong variable and never prints values.

| Variable | Value | Secret |
|---|---|---|
| `NODE_ENV` | `production` (set by the image and compose) | no |
| `PORT` | `5001` (never 5000) | no |
| `DATABASE_URL` | step 4 | **yes** |
| `CORS_ORIGINS` | `https://YOUR_DOMAIN` (https only; localhost rejected) | no |
| `TRUST_PROXY` | number of proxies in front, `1` with Caddy | no |
| `WEB_ROOT` | built web apps; `/app/web` in the image (compose sets it) | no |
| `FIREBASE_PROJECT_ID` | step 5 (`demo-` rejected) | no |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | step 5.3; the key on one line with `\n` for newlines | **yes** |
| `PAYMENT_MODE` | `mock` | no |
| `DEMO_MODE` | `true` (required for `mock` in production) | no |
| `PAYMENT_SECRET` | new `openssl rand -hex 32` for this deployment | **yes** |
| `LOG_LEVEL` | `info` | no |
| `STUDENT_EMAIL_DOMAINS` | optional allowlist, e.g. your university domain | no |
| `FIREBASE_AUTH_EMULATOR_HOST` | **must be unset** (rejected) | — |
| `RATE_LIMIT_*`, `SENSITIVE_RATE_LIMIT_*` | optional; defaults 300 and 20 requests per minute | no |

Production refuses to start with localhost or plain-http CORS origins, the
emulator, a `demo-` project, the local development databases, or mock payments
without `DEMO_MODE=true`. Never copy development values (`backend/.env`, the
dev `PAYMENT_SECRET`, dev database passwords).

### Web build (public; Docker build arguments or the build machine)

| Variable | Value |
|---|---|
| `FIREBASE_API_KEY` | step 5.2 |
| `FIREBASE_PROJECT_ID` | step 5.2 |
| `FIREBASE_AUTH_DOMAIN` | optional (defaults to `<projectId>.firebaseapp.com`) |
| `API_URL` | **leave unset** (same origin). Only for a backend on another https origin. |

Socket.IO always uses the same origin as the API.

### Student mobile app (public; build machine)

`apps/student/config/production.json`, copied from
[production.example.json](../apps/student/config/production.example.json)
(step 15).

### Never commit

`.env`, `.env.*` (except `.env.example`), `deploy/serve.env`,
`apps/student/config/production.json`, service-account JSON, `*.pem`, `*.key`,
keystores and `key.properties`. All are gitignored, and `.dockerignore` keeps
them out of images.

## 7. Database migration

Migrations are forward-only SQL files in `backend/prisma/migrations`. Apply
them with `prisma migrate deploy`, which never resets or drops data. **Take a
backup first** once the database holds data (step 20).

```bash
# Docker Compose (the tools image has the Prisma CLI):
docker compose -f deploy/docker-compose.yml --profile tools run --rm migrate

# Without Docker (production environment loaded, from the repository root):
npm run prisma:migrate:deploy --workspace backend
```

Then, once:

```bash
# Catalogue: hostels, canteens, demo menus. Idempotent, never changes existing
# rows; allowed in production only with DEMO_MODE=true.
docker compose -f deploy/docker-compose.yml --profile tools run --rm migrate npm run db:seed --workspace backend
#   (without Docker: npm run db:seed --workspace backend)
```

Never run `prisma migrate dev`, `prisma migrate reset` or `prisma db push`
against production. The Prisma configuration refuses them with
`NODE_ENV=production` or on any database whose name does not end in `_dev` or
`_test`. The test suites only ever reset databases ending in `_test`.

## 8. Docker build

The image builds everything from source: the backend, and the three web apps
with `scripts/build-web.mjs` (the staff and admin apps with Vite, base
`/staff/` and `/admin/`; the student app with the official Flutter SDK,
checksum-verified, `flutter build web --release --base-href /
--no-web-resources-cdn --csp`). The public Firebase web values are build
arguments; the build refuses missing values, `demo-` projects and non-https
`API_URL`s.

```bash
export SERVE_DOMAIN=YOUR_DOMAIN
export FIREBASE_API_KEY='<web api key>' FIREBASE_PROJECT_ID='<project id>'
docker compose -f deploy/docker-compose.yml build                  # runtime image: serve:latest
docker compose -f deploy/docker-compose.yml --profile tools build  # tools image: serve-tools:latest
```

Without Docker, `FIREBASE_API_KEY=… FIREBASE_PROJECT_ID=… npm run build:web`
(Node.js 22 and Flutter 3.47+) builds the same apps into `dist/web`.

The runtime image is multi-stage: production dependencies only, runs as the
unprivileged `node` user, has a health check, and contains no env files or
keys (`.dockerignore`). It is about 1 GB, mostly `node_modules`. iOS and
Android builds are never part of it.

## 9. Starting the backend

```bash
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps        # serve: healthy, caddy: running
docker compose -f deploy/docker-compose.yml logs -f serve
```

The log shows `SERVE backend listening on port 5001` and a `DEMO_MODE`
warning. Caddy starts once the backend reports healthy.

Without Docker: `npm run build --workspace backend`, then run
`node backend/dist/server.js` with the environment from step 6, for example
under systemd:

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

Set `WEB_ROOT=/srv/serve/dist/web` in that file.

## 10. Reverse proxy

**Caddy** ([deploy/Caddyfile](../deploy/Caddyfile)) is the default. It
forwards everything (including Socket.IO WebSocket upgrades and
`X-Forwarded-*` headers) to the backend.

- With Docker Compose: nothing to edit. `SERVE_DOMAIN` (step 8) is the site
  address and the upstream is the `serve` container.
- With Caddy on the host: replace `YOUR_DOMAIN` in the Caddyfile with your
  domain (or set `SERVE_DOMAIN` in Caddy's environment); the default upstream
  is `127.0.0.1:5001`.

**nginx** ([deploy/nginx.conf](../deploy/nginx.conf)) is the alternative:
replace `YOUR_DOMAIN` everywhere. It passes WebSocket upgrades and keeps
connections open longer than Socket.IO's 25-second ping.

Either way the backend runs with `TRUST_PROXY=1`, so rate limits see real
client IPs.

## 11. HTTPS

- **Caddy** obtains and renews a Let's Encrypt certificate automatically once
  DNS points at the server and ports 80/443 are open. Certificates live in the
  `caddy_data` volume.
- **nginx:** `certbot certonly --nginx -d YOUR_DOMAIN`, then reload nginx.
- The backend sends HSTS with `includeSubDomains` (on an apex domain, browsers
  then use https for every subdomain) and `upgrade-insecure-requests`.
  Socket.IO uses `wss://` automatically on an https page.

## 12. Staff URL

`https://YOUR_DOMAIN/staff/` (`/staff` redirects). Staff create an account at
`/staff/create-account`, request access to a canteen, and wait for an admin's
approval; they see only their assigned canteen. Chrome or Edge can install it
as a desktop app (address bar → Install).

## 13. Admin URL

`https://YOUR_DOMAIN/admin/`. There is no public admin sign-up. Create the
first admin's user in Firebase console → Authentication → Add user, then link
it in PostgreSQL:

```bash
docker compose -f deploy/docker-compose.yml --profile tools run --rm migrate \
  npm run admin:create --workspace backend -- --email <admin email> --name "<name>" --confirm-production
#   (without Docker: npm run admin:create --workspace backend -- … --confirm-production)
```

The script never accepts passwords in production. `/staff/` and `/admin/`
share a browser sign-in (same origin); use separate browser profiles to be
signed in as staff and admin at once.

## 14. Student web URL

`https://YOUR_DOMAIN/` serves the Flutter web build of the student app, for
browser testing and demos. It can be added to a phone's home screen (Safari
→ Share → Add to Home Screen; Chrome → Install app). It gets live updates
while open; there are no push notifications.

## 15. Mobile API configuration

The native student app reads its configuration at build time. Copy the
template and fill in your values (all public):

```bash
cd apps/student
cp config/production.example.json config/production.json   # gitignored
```

| Key | Value |
|---|---|
| `API_URL` | `https://YOUR_DOMAIN` (REST under `/api`, Socket.IO at `/socket.io`) |
| `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID` | step 5.2 (see 5.4 for key restrictions) |
| `STAFF_DASHBOARD_URL`, `ADMIN_PORTAL_URL` | `https://YOUR_DOMAIN/staff/`, `https://YOUR_DOMAIN/admin/` |

Pass it with `--dart-define-from-file=config/production.json`. Release builds
refuse to start with the emulator, a `demo-` project, or a non-https or
localhost API. Without these values (plain `flutter run`) the app keeps its
development defaults: backend `:5001` and the Auth Emulator.

## 16. Android APK build

Needs the Android SDK (Android Studio). From `apps/student`:

```bash
flutter build apk --release --dart-define-from-file=config/production.json
# → build/app/outputs/flutter-apk/app-release.apk (gitignored)
```

The main manifest declares `INTERNET`; release builds allow https only.

**Signing.** As generated by Flutter, release builds are signed with the build
machine's **debug key**: fine for side-loading a demo, but an APK signed on
another machine cannot update it. For a lasting demo, create your own key:

```bash
keytool -genkey -v -keystore ~/serve-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias serve
```

then `apps/student/android/key.properties` (`storePassword`, `keyPassword`,
`keyAlias=serve`, `storeFile=…`) and the release `signingConfig` in
`android/app/build.gradle.kts` as
[Flutter's signing guide](https://docs.flutter.dev/deployment/android#sign-the-app)
describes. Keystores and `key.properties` are gitignored; back the keystore up.

**Distribution.** Share the file directly (a download link, Google Drive, or
Firebase App Distribution). Testers allow "Install unknown apps". Do not
commit APKs.

## 17. iPhone build

Needs a Mac with Xcode, the iPhone on a cable, and an Apple ID (free is
enough for your own devices). No App Store or TestFlight is involved.

1. Open `apps/student/ios/Runner.xcworkspace` in Xcode → **Runner** target →
   **Signing & Capabilities** → choose your **Team**. With a free Apple ID,
   change the bundle identifier if `app.serve.serveStudent` is taken (e.g.
   `app.serve.serveStudent.<yourname>`).
2. On the iPhone: **Settings → Privacy & Security → Developer Mode → On**
   (iOS 16+), and trust the computer.
3. From `apps/student`:

   ```bash
   flutter devices                      # note the iPhone's id
   flutter run --release -d <iphone-id> --dart-define-from-file=config/production.json
   ```

4. "Untrusted Developer": **Settings → General → VPN & Device Management** →
   trust your Apple ID.

Apps signed with a free Apple ID stop opening after 7 days; repeat step 3.
Before deployment the same app runs against your computer instead
([apps/student/README.md](../apps/student/README.md#your-own-iphone-mac--xcode)).

## 18. Production testing

Run both checks after every deployment.

**Read-only smoke test** (never signs in or writes):

```bash
npm run smoke:deploy -- https://YOUR_DOMAIN
```

It checks https, `/api/health` and `/api/health/db`, all three apps and a deep
link each, the `/staff` redirect, the manifests and icons, page security
headers, and a Socket.IO WebSocket upgrade (an unauthenticated socket must be
refused).

**Signed-in acceptance test** (needs accounts; writes a little data):

```bash
FIREBASE_API_KEY='<web api key>' \
ACCEPT_STUDENT_EMAIL=… ACCEPT_STUDENT_PASSWORD=… \
ACCEPT_STAFF_EMAIL=… ACCEPT_STAFF_PASSWORD=… \
ACCEPT_ADMIN_EMAIL=… ACCEPT_ADMIN_PASSWORD=… \
ACCEPT_APPLICANT_EMAIL=… ACCEPT_APPLICANT_PASSWORD=… \
npm run acceptance:deploy -- https://YOUR_DOMAIN
```

Accounts: a registered student, an approved staff member whose canteen is
accepting orders, an admin, and optionally a throwaway Firebase account for
the approval check (it ends deactivated). The test checks:

- unauthenticated requests and sockets are refused; a student cannot use
  staff or admin APIs; staff cannot use admin APIs;
- student: canteen → menu → cart quote → order → demo payment;
- staff receive the paid order live and move it PREPARING → READY →
  COLLECTED; the student sees each step live; tracking and history agree;
- staff mark a menu item unavailable and the student's menu updates live
  (the item is restored afterwards);
- admin: dashboard, staff, canteens, change requests; with an applicant, the
  admin approves an access request and the applicant is told live.

Then walk the demo by hand in the apps: a staff member signs up at
`/staff/create-account`, the admin approves them, a student registers on a
phone, orders, pays with the demo gateway and collects.

## 19. Rollback

Keep the previous release until the new one is verified.

- **Docker:** before building, tag the running image: `docker tag
  serve:latest serve:previous`. To roll back, `docker tag serve:previous
  serve:latest` and `docker compose -f deploy/docker-compose.yml up -d serve`.
- **Without Docker:** deploy each release into its own folder (e.g.
  `/srv/serve/releases/<date>`) with `/srv/serve/current` as a symlink; roll
  back by pointing the symlink at the previous folder and restarting the
  service.
- **Database:** migrations are forward-only. A rollback of the code is safe
  while the previous release still works with the newer schema (true for
  additive migrations). Undoing a migration means restoring the backup taken
  before it (step 20); never edit `_prisma_migrations` by hand.
- **Web apps** reload the new or old version on the next page load (pages are
  served `no-cache`). Students using the mobile app keep their installed
  build; an API change they depend on needs a new build.

## 20. Backup considerations

- **PostgreSQL holds everything that matters.** Managed databases: turn on
  daily backups with point-in-time recovery. Self-hosted: a scheduled dump
  copied off the server, for example:

  ```bash
  pg_dump --format=custom --file=serve-$(date +%F).dump "$DATABASE_URL_WITHOUT_SCHEMA_PARAM"
  pg_restore --clean --if-exists --dbname=<target> serve-YYYY-MM-DD.dump
  ```

  (`pg_dump` does not accept Prisma's `?schema=public`; drop that part.)
- **Test a restore** into a scratch database before you rely on backups.
- **Firebase Auth** holds the sign-in accounts (emails and passwords); it is
  managed by Google. `firebase auth:export` can export users if you need a
  copy.
- **Not worth backing up:** the Docker images and `dist/web` (rebuildable from
  the repository) and Caddy's certificates (re-issued automatically).
- Keep the env file and the service-account key in your secret store, not in
  backups that others can read.

## 21. Security checklist

- [ ] `deploy/serve.env` (or `/etc/serve/serve.env`) is readable by root only and not in Git
- [ ] New `PAYMENT_SECRET`; no development values anywhere in production
- [ ] Service-account JSON deleted after copying; key only in the secret store
- [ ] `CORS_ORIGINS=https://YOUR_DOMAIN` exactly; `TRUST_PROXY` = number of proxies
- [ ] `FIREBASE_AUTH_EMULATOR_HOST` unset; Email/Password the only sign-in provider
- [ ] Firebase web API key restricted to Identity Toolkit + Token Service (step 5.4)
- [ ] Database user owns only the SERVE database; remote databases use `sslmode=require`
- [ ] Ports 80/443 open; the backend port (5001) and PostgreSQL not exposed publicly
- [ ] Backups on, and one restore tested
- [ ] `npm run smoke:deploy` and `npm run acceptance:deploy` pass
- [ ] Everyone knows payments are simulated (`DEMO_MODE=true`)

Built in already: every request and socket verifies the Firebase token and
reads the role from PostgreSQL; staff see only their canteen; prices and
totals are computed on the server; strict input validation, body-size limits,
rate limits, Helmet headers and a page CSP; errors never expose internals;
logs redact tokens and secrets; startup refuses unsafe production settings.

---

## A. Routing and headers

| Request | Result |
|---|---|
| `/staff` or `/admin` | 301 to `/staff/` or `/admin/` (query kept) |
| `/staff/orders` (any path without a file extension) | the staff app's `index.html`, so a refresh on a deep link works. Same for `/admin/…` and the student app at `/…` |
| `/staff/assets/index-AbC123.js` | the file, `Cache-Control: public, max-age=31536000, immutable` (Vite hashes the names) |
| other files (`index.html`, `manifest.json`, Flutter's `main.dart.js`, icons) | `Cache-Control: no-cache`: revalidated on every load, so a redeploy is picked up on the next reload |
| a missing file with an extension | JSON 404, never an HTML page |
| `/api/unknown` | JSON 404 `ROUTE_NOT_FOUND` |
| dotfiles, `..` paths | never served |
| methods other than GET/HEAD outside `/api` | 404 |

Security headers on the pages (from `backend/src/web/web-apps.ts`):
`Content-Security-Policy` with scripts only from this origin
(`'wasm-unsafe-eval'` lets the Flutter renderer compile its WebAssembly),
network access to this origin and https/wss endpoints (Firebase Auth's REST API,
and menu images), `frame-ancestors 'none'`, `object-src 'none'`,
`upgrade-insecure-requests` in production; `X-Frame-Options: DENY`;
`Referrer-Policy: strict-origin-when-cross-origin`; HSTS. `/api` keeps its
stricter `default-src 'none'` policy. The web builds do not register Flutter's
service worker, which at the root scope could keep serving an old version.

## B. Demo payments and Razorpay

What `DEMO_MODE=true` does: allows `PAYMENT_MODE=mock` with
`NODE_ENV=production` (otherwise rejected at startup); mounts
`POST /api/payments/:orderId/mock-complete` (otherwise only outside
production); allows the non-destructive catalogue seed in production; logs a
warning at startup.

What it does **not** change: the other production checks; and verification:
`mock-complete` creates an HMAC-signed confirmation and runs it through the
same path as a real gateway (signature, captured amount against the
server-side order total, idempotent replay, only the owning student). The
client never sends prices or totals. It cannot be combined with
`PAYMENT_MODE=razorpay`.

Nothing presents a simulated payment as real: payments are stored with
provider `MOCK`, the student payment screen says **"Test payment — Demo mode:
no real money is charged"**, and the staff order details say "Test payment".

**Razorpay status:** an adapter exists as a stub
(`backend/src/modules/payments/razorpay.provider.ts`). Webhook and payment
signature verification are implemented; creating orders and fetching payments
are not, and return 503 rather than faking success. Before taking real money:

1. Finish the adapter's API calls.
2. In the student app, replace the mock step with Razorpay Checkout
   (initiate → Razorpay → `POST /api/payments/:id/verify`) and remove
   "Simulate a failed payment".
3. Environment: `PAYMENT_MODE=razorpay` with `RAZORPAY_KEY_ID`,
   `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; remove `DEMO_MODE` and
   `PAYMENT_SECRET`.
4. Razorpay dashboard webhook: `https://YOUR_DOMAIN/api/payments/webhooks/razorpay`.
5. Extend the page CSP in `backend/src/web/web-apps.ts` for Razorpay Checkout.
6. Test in Razorpay test mode end to end; add refund and reconciliation
   procedures, terms and a refund policy.

## C. Operations

- **Logs:** JSON lines on stdout (pino) with request ids and redacted
  secrets: `docker compose logs`, journald or the platform's log viewer.
- **Health checks:** `GET /api/health` (process: status, uptime) and
  `GET /api/health/db` (database round trip: status, latency). Neither exposes
  configuration or credentials, and neither is rate-limited; the image's
  Docker health check uses the first. Point an uptime monitor at
  `https://YOUR_DOMAIN/api/health/db`.
- **Graceful shutdown:** on SIGTERM the server stops accepting connections,
  closes sockets and the database pool, and exits within 10 s. Clients
  reconnect automatically and refetch.
- **Redeploys:** build the web apps, tag the current image (step 19), rebuild,
  back up, migrate, `up -d`. With one instance there is a brief disconnect.
- **Monitoring:** alerts on restarts and on error-level log lines.

## D. Test it locally first

```bash
npm run emulators                       # separate terminal
npm run test:e2e:single-domain          # builds the apps, serves them on one origin, runs the suite
```

To click around a local single-domain preview:

```bash
npm run build:web -- --local            # emulator + demo project; never deploy this build
WEB_ROOT="$PWD/dist/web" npm run dev:backend
npm run smoke:deploy -- http://localhost:5001
```

The acceptance test also runs against it with
`FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099` and the emulator demo
accounts. A production server refuses to serve a `--local` build.

## E. Configuration audit (what is local, what is production)

| Setting | Where | Class | Status |
|---|---|---|---|
| `localhost:5001` / `10.0.2.2` / emulator defaults | `apps/student/lib/config/app_config.dart` | local dev | kept for `flutter run`; release builds need `config/production.json` values |
| `VITE_API_URL=http://localhost:5001`, emulator URL | `apps/*/.env.example` → `.env.development.local` | local dev | kept; never read by builds |
| Vite dev ports 5173/5174, `base: '/'` in dev | `apps/*/vite.config.ts` | local dev | kept |
| Vite `base` for builds, router basename | `apps/*/vite.config.ts`, `apps/*/src/App.tsx` | production | `/staff/`, `/admin/` |
| `VITE_API_URL` in builds | `apps/*/src/config.ts`, `vite.config.ts` | production | optional (same origin); https only when set |
| Flutter `<base href>`, service worker | `apps/student/web/` | production | `/`; not registered |
| Static hosting, page CSP | `backend/src/web/web-apps.ts` | production | opt-in via `WEB_ROOT` |
| Mock payments in production | `backend/src/config/env.ts` | production | only with `DEMO_MODE=true` |
| Local `serve_dev` / `serve_test` database in production | `backend/src/config/env.ts` | production | rejected at startup |
| `demo-` Firebase project in builds | `apps/*/vite.config.ts`, `scripts/build-web.mjs`, `app_config.dart` | production | rejected |
| Destructive Prisma commands | `backend/prisma.config.ts` | safety | only on `*_dev` / `*_test` databases, never in production |
| Reverse proxy | `deploy/Caddyfile`, `deploy/nginx.conf` | production | `YOUR_DOMAIN` / `SERVE_DOMAIN` placeholder |
| Container stack | `Dockerfile`, `deploy/docker-compose.yml`, `.dockerignore` | production | builds all apps from source; app + Caddy; database external |
| Render | `render.yaml`, `backend/scripts/start-production.sh`, `backend/src/ops/release.ts` | production | one web service + PostgreSQL; migrations and release tasks at start; CORS defaults to `RENDER_EXTERNAL_URL` |
| `firebase.json` (127.0.0.1), `firebase.phone.json` (0.0.0.0) | repo root | local dev | kept |
| E2E ports 5101/5273/5274/5455, emulator | `e2e/tests/support/constants.mjs` | test | kept |

## F. Readiness

**Verified on the preparation machine:**

- All test suites, the end-to-end suites (browsers driving the Flutter web
  build and both React apps against the real backend, PostgreSQL and the Auth
  Emulator), production builds of the backend and all three web apps, and
  `npm audit` (0 vulnerabilities).
- The Docker image built from source with this Dockerfile (Flutter SDK
  checksum-verified, all three web apps built inside), then started like
  Render runs it (`start-production.sh`, `PORT=10000`, CORS from
  `RENDER_EXTERNAL_URL`) against a fresh PostgreSQL database: migrations
  applied, catalogue seeded once, `smoke:deploy` passing (apps, health,
  headers, WebSocket upgrade), graceful shutdown. Earlier: the compose stack
  behind Caddy over HTTPS. (The sandbox's TLS-intercepting proxy required
  trusting its certificate authority in the local base images; a normal build
  host needs nothing extra.)
- The acceptance test against a local single-domain server.

**Not verified yet:** a real deployment (Render or a server, a real Firebase
project and database), the Android APK build (the preparation machine cannot
download the Android SDK) and iOS builds from this machine (no Xcode). The
student app has run on a real iPhone in development (reported by the owner).

**The owner provides:** a Render account (or a domain and a server), a
Firebase project (web API key, project id, service account), the first
admin's email, and the accounts for the acceptance test. On a server, also
PostgreSQL 16 with backups and a new `PAYMENT_SECRET` (Render generates one).
