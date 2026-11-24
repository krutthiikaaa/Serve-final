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
  // A student's Google session (test stand-in) reaches the staff dashboard…
  await signIn(page, E2E.staffUrl, email);
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

test('Google sign-in (students) redirects to Google with PKCE and the SRM domain', async ({
  request,
}) => {
  // What the student app does; no request reaches Google.
  const res = await request.post(`${E2E.apiUrl}/api/auth/sign-in/social`, {
    data: {
      provider: 'google',
      callbackURL: `${E2E.studentUrl}/`,
      errorCallbackURL: `${E2E.studentUrl}/`,
    },
    headers: { Origin: E2E.studentUrl },
  });
  expect(res.ok()).toBe(true);
  const google = new URL(((await res.json()) as { url: string }).url);
  expect(google.hostname).toBe('accounts.google.com');
  expect(google.searchParams.get('redirect_uri')).toBe(`${E2E.apiUrl}/api/auth/callback/google`);
  expect(google.searchParams.get('hd')).toBe('srmap.edu.in');
  expect(google.searchParams.get('code_challenge_method')).toBe('S256');
  expect(google.searchParams.get('state')).toBeTruthy();
  expect(google.searchParams.get('prompt')).toBe('select_account');
});

test('staff and admin addresses are refused by Google sign-in', async ({ request }) => {
  const { email } = await approvedStaff('No Google Staff', 'Krishna & Godavari Night Canteen');
  for (const address of [email, E2E.adminEmail]) {
    const res = await request.post(`${E2E.apiUrl}/api/auth/test/sign-in`, {
      data: { email: address },
    });
    expect(res.ok(), address).toBe(false);
  }
  const admin = await request.post(`${E2E.apiUrl}/api/auth/test/sign-in`, {
    data: { email: E2E.adminEmail },
  });
  expect((await admin.json()).code).toBe('STAFF_ADMIN_USE_PASSWORD');
});

test('students cannot use the password sign-in', async ({ request }) => {
  const student = await StudentActor.register('Password Curious Student');
  const res = await request.post(`${E2E.apiUrl}/api/auth/sign-in/email`, {
    data: { email: student.me.email, password: E2E.password },
    headers: { Origin: E2E.staffUrl },
  });
  expect(res.status()).toBe(401);
  expect((await res.json()).code).toBe('INVALID_EMAIL_OR_PASSWORD');
});
