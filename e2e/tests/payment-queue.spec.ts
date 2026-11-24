import { expect, test, type Page } from '@playwright/test';
import { StudentActor, approvedStaff } from './support/api';
import { backdatePaymentDeadline } from './support/db';
import { E2E } from './support/constants.mjs';
import { expectLive, signIn } from './support/ui';

/**
 * UPI claim queue, end to end: real backend + PostgreSQL + the staff
 * dashboard. Students are API actors (the same calls the student app makes).
 *  1. claims reach the cashier live, oldest claim first; a confirmed order
 *     goes to the kitchen and can be prepared;
 *  2. an abandoned order (placed, never claimed) expires by itself and leaves
 *     the queue live; the student sees why.
 */
// A canteen no other spec orders from, so this spec's orders never change
// what other specs see (kitchen board counts, popular items).
const CANTEEN = 'Ganga A & Ganga B Night Canteen';
const HOSTEL = 'Ganga A';

async function cashierPage(page: Page) {
  const { email, staff, canteen, admin } = await approvedStaff('Queue Cashier', CANTEEN);
  const me = await staff.data<{ id: string }>('GET', '/auth/me');
  await admin.data('PUT', `/admin/staff/${me.id}/assignments`, {
    primaryCanteenId: canteen.id,
    assignments: [{ canteenId: canteen.id, capabilities: ['KITCHEN', 'MENU', 'PAUSE', 'CASHIER'] }],
  });
  // Staff sign in with email + password (the backend refuses Google sessions for staff).
  await signIn(page, `${E2E.staffUrl}/cashier`, email, E2E.password);
  await expectLive(page);
  return { staff, canteen };
}

test('claims reach the cashier live, oldest first; confirmed orders go to the kitchen', async ({
  page,
}) => {
  const { staff, canteen } = await cashierPage(page);
  const asha = await StudentActor.register('Queue Asha', HOSTEL);
  const ravi = await StudentActor.register('Queue Ravi', HOSTEL);
  const first = await asha.orderUnpaid();
  const second = await ravi.orderUnpaid();

  const claimed = page.getByRole('table', { name: 'claimed payments' });
  const unclaimed = page.getByRole('table', { name: 'unclaimed orders' });
  // Placed, not claimed: under "Not claimed yet", with its expiry.
  await expect(unclaimed.getByRole('row').filter({ hasText: first.orderNumber })).toContainText(
    /Expires in \d+ min/,
  );

  // Ravi claims first, then Asha: claim order decides, live, no refresh.
  expect((await ravi.claim(second.id, 'RAVIUTR1')).status).toBe(200);
  expect((await asha.claim(first.id, 'ASHAUTR1')).status).toBe(200);
  const rows = claimed.getByRole('row').filter({ hasText: /SV\d+/ });
  await expect(rows.filter({ hasText: second.orderNumber })).toBeVisible();
  await expect(rows.filter({ hasText: first.orderNumber })).toBeVisible();
  const order = await rows.allTextContents();
  const pos = (n: string) => order.findIndex((text) => text.includes(n));
  expect(pos(second.orderNumber)).toBeLessThan(pos(first.orderNumber));
  await expect(rows.filter({ hasText: second.orderNumber })).toContainText('RAVIUTR1');
  await expect(unclaimed.getByText(first.orderNumber)).toHaveCount(0);

  // A claim is not a payment: the order is still PLACED until the cashier acts.
  expect((await ravi.order(second.id)).status).toBe('PLACED');

  // The cashier confirms Ravi's (DEMO mode: a simulated confirmation).
  await rows
    .filter({ hasText: second.orderNumber })
    .getByRole('button', { name: 'Simulate' })
    .click();
  await page.getByRole('button', { name: 'Simulate payment received' }).click();
  await expect(rows.filter({ hasText: second.orderNumber })).toHaveCount(0);
  await expect(rows.filter({ hasText: first.orderNumber })).toBeVisible();
  expect((await ravi.order(second.id)).status).toBe('PAYMENT_CONFIRMED');

  // It is on the kitchen board, and the kitchen can start it.
  await page.goto(`${E2E.staffUrl}/orders`);
  const card = page.getByRole('article').filter({ hasText: second.orderNumber });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Start preparing/ }).click();
  await expect.poll(async () => (await ravi.order(second.id)).status).toBe('PREPARING');

  // Leave nothing active behind: confirm Asha's claim, then hand both over.
  const scoped = `?canteenId=${canteen.id}`;
  await staff.data('POST', `/staff/orders/${first.id}/confirm-demo-payment${scoped}`, {
    simulatedPaymentReceived: true,
  });
  for (const id of [first.id, second.id]) {
    for (const status of ['PREPARING', 'READY', 'COLLECTED']) {
      const current = (await (id === first.id ? asha : ravi).order(id)).status;
      if (current === status || current === 'COLLECTED') continue;
      await staff.data('PATCH', `/staff/orders/${id}/status${scoped}`, { status });
    }
  }
  expect((await ravi.order(second.id)).status).toBe('COLLECTED');
  expect((await asha.order(first.id)).status).toBe('COLLECTED');
});

test('an abandoned order expires by itself and leaves the queue live', async ({ page }) => {
  await cashierPage(page);
  const student = await StudentActor.register('Queue Abandoner', HOSTEL);
  const placed = await student.orderUnpaid();
  const unclaimed = page.getByRole('table', { name: 'unclaimed orders' });
  await expect(unclaimed.getByText(placed.orderNumber)).toBeVisible();

  // The payment window runs out (moved into the past); the server's own
  // expiry job cancels the order and the cashier's queue updates live.
  backdatePaymentDeadline(placed.id);
  await expect(unclaimed.getByText(placed.orderNumber)).toHaveCount(0, { timeout: 20_000 });

  const seen = await student.order(placed.id);
  expect(seen.status).toBe('CANCELLED');
  expect(seen.payment?.expiredAt).toEqual(expect.any(String));
  expect(seen.cancelReason).toMatch(/not received within \d+ minutes/);
  // It can no longer be claimed or confirmed.
  const late = await student.claim(placed.id, 'TOOLATE1');
  expect(late.status).toBe(409);
  expect(late.body.error?.code).toBe('ORDER_EXPIRED');
});
