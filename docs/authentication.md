# Authentication (Better Auth, role-specific sign-in)

SERVE signs everyone in through **Better Auth**, running inside the existing
backend. The sign-in method depends on the role, and the backend enforces it:

| Role | Signs in with | Where | Accounts |
| --- | --- | --- | --- |
| Student | **Google only**, verified `@srmap.edu.in` | student app (Flutter: web, Android, iOS) | self-registration (name + hostel) after the first Google sign-in |
| Staff | **email + password only** (any address, e.g. Gmail/Outlook) | staff dashboard | self-registration; **PENDING** until an admin approves and assigns a canteen |
| Admin | **email + password only**, `@srmap.edu.in` | admin portal | created only by `npm run admin:create` |

Better Auth proves *who* you are; PostgreSQL (`Student` / `Staff` / `Admin`)
decides *what you may do*, exactly as before. Approval status, canteen
assignments, capabilities and admin rights are unchanged by sign-in.

> This replaces Firebase Authentication and the Google-only sign-in for every
> role. Some older pages in this folder still describe Firebase; this page is
> authoritative for sign-in.

## How it fits together

```
 Student app ──► POST /api/auth/sign-in/social (Google) → Google → GET /api/auth/callback/google
 Staff / admin ─► POST /api/auth/sign-in/email (email + password, scrypt)
                     │
                     ▼  session create hook (src/lib/auth.ts)
                     records AuthSession.authMethod = 'google' | 'password' and refuses:
                       google   → a staff/admin address (linked or not): STAFF_ADMIN_USE_PASSWORD
                                  a non-SRM or unverified address: EMAIL_DOMAIN_NOT_ALLOWED / EMAIL_NOT_VERIFIED
                       password → an identity without a Staff/Admin account, an admin outside
                                  @srmap.edu.in: INVALID_EMAIL_OR_PASSWORD (same as a wrong password)
                     └─ HttpOnly session cookie (web) / signed Bearer credential (native app)

 Every REST request and Socket.IO handshake
   → src/lib/session.ts      verifies the session with Better Auth (database read, no cache)
   → modules/auth/principal  loads Student / Staff / Admin from PostgreSQL
   → middleware/auth.ts      principalForSession: the session's method must match the role,
                             otherwise 401 SIGN_IN_METHOD_NOT_ALLOWED and the session is deleted
   → existing role guards    requireStudent, requireApprovedStaff + capability, requireAdmin …
```

| Piece | File |
| --- | --- |
| Better Auth configuration (Google, email + password, hooks, cookies, plugins) | `backend/src/lib/auth.ts` |
| Role ↔ method rule, password policy, address rules (pure, unit-tested) | `backend/src/modules/auth/sign-in-method.ts` |
| SRM email rule (students) | `backend/src/modules/auth/srm-email.ts` |
| Password identities (creation, hashing, set/reset) | `backend/src/modules/auth/password-accounts.ts` |
| Request → identity (cookie or Bearer) | `backend/src/lib/session.ts` |
| Identity → role account | `backend/src/modules/auth/principal.ts` |
| Per-request method check (REST; reused by Socket.IO) | `backend/src/middleware/auth.ts` |
| Staff sign-up, student registration, `/me` | `backend/src/modules/auth/auth.routes.ts`, `auth.service.ts` |
| Native (Android/iOS) Google hand-off | `backend/src/modules/auth/native-auth.routes.ts` |
| Mounting, endpoint allowlist, rate limits, CSRF | `backend/src/app.ts` |
| Web apps (staff, admin): password sign-in and change | `packages/web-shared/src/auth.tsx`, `auth-screens.tsx` |
| Flutter (web + native): Google sign-in | `apps/student/lib/services/auth/` |

## Students: Google, SRM accounts only

An identity may sign in with Google only when Google reports
`email_verified: true` and the address, trimmed and lower-cased, is exactly
`<local part>@srmap.edu.in` (`student@gmail.com`,
`student@srmap.edu.in.attacker.com`, `student@fake-srmap.edu.in` and
`student@mail.srmap.edu.in` are refused). Enforced in layers:

