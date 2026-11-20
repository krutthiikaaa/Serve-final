# Authentication (Better Auth + Google, SRM accounts only)

SERVE signs everyone in — students, canteen staff and admins — with **Google**,
through **Better Auth** running inside the existing backend. Only **verified
`@srmap.edu.in`** Google accounts are accepted. Better Auth proves *who* you
are; PostgreSQL (`Student` / `Staff` / `Admin`) decides *what you may do*,
exactly as before.

> This replaces Firebase Authentication (email/password) and the student →
> dashboard SSO code handoff. Some older docs in this folder still describe
> Firebase; this page is authoritative for sign-in.

## How it fits together

```
 Browser / app ──► GET/POST /api/auth/*  (Better Auth, mounted in Express)
                     sign-in/social → Google → /api/auth/callback/google
                     ├─ SRM gate (user.validateUserInfo + database hooks)
                     └─ session row (AuthSession) + HttpOnly cookie
 Any API request ──► session cookie (web) or Authorization: Bearer (native)
                     → lib/session.ts verifies with Better Auth
                     → modules/auth/principal.ts loads Student/Staff/Admin
                     → existing role guards (requireStudent, requireAdmin …)
```

| Piece | File |
| --- | --- |
| Better Auth configuration (Google, SRM gate, hooks, cookies, plugins) | `backend/src/lib/auth.ts` |
| SRM email rule (pure, unit-tested) | `backend/src/modules/auth/srm-email.ts` |
| Request → identity (cookie or Bearer) | `backend/src/lib/session.ts` |
| Identity → role account, safe linking | `backend/src/modules/auth/principal.ts` |
| Native (Android/iOS) sign-in hand-off | `backend/src/modules/auth/native-auth.routes.ts` |
| Mounting, CORS (credentials), CSRF origin check | `backend/src/app.ts` |
| Web apps (staff, admin) | `packages/web-shared/src/auth.tsx` |
| Flutter (web + native) | `apps/student/lib/services/auth/` |

## The SRM rule

An identity may sign in only when Google reports `email_verified: true` and the
address, trimmed and lower-cased, is exactly `<local part>@srmap.edu.in`
(`student@gmail.com`, `student@srmap.edu.in.attacker.com`,
`student@fake-srmap.edu.in` and `student@mail.srmap.edu.in` are refused).
It is enforced in layers:

1. Google's `hd` (hosted domain) check — `GOOGLE_REQUIRE_HOSTED_DOMAIN`, on by
   default (SRM Google Workspace accounts carry `hd: srmap.edu.in`).
2. `user.validateUserInfo` — runs on account creation **and on every returning
   sign-in** with Google's *fresh* email and verification status.
3. Database hooks on user create/update and on every session creation.
4. A PostgreSQL `CHECK` on `AuthUser.email` and a re-check on every request.

The address always comes from Google, never from a request body. Account
linking between sign-in methods is disabled.

## Roles and existing accounts

* A new Google identity has **no role** (`/api/auth/me` → `registered: false`).
  Students register (name + hostel); staff request access (pending until an
  admin approves, as before). Nobody can choose a role.
* **Admins are never created by sign-in.** Provision one by email:
  `npm run admin:create --workspace backend -- --email name@srmap.edu.in --name "Name"`.
  It becomes active at that person's first Google sign-in.
* **Existing accounts** (created before Better Auth) are linked at their
  owner's first Google sign-in by **exact, verified email**. Role, staff
  approval, canteen and capabilities stay unchanged. If an email matches more
  than one account, or an account already linked to another identity, sign-in
  gets `409 ACCOUNT_LINK_CONFLICT` and nothing is linked — an admin resolves it.
  A database trigger guarantees one identity ↔ at most one role account.
* Accounts whose email is not `@srmap.edu.in` cannot sign in any more.

## Sessions

* Database-backed (`AuthSession`), 7 days, renewed while in use; sign-out
  deletes the row. The session cookie `serve.session_token` is HttpOnly,
  `SameSite=Lax` (`__Secure-` and `Secure` in production).
* The credential is the **signed** value `<token>.<signature>` (the cookie's
  content, or the native app's Bearer token). A raw session token — as stored
  in the database or returned in a `get-session` body — is refused everywhere,
  and no response carries the credential in a header page scripts can read
  (Better Auth's `set-auth-token` header is removed).
* Only these Better Auth endpoints are reachable under `/api/auth`
  (`EXPOSED_AUTH_PATHS` in `backend/src/lib/auth.ts`): `sign-in/social`,
  `callback/google`, `get-session`, `sign-out`, `revoke-other-sessions`,
  `revoke-sessions` (and `test/sign-in` in tests). Everything else Better Auth
  ships — profile and email changes, account (un)linking, provider access
  tokens, session listing, password flows — answers 404.
* When a session ends while in use (expired, revoked, signed out elsewhere),
  every app notices on its next request or on the realtime `auth.expired`
  event and returns to sign-in with "Your session expired. Please sign in
  again." The student app also clears the cart, recently viewed items,
  canteen selection and notifications; favourites are kept per account on the
  device, so the next student never sees them.
* One sign-in covers the student web app, staff dashboard and admin portal
  (same backend site; one origin in the single-domain deployment).
* Cookie-authenticated writes must come from a trusted origin (CSRF check);
  CORS allows credentials only for `CORS_ORIGINS`.
* Sockets authenticate with the same session and are disconnected within a
  minute of sign-out, and at expiry.

## Native app (Android / iOS)

The app opens the system browser (not a WebView) at
`/api/native-auth/start?code_challenge=…`, the user signs in with Google, and
the browser returns to `app.serve.student://auth?code=…`. The app exchanges
the one-time code (2 minutes, single use) together with its PKCE verifier at
`POST /api/native-auth/exchange` for the signed session credential, kept in
the Keychain / Android Keystore and sent as `Authorization: Bearer`. Closing
the browser is reported as a cancelled sign-in; any other browser failure as
"Authentication failed". Android registers the
scheme in `AndroidManifest.xml`; iOS needs no setup.

Google only redirects to the URL registered on the OAuth client, so a phone
must reach the backend at that URL (`BETTER_AUTH_URL`), e.g. an https tunnel
or the deployed domain — not `localhost`.

## Configuration (backend/.env only)

| Variable | |
| --- | --- |
| `BETTER_AUTH_URL` | Public backend URL. Google redirect URI = `<it>/api/auth/callback/google` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (required outside tests) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Auth Platform → Clients → Web client |
| `GOOGLE_REQUIRE_HOSTED_DOMAIN` | `true` (default) / `false` |
| `AUTH_TEST_SIGN_IN` | Tests only; refused unless `NODE_ENV=test` |

No frontend needs any auth configuration or secret.

## Testing without Google

Real Google sign-in cannot run in automated tests. The backend tests run the
**real** Better Auth Google flow with only Google's token endpoint replaced
in-process (`tests/integration/google-oauth.test.ts`). E2E and integration
tests use `POST /api/auth/test/sign-in`, which exists only when
`NODE_ENV=test` **and** `AUTH_TEST_SIGN_IN=true` and applies the same SRM gate.
