# SERVE end-to-end tests

Playwright tests that run the real system: the backend (on `serve_test`), the
Firebase Auth Emulator, the staff dashboard, the admin portal and, on request,
the Flutter student app's web build.

```bash
npm run emulators                    # separate terminal
npm run test:e2e                     # from the repository root
E2E_STUDENT_WEB=1 npm run test:e2e   # also builds + drives the Flutter web app (Flutter on PATH)
```

Prerequisites: PostgreSQL running and `backend/.env.test` present (see
[docs/development.md](../docs/development.md)).

Playwright starts everything itself (`playwright.config.ts`):

| Service | Port | Notes |
|---|---|---|
| Backend | 5101 | `scripts/start-backend.mjs`: resets `serve_test` (refuses other databases), migrates, seeds, creates the E2E admin |
| Staff dashboard | 5273 | Vite dev server pointed at the E2E backend |
| Admin portal | 5274 | same |
| Student web | 5455 | `scripts/serve-student-web.mjs` (only with `E2E_STUDENT_WEB=1`) |

Student actions that have no web UI in a given test go through the same REST
and Socket.IO calls the Flutter app makes (`tests/support/api.ts`); nothing
touches the database directly.

| Spec | Covers |
|---|---|
| `critical-flow` | staff onboarding (UI) → admin approval (UI) → paid order → live kitchen progress → pickup |
| `realtime-isolation` | events reach only the right canteen, student and admins; foreign REST access is 404 |
| `operations` | live menu changes in paise, canteen pause/resume, staff deactivation, cancellation with refund |
| `access-control` | staff, admin and student accounts in the wrong portal; wrong password |
| `visual` | screenshots of every staff and admin screen → `test-results/visual/` |
| `student-web` | the Flutter app: registration, menu, canteen-switch dialog, checkout, payment, live tracking |

### Single-domain suite

```bash
npm run test:e2e:single-domain                         # builds the apps first (Flutter on PATH)
E2E_SKIP_WEB_BUILD=1 npm run test:e2e:single-domain    # reuses dist/web-e2e
```

`playwright.single-domain.config.ts` builds the three apps for a local preview
(`npm run build:web -- --local`, output `dist/web-e2e`) and starts the E2E
backend on 5101 serving them (`scripts/start-single-domain.mjs`), so `/`,
`/staff/`, `/admin/`, `/api` and `/socket.io` share one origin.
`single-domain.spec.ts` covers every app and deep link with a refresh, the API
under `/api`, Chrome's installability verdict for all three apps, and the full
flow (Flutter student pays, staff work the order live over a WebSocket, the
student sees each step, the staff session is refused by the admin portal, the
admin sees the order). It fails on page errors, CSP violations and broken files.
`E2E_SINGLE_DOMAIN_URL=https://… E2E_IGNORE_HTTPS_ERRORS=1` points the browser at
a reverse proxy in front of the backend instead (the install check is skipped
for self-signed certificates).

The Playwright version (1.56.1) matches the Chromium build preinstalled in the
development container, so no browser download is needed. Elsewhere, run
`npx playwright install chromium` once.
