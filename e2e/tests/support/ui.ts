import { expect, type Page } from '@playwright/test';
import { E2E } from './constants.mjs';

/**
 * Signs the browser in as `email` and opens `url`. Google cannot run in
 * automated tests, so the session comes from the backend's test-only sign-in
 * (same SRM rule, same HttpOnly session cookie as a Google sign-in), set in
 * this page's browser context. `_password` is unused (kept for call sites).
 */
export async function signIn(page: Page, url: string, email: string, _password?: string) {
  const res = await page.request.post(`${E2E.apiUrl}/api/auth/test/sign-in`, {
    data: { email },
    headers: { Origin: new URL(url).origin },
  });
  expect(res.ok(), `test sign-in for ${email}: ${res.status()} ${await res.text()}`).toBe(true);
  await page.goto(url);
}

/** The connection banner disappears once the authenticated socket is live. */
export async function expectLive(page: Page) {
  await expect(page.getByText(/Connecting to live updates|Live updates paused/)).toHaveCount(0, {
    timeout: 15_000,
  });
}
