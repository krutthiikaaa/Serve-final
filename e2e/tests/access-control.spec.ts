import { expect, test } from '@playwright/test';
import { StudentActor, approvedStaff } from './support/api';
import { E2E } from './support/constants.mjs';
import { signIn } from './support/ui';

test('a staff account cannot use the admin portal', async ({ page }) => {
  const { email } = await approvedStaff('Curious Staff', 'Krishna & Godavari Night Canteen');
  await signIn(page, E2E.adminUrl, email, E2E.password);
  await expect(page.getByRole('heading', { name: 'Not an admin account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Canteens' })).toHaveCount(0);
  // Navigating directly does not help: routing is decided by /api/auth/me.
  await page.goto(`${E2E.adminUrl}/staff`);
  await expect(page.getByRole('heading', { name: 'Not an admin account' })).toBeVisible();
});

test('an admin account is turned away from the staff dashboard', async ({ page }) => {
  await signIn(page, E2E.staffUrl, E2E.adminEmail, E2E.password);
  await expect(
    page.getByText('You are signed in with a SERVE admin account.', { exact: false }),
  ).toBeVisible();
});

test('a student account is turned away from both web apps', async ({ page }) => {
  const student = await StudentActor.register('Web Curious Student');
  const email = student.me.email;
  await signIn(page, E2E.staffUrl, email, E2E.password);
  await expect(
    page.getByText('Use the SERVE mobile app to order.', { exact: false }),
  ).toBeVisible();
});

test('only verified @srmap.edu.in accounts can sign in', async ({ request }) => {
  for (const email of [
    'someone@gmail.com',
    'someone@srmap.edu.in.attacker.com',
    'someone@fake-srmap.edu.in',
  ]) {
    const res = await request.post(`${E2E.apiUrl}/api/auth/test/sign-in`, { data: { email } });
    expect(res.status(), email).toBe(403);
    expect((await res.json()).code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  }
  const unverified = await request.post(`${E2E.apiUrl}/api/auth/test/sign-in`, {
    data: { email: 'unverified.e2e@srmap.edu.in', emailVerified: false },
  });
  expect((await unverified.json()).code).toBe('EMAIL_NOT_VERIFIED');
});

test('a Google account refused by SERVE is explained on the sign-in screen', async ({ page }) => {
  // Where Better Auth sends the browser back after refusing, e.g., a Gmail account.
  await page.goto(`${E2E.staffUrl}/?error=EMAIL_DOMAIN_NOT_ALLOWED`);
  await expect(page.getByRole('alert')).toContainText('@srmap.edu.in');
  await expect(page).toHaveURL(`${E2E.staffUrl}/`);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('Continue with Google sends the browser to Google with PKCE and the SRM domain', async ({
  page,
}) => {
  // Intercepted: no request reaches Google.
  let google: URL | null = null;
  await page.route('https://accounts.google.com/**', async (route) => {
    google = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Google</p>' });
  });
  await page.goto(E2E.adminUrl);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect.poll(() => google?.hostname).toBe('accounts.google.com');
  expect(google!.searchParams.get('redirect_uri')).toBe(`${E2E.apiUrl}/api/auth/callback/google`);
  expect(google!.searchParams.get('hd')).toBe('srmap.edu.in');
  expect(google!.searchParams.get('code_challenge_method')).toBe('S256');
  expect(google!.searchParams.get('state')).toBeTruthy();
  expect(google!.searchParams.get('prompt')).toBe('select_account');
});
