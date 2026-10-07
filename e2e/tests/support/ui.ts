import { expect, type Page } from '@playwright/test';

export async function signIn(page: Page, url: string, email: string, password: string) {
  await page.goto(url);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The connection banner disappears once the authenticated socket is live. */
export async function expectLive(page: Page) {
  await expect(page.getByText(/Connecting to live updates|Live updates paused/)).toHaveCount(0, {
    timeout: 15_000,
  });
}
