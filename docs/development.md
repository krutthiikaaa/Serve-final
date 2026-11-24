# SERVE — Local development guide

How to run the whole SERVE stack on your own computer: PostgreSQL, the
backend, the staff dashboard, the admin portal and the Flutter student app.
Commands are given for **Windows PowerShell** first (VS Code's integrated
terminal works), with macOS/Linux equivalents where they differ. Run them from
the repository root unless a step says otherwise.

## How the pieces connect

```
 Student app (Flutter web)  http://localhost:5555 ─┐   Google sign-in (students only)
 Staff dashboard (React)    http://localhost:5173 ─┼─► Backend http://localhost:5001 ──► PostgreSQL :5432
 Admin portal (React)       http://localhost:5174 ─┘   /api (REST) · /socket.io (realtime)   serve_dev
                                                       /api/auth (Better Auth sessions)
```

* There is **one backend** (Express + Socket.IO + Better Auth + Prisma). Every
  app calls it at `http://localhost:5001`: the React apps through
  `VITE_API_URL`, the student app through its development default (or
  `--dart-define=API_URL=…`).
* Sign-in is role-specific ([authentication.md](authentication.md)):
  * **Students**: Google only, verified `@srmap.edu.in` accounts.
  * **Staff**: email + password (any address, e.g. Gmail or Outlook).
    Self-registered accounts stay **PENDING** until an admin approves them.
  * **Admins**: email + password, `@srmap.edu.in` addresses, created only with
    `npm run admin:create`.
* The session is an HttpOnly cookie set by the backend on `localhost`. Open
  every app at `http://localhost:…`, **not** `127.0.0.1`, so the browser sends
  it.

## 1. Required software

| Software | Version | Notes |
| --- | --- | --- |
| Node.js | **22.12 or newer** (`.nvmrc` says 22) | includes npm 10 |
| PostgreSQL | **16** | server on `localhost:5432`; the Windows installer includes `psql` |
| Git | any recent | |
| Flutter SDK | **3.47 or newer** (Dart 3.13) | student app; `flutter` on `PATH` (or set `FLUTTER_BIN`) |
| Google Chrome | current | Flutter web runs in Chrome; the E2E tests use it on Windows |
| VS Code | optional | Flutter and ESLint extensions recommended |

Check:

```powershell
node --version        # v22.12.0 or newer
npm --version
psql --version        # if not found, use the full path shown in section 3
flutter --version     # Flutter 3.47.x or newer
```

If PowerShell refuses to run `npm` ("running scripts is disabled"), allow
local scripts once for your user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## 2. Get the code and install dependencies

```powershell
git clone https://github.com/pranathigit11/Serve-final.git
cd Serve-final
git checkout claude/charming-dirac-bmyxw9
npm ci
npm run prisma:generate --workspace backend
```

`npm ci` installs exactly what `package-lock.json` pins. `prisma:generate`
creates the Prisma client (Prisma 7 does not generate it automatically).

## 3. PostgreSQL: role and databases

Create a role `serve` and two databases: `serve_dev` (your data) and
`serve_test` (wiped and rebuilt by every automated test run). Choose your own
password for `serve`.

**Windows (PowerShell)** — adjust `16` if your PostgreSQL version differs;
`psql` asks for the `postgres` superuser password you chose when installing:

```powershell
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
& $psql -U postgres -c "CREATE ROLE serve LOGIN CREATEDB PASSWORD 'choose-a-db-password';"
& $psql -U postgres -c "CREATE DATABASE serve_dev OWNER serve;"
& $psql -U postgres -c "CREATE DATABASE serve_test OWNER serve;"
```

**macOS / Linux** — the repository script does the same, idempotently:

```bash
SERVE_DB_PASSWORD='choose-a-db-password' npm run db:setup:local
# Linux distro packages: add PSQL_ADMIN="sudo -u postgres psql -d postgres"
```

If your password contains `@`, `:`, `/`, `?` or `#`, percent-encode it in the
`DATABASE_URL` below (e.g. `@` → `%40`).

## 4. Secrets for your own machine

