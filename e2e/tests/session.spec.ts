import { expect, test } from '@playwright/test';
import { adminActor, ApiActor, approvedStaff, testSignIn, uniqueEmail } from './support/api';
import { E2E } from './support/constants.mjs';
import { signIn } from './support/ui';

/**
 * One Better Auth session (HttpOnly cookie on the SERVE backend) serves the
 * staff dashboard, the admin portal and the student web app. It replaced the
 * SSO code handoff: signing in once is enough, refresh keeps it, sign-out
 * ends it everywhere.
 */
const staffNav = (page: import('@playwright/test').Page) =>
  page.getByRole('complementary', { name: 'Staff dashboard navigation' });
const adminNav = (page: import('@playwright/test').Page) =>
  page.getByRole('complementary', { name: 'Admin portal navigation' });
const googleButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Continue with Google' });

test.describe('staff session', () => {
  test('opens the dashboard signed in, with no second login', async ({ page }) => {
    const { email, canteen } = await approvedStaff(
      'Session Staff',
      'Krishna & Godavari Night Canteen',
    );
    await signIn(page, E2E.staffUrl, email);
    await expect(staffNav(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();
    await expect(page.getByText(canteen.name).first()).toBeVisible();
    await expect(googleButton(page)).toHaveCount(0);
  });

  test('keeps the session across refresh', async ({ page }) => {
    const { email } = await approvedStaff('Persist Staff', 'Krishna & Godavari Night Canteen');
    await signIn(page, E2E.staffUrl, email);
    await expect(staffNav(page)).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(staffNav(page)).toBeVisible();
    await expect(googleButton(page)).toHaveCount(0);
  });

  test('logout ends the session and it is not silently restored', async ({ page }) => {
    const { email } = await approvedStaff('Logout Staff', 'Krishna & Godavari Night Canteen');
    await signIn(page, E2E.staffUrl, email);
    await expect(staffNav(page)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(googleButton(page)).toBeVisible();
    await page.reload();
    await expect(googleButton(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Orders' })).toHaveCount(0);
  });

  test('fits a smaller viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { email } = await approvedStaff('Mobile Staff', 'Krishna & Godavari Night Canteen');
    await signIn(page, E2E.staffUrl, email);
    await expect(staffNav(page)).toBeVisible({ timeout: 20_000 });
  });

  test('a pending staff account waits for approval', async ({ page }) => {
    const email = uniqueEmail('pending.staff');
    const pending = new ApiActor(await testSignIn(email));
    const canteens = await pending.data<{ id: string; name: string }[]>('GET', '/canteens');
    const canteen = canteens.find((c) => c.name === 'Vedavathi Night Canteen')!;
    await pending.data('POST', '/auth/staff/register', {
      name: 'Pending Staff',
      requestedCanteenId: canteen.id,
    });
    await signIn(page, E2E.staffUrl, email);
    await expect(page.getByText('Awaiting approval')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Orders' })).toHaveCount(0);
  });
});

test.describe('admin session', () => {
  test('opens the portal from the PostgreSQL admin role, across refresh, until logout', async ({
    page,
  }) => {
    await signIn(page, E2E.adminUrl, E2E.adminEmail);
    await expect(adminNav(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: /^Canteens/ })).toBeVisible();
    await page.reload();
    await expect(adminNav(page)).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(googleButton(page)).toBeVisible();
    await page.reload();
    await expect(googleButton(page)).toBeVisible();
  });
});

test.describe('one session for every SERVE app', () => {
  test('signing in once covers both portals; signing out of one signs out of both', async ({
    page,
  }) => {
    await signIn(page, E2E.adminUrl, E2E.adminEmail);
    await expect(adminNav(page)).toBeVisible({ timeout: 20_000 });
    // Same session on the staff dashboard: the backend account decides (admin ≠ staff).
    await page.goto(E2E.staffUrl);
    await expect(
      page.getByText('You are signed in with a SERVE admin account.', { exact: false }),
    ).toBeVisible();
    await expect(googleButton(page)).toHaveCount(0);
    await page
      .getByRole('button', { name: /Sign out|Log out/ })
      .first()
      .click();
    await page.goto(E2E.adminUrl);
    await expect(googleButton(page)).toBeVisible();
  });

  test('old SSO links never grant access on their own', async ({ page }) => {
    await page.goto(`${E2E.staffUrl}/sso/callback?code=${'x'.repeat(43)}`);
    await expect(googleButton(page)).toBeVisible();
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
