import { expect, test, type Page } from '@playwright/test';
import { StudentActor, approvedStaff, firebaseSignUp, uniqueEmail } from './support/api';
import { E2E } from './support/constants.mjs';
import { expectLive, signIn } from './support/ui';

/**
 * Visual QA: captures every staff and admin screen (with live data) to
 * test-results/visual/ for review. Assertions only check that each screen
 * rendered its main content; the images are the review artefact.
 */
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `test-results/visual/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });

test('staff dashboard screens', async ({ page }) => {
  const { email } = await approvedStaff('Visual Staff', 'Krishna & Godavari Night Canteen');
  const student = await StudentActor.register('Visual Student');
  for (let i = 0; i < 3; i += 1) await student.orderAndPay(i + 1);

  await page.goto(E2E.staffUrl);
  await shot(page, 'staff-01-login');
  await page.goto(`${E2E.staffUrl}/create-account`);
  await shot(page, 'staff-02-create-account');

  await signIn(page, E2E.staffUrl, email, E2E.password);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expectLive(page);
  await expect(page.getByRole('row')).not.toHaveCount(0);
  await shot(page, 'staff-03-dashboard');

  await page.getByRole('link', { name: 'Orders' }).click();
  const first = page.getByRole('region', { name: 'New' }).getByRole('article').first();
  await first.getByRole('button', { name: 'Start preparing' }).click();
  await expect(page.getByRole('region', { name: 'Preparing' }).getByRole('article')).toHaveCount(1);
  await shot(page, 'staff-04-order-board');
  await page
    .getByRole('region', { name: 'Preparing' })
    .getByRole('article')
    .first()
    .getByRole('button', { name: /details/ })
    .click();
  await shot(page, 'staff-05-order-detail');
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Menu' }).click();
  await expect(page.getByRole('region', { name: 'Sandwiches' })).toBeVisible();
  await shot(page, 'staff-06-menu');
  await page.getByRole('button', { name: 'Add item' }).first().click();
  await shot(page, 'staff-07-add-item');
  await page.keyboard.press('Escape');

  await page
    .getByRole('complementary')
    .getByRole('link', { name: /^Notifications/ })
    .click();
  await shot(page, 'staff-08-notifications');
  await page.getByRole('link', { name: 'Account' }).click();
  await shot(page, 'staff-09-account');

  await page.setViewportSize({ width: 820, height: 1000 });
  await page.getByRole('link', { name: 'Orders' }).click();
  await shot(page, 'staff-10-orders-tablet');
});

test('staff onboarding states', async ({ page }) => {
  const email = uniqueEmail('visual.pending');
  await firebaseSignUp(email);
  await signIn(page, E2E.staffUrl, email, E2E.password);
  await expect(page.getByRole('heading', { name: 'Your staff details' })).toBeVisible();
  await shot(page, 'staff-11-complete-registration');
  await page.getByLabel('Full name').fill('Visual Pending');
  await page.getByLabel('Canteen you work at').selectOption({ label: 'Vedavathi Night Canteen' });
  await page.getByRole('button', { name: 'Request access' }).click();
  await expect(page.getByRole('heading', { name: 'Awaiting approval' })).toBeVisible();
  await shot(page, 'staff-12-awaiting-approval');
});

test('admin portal screens', async ({ page }) => {
  await signIn(page, E2E.adminUrl, E2E.adminEmail, E2E.password);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expectLive(page);
  await shot(page, 'admin-01-dashboard');

  await page.getByRole('link', { name: 'Canteens' }).click();
  await expect(page.getByRole('row')).not.toHaveCount(0);
  await shot(page, 'admin-02-canteens');
  await page.getByRole('link', { name: 'Krishna & Godavari Night Canteen' }).click();
  await expect(page.getByRole('heading', { name: 'Menu by category' })).toBeVisible();
  await shot(page, 'admin-03-canteen-detail');
  await page.getByRole('button', { name: 'Edit' }).click();
  await shot(page, 'admin-04-canteen-edit');
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: /^Change requests/ }).click();
  await expect(page.getByRole('heading', { name: 'Change requests' })).toBeVisible();
  await shot(page, 'admin-05-change-requests');
  const approve = page.getByRole('button', { name: /^Approve / }).first();
  if (await approve.isVisible()) {
    await approve.click();
    await shot(page, 'admin-06-approve-dialog');
    await page.keyboard.press('Escape');
  }

  await page.getByRole('link', { name: 'Staff' }).click();
  await expect(page.getByRole('row')).not.toHaveCount(0);
  await shot(page, 'admin-07-staff');
  await page
    .getByRole('button', { name: /^Manage / })
    .first()
    .click();
  await shot(page, 'admin-08-staff-detail');
  await page.keyboard.press('Escape');

  await page
    .getByRole('complementary')
    .getByRole('link', { name: /^Notifications/ })
    .click();
  await shot(page, 'admin-09-notifications');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await shot(page, 'admin-10-login');
});