1. Google's `hd` (hosted domain) check — `GOOGLE_REQUIRE_HOSTED_DOMAIN`, on by
   default.
2. `user.validateUserInfo` — on account creation **and every returning
   sign-in**, with Google's *fresh* email and verification status.
3. Database hooks on user create/update and on every session creation.
4. A re-check on every request (`lib/session.ts`).

A new Google identity has **no role** (`/api/auth/me` → `registered: false`)
until the student registers (name + hostel). An existing, unlinked `Student`
row with the same verified address is linked at the first Google sign-in
(history kept). Google never claims a Staff or Admin row, and a staff or admin
address is refused (`STAFF_ADMIN_USE_PASSWORD`); the student app then says
that staff use the staff dashboard and admins the admin portal. Account
linking is disabled, so Google can never attach to a password identity with
the same address (Better Auth answers `account_not_linked`).

## Staff: email + password, approval required

* **Registration**: `POST /api/auth/staff/sign-up` (no session) with
  `{ name, email, password, requestedCanteenId? }`. In one transaction it
  creates the sign-in identity, the scrypt password hash and a **PENDING**
  `Staff` row, plus the canteen access request and the admin notification. It
  creates no session; the dashboard then signs in with the same email and
  password and shows **Awaiting approval**. The body cannot choose a role,
  status or canteen (422). An address already used by any account is refused
  (409 `EMAIL_IN_USE`). Rate-limited per client.
* **Addresses**: any well-formed address. SERVE sends no email, so the address
  is **not verified** and is stored with `emailVerified = false` — admin
  approval is the safeguard (the approving admin sees the address).
* **Until approved** the staff APIs answer 403 `STAFF_NOT_APPROVED` and the
  dashboard shows only the access status. After approval the existing
  canteen assignment and capability rules apply unchanged.

## Admins: provisioned, email + password

* `npm run admin:create --workspace backend -- --email name@srmap.edu.in --name "Name"`
  creates (or re-activates) the Admin row and its password identity; the
  password is typed at a hidden prompt (or the first line of stdin), never an
  argument. Running it again resets the password.
* There is no admin self-registration. Only `@srmap.edu.in` addresses; Google
  is refused for admin addresses.

## Passwords

* Hashed by Better Auth with **scrypt** (random salt per password); stored only
  in `AuthAccount.password` (`providerId = 'credential'`). Never logged
  (`password`, `newPassword`, `currentPassword` are redacted).
* 10–128 characters (backend, Better Auth and the web forms agree).
* **Change** (staff Account page, admin Settings page): `POST /api/auth/change-password`
  with the current password; only active staff/admins on a password session
  may call it (`PASSWORD_CHANGE_NOT_ALLOWED` otherwise). The web apps send
  `revokeOtherSessions: true`, so other devices are signed out.
* **Forgotten password**: there is no email reset. An operator runs
  `npm run account:set-password --workspace backend -- --role staff|admin --email <address>`,
  which sets a new password and ends every session of that account.
* Wrong password and unknown address get the same answer
  (`INVALID_EMAIL_OR_PASSWORD`, constant-time hashing either way).
* Rate limits: the per-client sensitive limit on `/sign-in/email`,
  `/change-password` and `/staff/sign-up`, on top of the global API limit and
  Better Auth's own limiter (production).

## Sessions

* Database-backed (`AuthSession`), **7 days**, renewed at most once a day while
  in use (`SESSION_EXPIRES_IN_SECONDS` / `SESSION_UPDATE_AGE_SECONDS` in
  `lib/auth.ts`); sign-out deletes the row. The cookie `serve.session_token`
  is HttpOnly, `SameSite=Lax` (`__Secure-` and `Secure` in production).
