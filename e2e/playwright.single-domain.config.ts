import { defineConfig, devices } from '@playwright/test';
import { E2E } from './tests/support/constants.mjs';

/**
 * Single-domain deployment check: the built student, staff and admin apps,
 * the API and Socket.IO all served by one backend process on one origin
 * (E2E.apiUrl). Same prerequisites as the main suite, plus Flutter (the web
 * apps are built first; E2E_SKIP_WEB_BUILD=1 reuses the last build).
 * E2E_SINGLE_DOMAIN_URL points the browser at a proxy in front of that
 * backend instead (see tests/single-domain.spec.ts).
 */
export default defineConfig({
  testDir: './tests',
  testMatch: 'single-domain.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-single-domain' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1360, height: 860 },
    locale: 'en-IN',
    // Only for a local proxy with a self-signed certificate (E2E_SINGLE_DOMAIN_URL).
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === '1',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/start-single-domain.mjs',
    url: `${E2E.apiUrl}/api/health`,
    timeout: 900_000,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
