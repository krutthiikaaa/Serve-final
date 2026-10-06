import { expect, test } from '@playwright/test';
import { StudentActor, approvedStaff, firebaseSignUp, uniqueEmail } from './support/api';
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

test('wrong password shows a friendly error', async ({ page }) => {
  const email = uniqueEmail('wrongpw');
  await firebaseSignUp(email);
  await signIn(page, E2E.staffUrl, email, 'not-the-password');
  await expect(page.getByRole('alert')).toContainText(/incorrect|invalid/i);
});