* Each session records how it was created: `authMethod` = `google` or
  `password`. Sessions created before role-specific sign-in have none; they
  were all Google sessions and stay valid **for students only**. A staff or
  admin session without a password method is refused and deleted on first use
  (`SIGN_IN_METHOD_NOT_ALLOWED`); the web apps then say "Staff and admins sign
  in with their email and password. Please sign in again."
* The credential is the **signed** value `<token>.<signature>` (the cookie's
  content, or the native app's Bearer token). A raw session token is refused
  everywhere, and Better Auth's `set-auth-token` header is never sent.
* Only these Better Auth endpoints are reachable under `/api/auth`
  (`EXPOSED_AUTH_PATHS`): `sign-in/social`, `callback/google`, `sign-in/email`,
  `change-password`, `get-session`, `sign-out`, `revoke-other-sessions`,
  `revoke-sessions` (and `test/sign-in` in tests). Everything else — including
  `sign-up/email`, password reset by email, profile and email changes, account
  (un)linking and session listing — answers 404.
* When a session ends while in use (expired, revoked, signed out elsewhere),
  every app notices on its next request or on the realtime `auth.expired`
  event and returns to sign-in with a reason.
* Cookie-authenticated writes must come from a trusted origin (CSRF check);
  CORS allows credentials only for `CORS_ORIGINS`.
* Sockets authenticate with the same session and the same role/method rule,
  and are disconnected within a minute of sign-out, and at expiry.

## Existing accounts (moving to role-specific sign-in)

The migration `20261124090000_role_sign_in_methods` is additive (a nullable
`AuthSession.authMethod` column, and the `AuthUser` email check relaxed from
`@srmap.edu.in`-only to any well-formed lower-case address). No account is
changed. After deploying:

* **Students**: nothing to do; existing sessions keep working.
* **Staff and admins**: their old Google sessions stop working. Give each a
  password with `account:set-password` (or `admin:create` for admins). The
  account keeps its id, role, approval status, canteen, capabilities and
  history; a previously linked Google identity is reused, so nothing is
  re-linked.

## Native app (Android / iOS)

The app opens the system browser (not a WebView) at
`/api/native-auth/start?code_challenge=…`, the student signs in with Google,
and the browser returns to `app.serve.student://auth?code=…`. The app
exchanges the one-time code (2 minutes, single use) together with its PKCE
verifier at `POST /api/native-auth/exchange` for the signed session
credential, kept in the Keychain / Android Keystore and sent as
`Authorization: Bearer`. A refused staff/admin address comes back as
`?error=STAFF_ADMIN_USE_PASSWORD`. Android registers the scheme in
`AndroidManifest.xml`; iOS needs no setup.

Google only redirects to the URL registered on the OAuth client, so a phone
must reach the backend at that URL (`BETTER_AUTH_URL`), e.g. an https tunnel
or the deployed domain — not `localhost`.

## Configuration (backend/.env only)

| Variable | |
| --- | --- |
| `BETTER_AUTH_URL` | Public backend URL. Google redirect URI = `<it>/api/auth/callback/google` |
| `BETTER_AUTH_SECRET` | 32+ random characters (required outside tests) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Auth Platform → Clients → Web client (student sign-in) |
| `GOOGLE_REQUIRE_HOSTED_DOMAIN` | `true` (default) / `false` |
| `AUTH_TEST_SIGN_IN` | Tests only; refused unless `NODE_ENV=test` |

No frontend needs any auth configuration or secret. Step-by-step local setup,
including the Google OAuth client: [development.md](development.md).

## Testing without Google

Real Google sign-in cannot run in automated tests. The backend tests run the
**real** Better Auth Google flow with only Google's token endpoint replaced
in-process (`tests/integration/google-oauth.test.ts`). Student identities in
other tests come from `POST /api/auth/test/sign-in`, which exists only when
`NODE_ENV=test` **and** `AUTH_TEST_SIGN_IN=true`, applies the same SRM gate and
records a Google session. Staff and admins use the real email + password
sign-in everywhere (`tests/integration/role-sign-in.test.ts`,
`e2e/tests/auth.spec.ts`).
