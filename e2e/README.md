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

The Playwright version (1.56.1) matches the Chromium build preinstalled in the
development container, so no browser download is needed. Elsewhere, run
`npx playwright install chromium` once.
