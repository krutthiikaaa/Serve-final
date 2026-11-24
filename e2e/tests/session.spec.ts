import { expect, test } from '@playwright/test';
import {
  adminActor,
  ApiActor,
  approvedStaff,
  canteenByName,
  passwordSignIn,
  staffSignUp,
  testSignIn,
  uniqueEmail,
  uniquePersonalEmail,
} from './support/api';
import { E2E } from './support/constants.mjs';
import { signIn } from './support/ui';

/**
 * Staff and admins sign in with email + password; the Better Auth session
 * (HttpOnly cookie on the SERVE backend) survives refresh and sign-out ends
 * it. Neither portal offers Google sign-in.
 */
const staffNav = (page: import('@playwright/test').Page) =>
  page.getByRole('complementary', { name: 'Staff dashboard navigation' });
const adminNav = (page: import('@playwright/test').Page) =>
  page.getByRole('complementary', { name: 'Admin portal navigation' });
const signInButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Sign in' });
const googleOption = (page: import('@playwright/test').Page) => page.getByText(/google/i);

test.describe('staff session', () => {
  test('opens the dashboard signed in, with no second login', async ({ page }) => {
    const { email, canteen } = await approvedStaff(
      'Session Staff',
      'Krishna & Godavari Night Canteen',
    );
    await signIn(page, E2E.staffUrl, email, E2E.password);
    await expect(staffNav(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();
    await expect(page.getByText(canteen.name).first()).toBeVisible();
    await expect(googleOption(page)).toHaveCount(0);
  });

  test('keeps the session across refresh', async ({ page }) => {
    const { email } = await approvedStaff('Persist Staff', 'Krishna & Godavari Night Canteen');
    await signIn(page, E2E.staffUrl, email, E2E.password);
    await expect(staffNav(page)).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(staffNav(page)).toBeVisible();
    await expect(googleOption(page)).toHaveCount(0);
  });

  test('logout ends the session and it is not silently restored', async ({ page }) => {
    const { email } = await approvedStaff('Logout Staff', 'Krishna & Godavari Night Canteen');
    await signIn(page, E2E.staffUrl, email, E2E.password);
    await expect(staffNav(page)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(signInButton(page)).toBeVisible();
    await page.reload();
    await expect(signInButton(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Orders' })).toHaveCount(0);
  });

  test('fits a smaller viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email } = await approvedStaff('Mobile Staff', 'Krishna & Godavari Night Canteen');
    await signIn(page, E2E.staffUrl, email, E2E.password);
    await expect(staffNav(page)).toBeVisible({ timeout: 20_000 });
  });

  test('a pending staff account waits for approval', async ({ page }) => {
    const email = uniquePersonalEmail('pending.staff');
    const canteen = await canteenByName('Vedavathi Night Canteen');
    await staffSignUp('Pending Staff', email, canteen.id);
    await signIn(page, E2E.staffUrl, email, E2E.password);
    await expect(page.getByText('Awaiting approval')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Orders' })).toHaveCount(0);
    // Protected staff APIs refuse the pending account as well.
    const pending = new ApiActor(await passwordSignIn(email));
    expect((await pending.call('GET', '/staff/orders')).status).toBe(403);
  });
});

test.describe('admin session', () => {
  test('opens the portal from the PostgreSQL admin role, across refresh, until logout', async ({
    page,
  }) => {
    await signIn(page, E2E.adminUrl, E2E.adminEmail, E2E.password);
    await expect(adminNav(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: /^Canteens/ })).toBeVisible();
    await page.reload();
    await expect(adminNav(page)).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(signInButton(page)).toBeVisible();
    await page.reload();
    await expect(signInButton(page)).toBeVisible();
  });
});

test.describe('one session across the SERVE web apps', () => {
  test('an admin signed in once is recognised (and turned away) by the staff dashboard', async ({
    page,
  }) => {
    await signIn(page, E2E.adminUrl, E2E.adminEmail, E2E.password);
    await expect(adminNav(page)).toBeVisible({ timeout: 20_000 });
    // Same session on the staff dashboard: the backend account decides (admin ≠ staff).
    await page.goto(E2E.staffUrl);
    await expect(
      page.getByText('You are signed in with a SERVE admin account.', { exact: false }),
    ).toBeVisible();
    await expect(googleOption(page)).toHaveCount(0);
    await page
      .getByRole('button', { name: /Sign out|Log out/ })
      .first()
      .click();
    await page.goto(E2E.adminUrl);
    await expect(signInButton(page)).toBeVisible();
  });

  test('old SSO links never grant access on their own', async ({ page }) => {
    await page.goto(`${E2E.staffUrl}/sso/callback?code=${'x'.repeat(43)}`);
    await expect(signInButton(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Orders' })).toHaveCount(0);
    const res = await page.request.post(`${E2E.apiUrl}/api/auth/sso/exchange`, {
      data: { code: 'x'.repeat(43), audience: 'STAFF' },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('role checks on the backend', () => {
  test('no session → 401 everywhere that needs one', async ({ request }) => {
    for (const path of ['/auth/me', '/staff/dashboard', '/admin/dashboard', '/orders']) {
      const res = await request.get(`${E2E.apiUrl}/api${path}`);
      expect(res.status(), path).toBe(401);
    }
  });

  test('staff cannot use admin APIs; admins cannot use staff APIs; students neither', async () => {
    const { staff, admin } = await approvedStaff('Role Staff', 'Krishna & Godavari Night Canteen');
    const staffToAdmin = await staff.call('GET', '/admin/dashboard');
    expect(staffToAdmin.status).toBe(403);
    const adminToStaff = await admin.call('GET', '/staff/dashboard');
    expect(adminToStaff.status).toBe(403);
    const student = new ApiActor(await testSignIn(uniqueEmail('role.student')));
    expect((await student.call('GET', '/staff/dashboard')).status).toBe(403);
    expect((await student.call('GET', '/admin/dashboard')).status).toBe(403);
    expect((await (await adminActor()).call('GET', '/admin/dashboard')).status).toBe(200);
  });
});