Generate two random values and keep them only in `backend/.env` (never commit
them, never share them):

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)                              # → BETTER_AUTH_SECRET
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
-join ($bytes | ForEach-Object { $_.ToString('x2') })         # → PAYMENT_SECRET
```

macOS / Linux: `openssl rand -base64 32` and `openssl rand -hex 32`.

## 5. Google OAuth (student sign-in) — you must configure this yourself

Only **students** use Google. Staff and admins work without it, so you can do
this step later; until then the backend logs a warning and student sign-in is
unavailable.

1. Open the [Google Cloud console](https://console.cloud.google.com/) with an
   account that may create projects, and create (or pick) a project.
2. **Google Auth Platform → Branding**: set the app name (e.g. "SERVE") and a
   support email.
3. **Audience**: *Internal* if the project belongs to the `srmap.edu.in` Google
   Workspace organisation (only SRM accounts can sign in). Otherwise
   *External*, publishing status *Testing*, and add your `@srmap.edu.in`
   accounts as **test users**.
4. **Clients → Create client → Web application**:
   * **Authorized JavaScript origins**: `http://localhost:5555`
   * **Authorized redirect URIs**: `http://localhost:5001/api/auth/callback/google`
     — exactly `<BETTER_AUTH_URL>/api/auth/callback/google`; a mismatch gives
     Google's `redirect_uri_mismatch` error.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and the
   **Client secret** into `backend/.env` (`GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`). The secret never goes into a frontend.

SERVE accepts only Google accounts whose email Google has verified and that end
exactly in `@srmap.edu.in`; with `GOOGLE_REQUIRE_HOSTED_DOMAIN=true` (default)
Google's `hd` claim must also be `srmap.edu.in`.

## 6. Environment files (all gitignored)

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item backend\.env.example backend\.env.test
Copy-Item apps\staff\.env.example apps\staff\.env.development.local
Copy-Item apps\admin\.env.example apps\admin\.env.development.local
```

(macOS / Linux: `cp` with forward slashes.)

Edit **`backend/.env`** (development) — the template explains every variable;
these are the ones to fill in:

```dotenv
NODE_ENV=development
PORT=5001
DATABASE_URL=postgresql://serve:choose-a-db-password@localhost:5432/serve_dev?schema=public
CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:5555
BETTER_AUTH_URL=http://localhost:5001
BETTER_AUTH_SECRET=<the base64 value from section 4>
GOOGLE_CLIENT_ID=<from section 5>
GOOGLE_CLIENT_SECRET=<from section 5>
STUDENT_APP_URL=http://localhost:5555
STAFF_DASHBOARD_URL=http://localhost:5173
ADMIN_PORTAL_URL=http://localhost:5174
PAYMENT_MODE=mock
PAYMENT_SECRET=<the hex value from section 4>
```

Edit **`backend/.env.test`** (automated tests only):

```dotenv
NODE_ENV=test
PORT=5101
DATABASE_URL=postgresql://serve:choose-a-db-password@localhost:5432/serve_test?schema=public
CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:5555
PAYMENT_MODE=mock
PAYMENT_SECRET=<a different 64-character hex value>
LOG_LEVEL=silent
RATE_LIMIT_MAX=100000
SENSITIVE_RATE_LIMIT_MAX=100000
```

Leave `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
**empty** in `.env.test`: tests never contact Google.

The two `apps/*/.env.development.local` files need no changes: they contain
`VITE_API_URL=http://localhost:5001`. The student app needs no file at all.

## 7. Database schema, seed data and the first admin

```powershell
npm run prisma:migrate:deploy --workspace backend    # applies every migration to serve_dev
npm run db:seed --workspace backend                  # canteens, hostels, menus (idempotent)
npm run admin:create --workspace backend -- --email your.name@srmap.edu.in --name "Your Name"
```

`prisma:migrate:deploy` applies all migrations in `backend/prisma/migrations`,
including `20261124090000_role_sign_in_methods` (additive: it records each
session's sign-in method and lets staff use non-SRM addresses). It only
applies migrations; it never resets data.

`admin:create` asks for the admin's password twice without showing it (at
least 10 characters). Run it again for the same email to reset that admin's
password. To give an **existing** staff or admin account a password (for
example one created before password sign-in existed):

