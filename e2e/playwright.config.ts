import { defineConfig, devices } from '@playwright/test';
import { E2E } from './tests/support/constants.mjs';

/**
 * End-to-end suite: real backend + PostgreSQL (`serve_test`) + Firebase Auth
 * Emulator + the staff and admin apps. Prerequisites: PostgreSQL running,
 * backend/.env.test present, and the emulator (`npm run emulators`).
 * The suite shares one database, so it runs serially.
 */
/** The Flutter web build is slow, so it runs only on request (E2E_STUDENT_WEB=1). */
const studentWeb = process.env.E2E_STUDENT_WEB === '1';

const frontendEnv = {
  VITE_API_URL: E2E.apiUrl,
  VITE_FIREBASE_API_KEY: E2E.firebaseApiKey,
  VITE_FIREBASE_PROJECT_ID: E2E.firebaseProjectId,
  VITE_FIREBASE_AUTH_EMULATOR_URL: E2E.emulatorUrl,
};

export default defineConfig({
  testDir: './tests',
  // Runs against built apps on one origin: playwright.single-domain.config.ts
  testIgnore: 'single-domain.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1360, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/start-backend.mjs',
      url: `${E2E.apiUrl}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'npm run dev --workspace @serve/staff -- --port 5273',
      url: E2E.staffUrl,
      env: frontendEnv,
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev --workspace @serve/admin -- --port 5274',
      url: E2E.adminUrl,
      env: frontendEnv,
      timeout: 60_000,
      reuseExistingServer: false,
    },
    ...(studentWeb
      ? [
          {
            command: 'node scripts/serve-student-web.mjs',
            url: E2E.studentUrl,
            timeout: 600_000,
            reuseExistingServer: false,
          },
        ]
      : []),
  ],
});
