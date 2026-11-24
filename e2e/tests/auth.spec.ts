import { expect, test, type Page } from '@playwright/test';
import {
  ApiActor,
  adminActor,
  approvedStaff,
  passwordSignIn,
  uniquePersonalEmail,
} from './support/api';
import { E2E } from './support/constants.mjs';
import { signIn } from './support/ui';

/**
 * Role-specific sign-in, end to end in the real browser apps:
 *   staff and admins → email + password (no Google anywhere on the portals);
 *   students → Google only (access-control.spec.ts covers the refusals).
 */
const signInButton = (page: Page) => page.getByRole('button', { name: 'Sign in' });

async function fillSignIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await signInButton(page).click();
}

test.describe('staff', () => {
  test('register → pending → admin approval → password sign-in with the assigned canteen', async ({
    page,
  }) => {
    const email = uniquePersonalEmail('lifecycle.staff');
    const canteenName = 'Ganga A & Ganga B Night Canteen';

    await test.step('registers with a personal address and lands on the pending screen', async () => {
      await page.goto(`${E2E.staffUrl}/create-account`);
      await page.getByLabel('Full name').fill('Lifecycle Staff');
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(E2E.password);
      await page.getByLabel('Confirm password').fill(E2E.password);
      await page
        .getByLabel('Canteen you work at')
        .selectOption({ label: `${canteenName} (Night)` });
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.getByRole('heading', { name: 'Awaiting approval' })).toBeVisible();
      await expect(page.getByText('Your account is awaiting staff approval.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Orders' })).toHaveCount(0);
      // Protected pages stay closed while pending, even by URL.
      await page.goto(`${E2E.staffUrl}/orders`);
      await expect(page.getByRole('heading', { name: 'Awaiting approval' })).toBeVisible();
    });

    await test.step('the same address cannot register twice', async () => {
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.goto(`${E2E.staffUrl}/create-account`);
      await page.getByLabel('Full name').fill('Duplicate');
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(E2E.password);
      await page.getByLabel('Confirm password').fill(E2E.password);
      await page
        .getByLabel('Canteen you work at')
        .selectOption({ label: `${canteenName} (Night)` });
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.getByRole('alert')).toContainText('already registered');
    });

    await test.step('an admin approves the request', async () => {
      const admin = await adminActor();
      const pending = await admin.call<{ data: { id: string; staff: { email: string } }[] }>(
        'GET',
        '/admin/change-requests?status=PENDING&limit=100',
      );
      const request = pending.body.data.find((r) => r.staff.email === email);
      expect(request, 'pending change request').toBeTruthy();
      await admin.data('POST', `/admin/change-requests/${request!.id}/approve`, {
        replaceExisting: true,
      });
    });

    await test.step('a wrong password is refused; the right one opens the dashboard', async () => {
      await page.goto(E2E.staffUrl);
      await fillSignIn(page, email, 'not-the-right-password');
      await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.');
      await fillSignIn(page, email, E2E.password);
      const nav = page.getByRole('complementary', { name: 'Staff dashboard navigation' });
      await expect(nav).toBeVisible({ timeout: 20_000 });
      await expect(nav.getByText(canteenName)).toBeVisible();
      // Approval granted the default capabilities on the assigned canteen.
      await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();
    });
  });

  test('changes the password on the Account page; the old one stops working', async ({ page }) => {
    const { email } = await approvedStaff('Password Staff', 'Krishna & Godavari Night Canteen');
    const newPassword = 'a-new-staff-password-1';
    await signIn(page, E2E.staffUrl, email, E2E.password);
    await page.getByRole('link', { name: 'Account' }).click();
    await page.getByLabel('Current password').fill(E2E.password);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(/^Password changed\./)).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await fillSignIn(page, email, E2E.password);
    await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.');
    await fillSignIn(page, email, newPassword);
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible({ timeout: 20_000 });
  });

  test('a wrong current password is explained', async ({ page }) => {
    const { email } = await approvedStaff('Careful Staff', 'Krishna & Godavari Night Canteen');
    await signIn(page, E2E.staffUrl, email, E2E.password);
    await page.getByRole('link', { name: 'Account' }).click();
    await page.getByLabel('Current password').fill('definitely-wrong-1');
    await page.getByLabel('New password', { exact: true }).fill('another-password-1');
    await page.getByLabel('Confirm new password').fill('another-password-1');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert')).toHaveText('Your current password is incorrect.');
    // Still signed in.
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
  });
});

test.describe('admin', () => {
  test('signs in with a password; no Google option; a wrong password is refused', async ({
    page,
  }) => {
    await page.goto(E2E.adminUrl);
    await expect(signInButton(page)).toBeVisible();
    await expect(page.getByText(/google/i)).toHaveCount(0);
    await fillSignIn(page, E2E.adminEmail, 'not-the-admin-password');
    await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.');
    await fillSignIn(page, E2E.adminEmail, E2E.password);
    await expect(page.getByRole('complementary', { name: 'Admin portal navigation' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('an address that was never provisioned cannot sign in', async ({ page }) => {
    await page.goto(E2E.adminUrl);
    await fillSignIn(page, 'never.provisioned@srmap.edu.in', E2E.password);
    await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.');
  });

  test('changes the password on the Settings page (and back)', async ({ page }) => {
    const temporary = 'a-temporary-admin-password';
    await signIn(page, E2E.adminUrl, E2E.adminEmail, E2E.password);
    const change = async (from: string, to: string) => {
      await page.getByRole('link', { name: 'Settings' }).click();
      await page.getByLabel('Current password').fill(from);
      await page.getByLabel('New password', { exact: true }).fill(to);
      await page.getByLabel('Confirm new password').fill(to);
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(page.getByText(/^Password changed\./)).toBeVisible();
    };
    await change(E2E.password, temporary);
    // Other sessions of the admin were signed out; a fresh sign-in needs the new password.
    await expect(passwordSignIn(E2E.adminEmail)).rejects.toThrow(/401/);
    const fresh = new ApiActor(await passwordSignIn(E2E.adminEmail, temporary));
    expect((await fresh.call('GET', '/admin/dashboard')).status).toBe(200);
    // Restore the shared E2E password for the rest of the suite.
    await change(temporary, E2E.password);
    await passwordSignIn(E2E.adminEmail);
  });
});

test('staff and admins cannot sign in to each other’s portal or use each other’s APIs', async ({
  page,
}) => {
  const { email, staff, admin } = await approvedStaff(
    'Boundary Staff',
    'Krishna & Godavari Night Canteen',
  );
  expect((await staff.call('GET', '/admin/dashboard')).status).toBe(403);
  expect((await admin.call('GET', '/staff/dashboard')).status).toBe(403);
  await signIn(page, E2E.adminUrl, email, E2E.password);
  await expect(page.getByRole('heading', { name: 'Not an admin account' })).toBeVisible();
});