```powershell
npm run account:set-password --workspace backend -- --role staff --email someone@gmail.com
npm run account:set-password --workspace backend -- --role admin --email someone@srmap.edu.in
```

Optional demo accounts (development only):

```powershell
$env:DEV_ADMIN_EMAIL = "your.name@srmap.edu.in"
$env:DEV_STAFF_NIGHT_EMAIL = "kg.night@example.com"
$env:DEV_STAFF_PENDING_EMAIL = "pending.staff@example.com"
$env:DEV_STUDENT_EMAIL = "your.student@srmap.edu.in"
npm run db:seed:dev-users --workspace backend         # asks once for the staff/admin password
```

## 8. Start everything (four terminals)

Open four PowerShell terminals in the repository root (in VS Code: Terminal →
New Terminal, four times):

```powershell
npm run dev:backend      # terminal 1 — API + Socket.IO on http://localhost:5001
```

```powershell
npm run dev:staff        # terminal 2 — staff dashboard on http://localhost:5173
```

```powershell
npm run dev:admin        # terminal 3 — admin portal on http://localhost:5174
```

```powershell
npm run dev:student      # terminal 4 — student app in Chrome on http://localhost:5555
```

Check the backend:

```powershell
Invoke-RestMethod http://localhost:5001/api/health      # status: ok
Invoke-RestMethod http://localhost:5001/api/health/db   # database: ok
```

