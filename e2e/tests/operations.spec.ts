import { expect, test } from '@playwright/test';
import type { MenuItem } from '@serve/contracts';
import { StudentActor, approvedStaff } from './support/api';
import { E2E } from './support/constants.mjs';
import { expectLive, signIn } from './support/ui';

test('staff menu changes reach browsing students live, with rupees stored as paise', async ({
  page,
}) => {
  const { email } = await approvedStaff('Menu Staff', 'Yamuna & Narmada Night Canteen');
  const student = await StudentActor.register('Menu Browser', 'Yamuna');
  const socket = await student.socket();
  expect((await socket.subscribeMenu(student.me.defaultCanteen.id)).ok).toBe(true);

  await signIn(page, E2E.staffUrl, email, E2E.password);
  await page.getByRole('link', { name: 'Menu' }).click();
  await expectLive(page);
  const row = page.getByRole('row').filter({ hasText: 'Veg Grilled Sandwich' });

  await test.step('availability toggle', async () => {
    await row
      .getByRole('checkbox', { name: 'Veg Grilled Sandwich available' })
      .click({ force: true });
    await expect(row.getByText('Unavailable')).toBeVisible();
    const event = await socket.waitFor<{
      itemId: string;
      isOrderable: boolean;
      availability: string;
    }>('menu.item_availability_changed');
    expect(event).toMatchObject({ isOrderable: false, availability: 'UNAVAILABLE' });
    const item = await student.data<MenuItem>('GET', `/menu/items/${event.itemId}`);
    expect(item.isOrderable).toBe(false);
    // An unavailable item cannot be ordered, whatever the client sends.
    const attempt = await student.placeOrder(student.me.defaultCanteen.id, [
      { menuItemId: event.itemId, quantity: 1 },
    ]);
    expect(attempt.status).toBeGreaterThanOrEqual(400);
    await row
      .getByRole('checkbox', { name: 'Veg Grilled Sandwich available' })
      .click({ force: true });
    await expect(row.getByText('Available', { exact: true })).toBeVisible();
  });

  await test.step('price edit in rupees', async () => {
    await row.getByRole('button', { name: 'Edit Veg Grilled Sandwich' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Price (₹)').fill('77.50');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(row.getByText('₹77.50')).toBeVisible();
    const event = await socket.waitFor<{ itemId: string; pricePaise: number }>(
      'menu.item_price_changed',
    );
    expect(event.pricePaise).toBe(7_750);
    const quote = await student.quote(student.me.defaultCanteen.id, [
      { menuItemId: event.itemId, quantity: 2 },
    ]);
    expect(quote.totalPaise).toBe(15_500);
  });

  socket.close();
});

test('admin pauses and resumes a canteen; students are told live and orders are refused while paused', async ({
  page,
}) => {
  const student = await StudentActor.register('Paused Canteen Student', 'New Hostel');
  const canteenId = student.me.defaultCanteen.id;
  const socket = await student.socket();
  await socket.subscribeMenu(canteenId);
  const menu = await student.menu();
  const item = menu.categories.flatMap((c) => c.items).find((i) => i.isOrderable)!;

  await signIn(page, E2E.adminUrl, E2E.adminEmail, E2E.password);
  await page.getByRole('link', { name: 'Canteens' }).click();
  const row = page.getByRole('row').filter({ hasText: 'New Hostel Night Canteen' });
  await row.getByRole('button', { name: 'Pause' }).click();
  await expect(row.getByText('Paused')).toBeVisible();
  expect(
    await socket.waitFor(
      'canteen.status_changed',
      (d: { status: string }) => d.status === 'PAUSED',
    ),
  ).toBeTruthy();

  const refused = await student.placeOrder(canteenId, [{ menuItemId: item.id, quantity: 1 }]);
  expect(refused.status).toBe(409);
  expect(refused.body.error?.code).toBe('CANTEEN_NOT_ACCEPTING_ORDERS');

  await row.getByRole('button', { name: 'Resume' }).click();
  await expect(row.getByText('Accepting orders')).toBeVisible();
  const accepted = await student.placeOrder(canteenId, [{ menuItemId: item.id, quantity: 1 }]);
  expect(accepted.status).toBe(201);
  socket.close();
});

test('admin deactivates a staff member; their dashboard locks immediately', async ({ browser }) => {
  const { email } = await approvedStaff('Leaving Staff', 'Ganga A & Ganga B Night Canteen');
  const staff = await (await browser.newContext()).newPage();
  await signIn(staff, E2E.staffUrl, email, E2E.password);
  await expect(staff.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expectLive(staff);

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, E2E.adminUrl, E2E.adminEmail, E2E.password);
  await admin.getByRole('link', { name: 'Staff' }).click();
  await admin.getByRole('button', { name: 'Manage Leaving Staff' }).click();
  await admin.getByRole('button', { name: 'Deactivate staff member' }).click();
  await admin.getByRole('button', { name: 'Confirm deactivation' }).click();
  await expect(admin.getByText('Leaving Staff deactivated')).toBeVisible();

  await expect(staff.getByRole('heading', { name: 'Access removed' })).toBeVisible();
  await expect(staff.getByRole('link', { name: 'Orders' })).toHaveCount(0);
});

test('a staff member cancels a paid order before preparation; the student is refunded', async ({
  page,
}) => {
  const { email } = await approvedStaff('Cancel Staff', 'Vedavathi Night Canteen');
  const student = await StudentActor.register('Refund Student', 'Vedavathi');
  const socket = await student.socket();
  const { order } = await student.orderAndPay(1);

  await signIn(page, E2E.staffUrl, email, E2E.password);
  await page.getByRole('link', { name: 'Orders' }).click();
  const card = page.getByRole('article').filter({ hasText: order.orderNumber });
  await card.getByRole('button', { name: 'Cancel' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason (shown to the student)').fill('Item ran out');
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByText(order.orderNumber)).toHaveCount(0);

  const event = await socket.waitFor<{ order: { id: string; cancelReason: string | null } }>(
    'order.cancelled',
    (d) => d.order.id === order.id,
  );
  expect(event.order.cancelReason).toBe('Item ran out');
  // The cancellation commits first and the refund follows (see architecture.md §6).
  const final = await student.data<{ status: string; payment: { status: string } }>(
    'GET',
    `/orders/${order.id}`,
  );
  expect(final.status).toBe('CANCELLED');
  expect(final.payment.status).toBe('REFUNDED');
  socket.close();
});
