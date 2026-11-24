import { expect, type Page } from '@playwright/test';
import { E2E } from './constants.mjs';

/**
 * Signs the browser in as `email` and opens `url`.
 * - With a password (staff, admins): the real sign-in form of that app.
 * - Without (students): Google cannot run in automated tests, so the session
 *   comes from the backend's test-only sign-in (same SRM rule, a Google
 *   session and the same HttpOnly cookie as a real Google sign-in).
 */
export async function signIn(page: Page, url: string, email: string, password?: string) {
  if (password !== undefined) {
    await page.goto(url);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0, {
      timeout: 20_000,
    });
    return;
  }
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