Start the backend first; the apps show a connection error until it is up. The
student app's development defaults point at `http://localhost:5001`, so
`dev:student` needs no `--dart-define` flags. On an Android emulator use
`npm run dev:student -- -d emulator-5554` (the app reaches your computer as
`10.0.2.2`); Google sign-in on an emulator or phone additionally needs the
backend on a public https URL registered with Google (see
[authentication.md](authentication.md#native-app-android--ios)).

## 9. Try it: sign-in walkthrough

**Admin** (after `admin:create`):

1. Open <http://localhost:5174>. The page shows **Email** and **Password**
   fields and a **Sign in** button — there is no Google option.
2. Sign in with the address and password from `admin:create`. A wrong password
   shows "Incorrect email or password."
3. **Settings → Password** changes the password (current password required;
   other devices are signed out).

**Staff**:

1. Open <http://localhost:5173> → **Request access**.
2. Fill in full name, any email you use (Gmail/Outlook are fine), a password
   (10+ characters) twice, and the canteen you work at → **Request access**.
3. You are signed in and see **Awaiting approval**. Orders, Menu and Cashier
   are not available, even by typing their URLs; the staff APIs answer 403.
4. In the admin portal: **Change requests → Approve** (the admin is notified
   live). The staff screen unlocks by itself.
5. Sign out and back in with the same email and password: the dashboard opens
   with the assigned canteen. **Account → Password** changes the password.

**Student**:

1. Open <http://localhost:5555> → **Student** → **Continue with Google**.
2. Choose an `@srmap.edu.in` account. Any other account (e.g. Gmail) is
   refused with "This account is not eligible to use SERVE…".
3. First sign-in: enter your name and hostel. Then browse, order and track.
4. Using a staff or admin address here is refused with "Google sign-in is for
   students only. Staff sign in on the SERVE staff dashboard and admins on the
   admin portal…".

## 10. Automated tests

| What | Command | Needs |
| --- | --- | --- |
| Backend unit + integration | `npm test --workspace backend` | PostgreSQL, `backend/.env.test` (recreates `serve_test`) |
| Shared web code | `npm test --workspace @serve/web-shared` | — |
| Staff dashboard | `npm test --workspace @serve/staff` | — |
| Admin portal | `npm test --workspace @serve/admin` | — |
| Student app | `cd apps/student; flutter analyze; flutter test` | Flutter |
| End-to-end (Playwright) | `npm run test:e2e` | PostgreSQL, `backend/.env.test`, Chrome |

The backend suite runs the **real** Better Auth instance against `serve_test`;
the Google redirect flow is tested with only Google's token endpoint replaced
in-process, and other tests use a test-only sign-in endpoint that exists only
with `NODE_ENV=test`. The global setup refuses any database whose name does not
end in `_test`.

The E2E suite starts its **own** backend on port 5101 against `serve_test`
(reset, migrated and seeded on every run; it provisions its own admin with a
test-only password), plus the staff and admin apps on 5273 / 5274. On Windows
it uses your installed Chrome. Do not run it at the same time as the backend
test suite (both recreate `serve_test`). `$env:E2E_STUDENT_WEB = "1"` also
builds and tests the Flutter web app.

Optional: the student app's service layer against a running test backend
(staff need an approved account with the KITCHEN and CASHIER capabilities):

```powershell
cd apps/student
$env:SERVE_INTEGRATION = "1"; $env:API_URL = "http://localhost:5101"
$env:SERVE_STAFF_EMAIL = "<approved staff email>"; $env:SERVE_STAFF_PASSWORD = "<its password>"
flutter test --tags integration
```

Other checks (all workspaces):

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run build
```

## 11. Ports

| Service | Port |
| --- | --- |
| Backend (API, Socket.IO, Better Auth) | 5001 (5000 is refused: macOS AirPlay) |
| PostgreSQL | 5432 |
| Staff dashboard / admin portal | 5173 / 5174 |
| Student app (Flutter web, development) | 5555 |
| E2E stack: backend / staff / admin / student web | 5101 / 5273 / 5274 / 5455 |

## 12. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Invalid environment configuration: …` at startup | The message names each bad variable (never its value); compare with `backend/.env.example`. |
| `BETTER_AUTH_SECRET is required` | Generate one (section 4) and put it in `backend/.env`. |
| Log: "Google sign-in is unavailable" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are empty. Staff and admin sign-in still work. |
| Google shows `redirect_uri_mismatch` | The client's redirect URI must be exactly `http://localhost:5001/api/auth/callback/google`. |
| Student: "This account is not eligible…" | Use an `@srmap.edu.in` Google account (Gmail is refused by design). |
| Student: "Google sign-in is for students only…" | That address belongs to a staff/admin account; use the web portal with email + password. |
| Staff/admin: "Incorrect email or password." | Wrong address or password, or the account has no password yet (`account:set-password`). |
| Staff/admin: "Staff and admins sign in with their email and password…" | An old Google session was refused; sign in with the password. |
| Signed in on one app but not another | Open every app at `localhost`, not `127.0.0.1`. |
| `/api/health/db` fails | PostgreSQL is not running, or `DATABASE_URL` is wrong. |
| `Port 5001 is already in use` | Another backend is running; stop it (`Get-Process node` / Task Manager). |
| Web app: "Missing VITE_API_URL" | Copy `apps/<app>/.env.example` to `apps/<app>/.env.development.local`. |
| Flutter web: requests blocked by CORS | Keep `http://localhost:5555` in `CORS_ORIGINS` and restart the backend. |
| `Cannot read properties of undefined` from Prisma | Run `npm run prisma:generate --workspace backend`. |
| `npm run db:setup:local` fails on Windows | It is a bash script; use the `psql` commands in section 3. |
| `npm run start --workspace backend` fails on Windows | It uses Unix syntax. Run `npm run build`, then `$env:NODE_ENV = "production"; node backend/dist/server.js` (needs production variables). |
| `prisma migrate dev` shows drift | Never resolve drift on real data with `migrate reset`. Inspect it with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (from `backend/`). |

## 13. Conventions

- TypeScript strict, ESM, module-per-feature under `backend/src/modules/`.
- Only `src/config/env.ts` reads `process.env`.
- Services hold business rules; routers validate input with zod and call services.
- Multi-record changes run in `prisma.$transaction`. Realtime events go into an `Outbox` and are published only after commit.
- Throw `AppError` subclasses. The central handler shapes every error response.
- Never trust client-supplied prices, totals, roles, ids or canteen assignments.
- Schema changes: `npx prisma migrate dev --create-only --name <change>` (from `backend/`), review the SQL, then apply.
- Git: feature branch, logical commits, owner-reviewed PRs. No force-push and no direct commits to `main`.
