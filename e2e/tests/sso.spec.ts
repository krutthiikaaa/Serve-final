import { expect, test, type Page } from '@playwright/test';
import { adminActor, ApiActor, approvedStaff, firebaseSignUp, uniqueEmail } from './support/api';
import { E2E } from './support/constants.mjs';

function codeFrom(redirectUrl: string): string {
  const code = new URL(redirectUrl).searchParams.get('code');
  if (!code) throw new Error(`missing code in ${redirectUrl}`);
  return code;
}

async function exchange(code: string, audience: 'STAFF' | 'ADMIN') {
  return fetch(`${E2E.apiUrl}/api/auth/sso/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, audience }),
  });
}

async function completeStaffSso(page: Page, staff: ApiActor) {
  const { redirectUrl } = await staff.initiateSso('STAFF');
  expect(redirectUrl).toContain(`${E2E.staffUrl}/sso/callback?code=`);
  await page.goto(redirectUrl);
  await expect(page.getByRole('complementary', { name: 'Staff dashboard navigation' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
}

async function completeAdminSso(page: Page, admin: ApiActor) {
  const { redirectUrl } = await admin.initiateSso('ADMIN');
  expect(redirectUrl).toContain(`${E2E.adminUrl}/sso/callback?code=`);
  await page.goto(redirectUrl);
  await expect(page.getByRole('complementary', { name: 'Admin portal navigation' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
}

test.describe('Staff SSO', () => {
  test('opens the dashboard already authenticated, with no second login', async ({ page }) => {
    const { staff, canteen } = await approvedStaff(
      'SSO Kitchen Staff',
      'Krishna & Godavari Night Canteen',
    );
    await completeStaffSso(page, staff);
    await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();
    await expect(page.getByText(canteen.name).first()).toBeVisible();
  });

  test('keeps the Firebase session across refresh', async ({ page }) => {
    const { staff } = await approvedStaff('SSO Persist Staff', 'Krishna & Godavari Night Canteen');
    await completeStaffSso(page, staff);
    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Staff dashboard navigation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  });

  test('logout clears the session and does not silently restore it', async ({ page }) => {
    const { staff } = await approvedStaff('SSO Logout Staff', 'Krishna & Godavari Night Canteen');
    await completeStaffSso(page, staff);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Orders' })).toHaveCount(0);
  });

  test('fits a smaller viewport after SSO', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { staff } = await approvedStaff('SSO Mobile Staff', 'Krishna & Godavari Night Canteen');
    await completeStaffSso(page, staff);
    await expect(page.getByRole('complementary', { name: 'Staff dashboard navigation' })).toBeVisible();
  });
});

test.describe('Admin SSO', () => {
  test('opens the portal already authenticated from the PostgreSQL admin role', async ({
    page,
  }) => {
    const admin = await adminActor();
    await completeAdminSso(page, admin);
    await expect(page.getByRole('link', { name: /^Canteens/ })).toBeVisible();
  });

  test('keeps the admin session across refresh and requires a new login after logout', async ({
    page,
  }) => {
    const admin = await adminActor();
    await completeAdminSso(page, admin);
    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Admin portal navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('SSO callback failures', () => {
  test('an incomplete callback does not grant access', async ({ page }) => {
    await page.goto(`${E2E.staffUrl}/sso/callback`);
    await expect(page.getByText(/sign-in link is missing or incomplete/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to SERVE' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Orders' })).toHaveCount(0);
  });

  test('a staff code cannot be exchanged on the admin portal', async ({ page }) => {
    const { staff } = await approvedStaff('SSO Cross Staff', 'Krishna & Godavari Night Canteen');
    const { redirectUrl } = await staff.initiateSso('STAFF');
    const code = codeFrom(redirectUrl);
    await page.goto(`${E2E.adminUrl}/sso/callback?code=${encodeURIComponent(code)}`);
    await expect(page.getByRole('button', { name: 'Return to SERVE' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Admin portal navigation' })).toHaveCount(0);
  });

  test('a reused code is rejected', async () => {
    const { staff } = await approvedStaff('SSO Reuse Staff', 'Krishna & Godavari Night Canteen');
    const { redirectUrl } = await staff.initiateSso('STAFF');
    const code = codeFrom(redirectUrl);
    expect((await exchange(code, 'STAFF')).status).toBe(200);
    const again = await exchange(code, 'STAFF');
    expect(again.status).toBe(401);
    expect((await again.json()).error.code).toBe('SSO_CODE_INVALID');
  });

  test('only one concurrent exchange can consume a code', async () => {
    const { staff } = await approvedStaff('SSO Race Staff', 'Krishna & Godavari Night Canteen');
    const { redirectUrl } = await staff.initiateSso('STAFF');
    const code = codeFrom(redirectUrl);
    const [a, b] = await Promise.all([exchange(code, 'STAFF'), exchange(code, 'STAFF')]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  test('an expired code cannot be exchanged', async () => {
    test.setTimeout(30_000);
    const { staff } = await approvedStaff('SSO Expiry Staff', 'Krishna & Godavari Night Canteen');
    const { redirectUrl } = await staff.initiateSso('STAFF');
    await new Promise((r) => setTimeout(r, 16_000));
    const res = await exchange(codeFrom(redirectUrl), 'STAFF');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('SSO_CODE_INVALID');
  });
});

test.describe('SSO initiation authorization', () => {
  test('unapproved staff cannot start a staff handoff', async () => {
    const email = uniqueEmail('sso.pending');
    const pending = new ApiActor(await firebaseSignUp(email));
    await pending.data('POST', '/auth/staff/register', { name: 'Pending SSO', email });
    const res = await pending.call('POST', '/auth/sso/initiate', { audience: 'STAFF' });
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('STAFF_NOT_APPROVED');
  });

  test('staff cannot initiate an admin handoff', async () => {
    const { staff } = await approvedStaff('SSO Role Staff', 'Krishna & Godavari Night Canteen');
    const res = await staff.call('POST', '/auth/sso/initiate', { audience: 'ADMIN' });
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('FORBIDDEN_ROLE');
  });

  test('admin cannot initiate a staff handoff', async () => {
    const { admin } = await approvedStaff('SSO Role Admin', 'Krishna & Godavari Night Canteen');
    const res = await admin.call('POST', '/auth/sso/initiate', { audience: 'STAFF' });
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('FORBIDDEN_ROLE');
  });

  test('initiate rejects a missing Firebase session', async () => {
    const res = await fetch(`${E2E.apiUrl}/api/auth/sso/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience: 'STAFF' }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_REQUIRED');
  });
});
