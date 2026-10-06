import { expect, test } from '@playwright/test';
import type { Notification, OrderEventData, StudentOrder } from '@serve/contracts';
import { StudentActor, uniqueEmail } from './support/api';
import { E2E } from './support/constants.mjs';
import { expectLive, signIn } from './support/ui';

/**
 * CRITICAL FLOW — every piece real: staff self-onboards in the staff UI, the
 * admin approves in the admin UI, a student pays through the mock gateway,
 * and the order moves through the kitchen with live updates on both sides.
 */
test('staff onboarding → admin approval → paid order → live kitchen → pickup', async ({
  browser,
}) => {
  const admin = await (await browser.newContext()).newPage();
  const staff = await (await browser.newContext()).newPage();
  const staffEmail = uniqueEmail('staff');
  const canteenName = 'Krishna & Godavari Night Canteen';

  await test.step('admin watches the change-request queue live', async () => {
    await signIn(admin, E2E.adminUrl, E2E.adminEmail, E2E.password);
    await expect(admin.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await admin.getByRole('link', { name: /^Change requests/ }).click();
    await expect(admin.getByRole('heading', { name: 'Change requests' })).toBeVisible();
    await expectLive(admin);
  });

  await test.step('staff creates an account and requests a canteen', async () => {
    await staff.goto(`${E2E.staffUrl}/create-account`);
    await staff.getByLabel('Work email').fill(staffEmail);
    await staff.getByLabel('Password').fill(E2E.password);
    await staff.getByRole('button', { name: 'Continue' }).click();
    await expect(staff.getByRole('heading', { name: 'Your staff details' })).toBeVisible();
    await staff.getByLabel('Full name').fill('E2E Kitchen Staff');
    await staff.getByLabel('Canteen you work at').selectOption({ label: canteenName });
    await staff.getByRole('button', { name: 'Request access' }).click();
    await expect(staff.getByRole('heading', { name: 'Awaiting approval' })).toBeVisible();
    await expect(staff.getByText(canteenName)).toBeVisible();
    // Pending staff have no operational access.
    await expect(staff.getByRole('link', { name: 'Orders' })).toHaveCount(0);
  });

  await test.step('the request appears for the admin without a reload; admin approves', async () => {
    await expect(admin.getByText('E2E Kitchen Staff', { exact: true })).toBeVisible();
    await admin.getByRole('button', { name: 'Approve E2E Kitchen Staff' }).click();
    const dialog = admin.getByRole('dialog', { name: 'Approve E2E Kitchen Staff?' });
    await dialog
      .getByLabel('Note to the staff member (optional)')
      .fill('Welcome to the night shift');
    await dialog.getByRole('button', { name: 'Approve and assign' }).click();
    await expect(admin.getByText(`E2E Kitchen Staff assigned to ${canteenName}`)).toBeVisible();
  });

  await test.step('the staff screen unlocks live with the assigned canteen', async () => {
    await expect(staff.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(staff.getByRole('complementary').getByText(canteenName)).toBeVisible();
    await staff.getByRole('link', { name: 'Orders' }).click();
    await expect(staff.getByRole('region', { name: 'New' })).toBeVisible();
    await expectLive(staff);
  });

  const student = await StudentActor.register('E2E Student');
  const studentSocket = await student.socket();
  let order!: StudentOrder;

  await test.step('student orders and pays (server-priced, mock gateway)', async () => {
    const menu = await student.menu();
    const item = menu.categories.flatMap((c) => c.items).find((i) => i.isOrderable)!;
    const quote = await student.quote(menu.canteen.id, [{ menuItemId: item.id, quantity: 2 }]);
    expect(quote.totalPaise).toBe(item.pricePaise * 2);
    const placed = await student.placeOrder(menu.canteen.id, [
      { menuItemId: item.id, quantity: 2 },
    ]);
    expect(placed.status).toBe(201);
    expect(placed.body.data.status).toBe('PLACED');
    expect(placed.body.data.totalPaise).toBe(quote.totalPaise);
    order = (await student.pay(placed.body.data.id)).order;
    expect(order.status).toBe('PAYMENT_CONFIRMED');
  });

  const newColumn = staff.getByRole('region', { name: 'New' });
  await test.step('the paid order reaches the staff board live', async () => {
    await expect(newColumn.getByText(order.orderNumber)).toBeVisible();
    await expect(staff.getByText(new RegExp(`New order ${order.orderNumber}`))).toBeVisible();
  });

  for (const [button, column, event] of [
    ['Start preparing', 'Preparing', 'order.preparing'],
    ['Mark ready', 'Ready for pickup', 'order.ready'],
  ] as const) {
    await test.step(`${button} → student is told live (${event})`, async () => {
      await staff
        .getByRole('article')
        .filter({ hasText: order.orderNumber })
        .getByRole('button', { name: button })
        .click();
      await expect(
        staff.getByRole('region', { name: column }).getByText(order.orderNumber),
      ).toBeVisible();
      const live = await studentSocket.waitFor<OrderEventData<StudentOrder>>(
        event,
        (d) => d.order.id === order.id,
      );
      expect(live.order.status).toBe(event === 'order.preparing' ? 'PREPARING' : 'READY');
      expect(live.order).not.toHaveProperty('student');
    });
  }

  await test.step('student gets a "ready for pickup" notification', async () => {
    const notes = await student.call<{ data: Notification[] }>('GET', '/notifications?unread=true');
    expect(notes.body.data.map((n) => n.type)).toContain('ORDER_READY');
  });

  await test.step('pickup: staff marks collected; the board clears', async () => {
    await staff
      .getByRole('article')
      .filter({ hasText: order.orderNumber })
      .getByRole('button', { name: 'Mark collected' })
      .click();
    await expect(staff.getByText(order.orderNumber)).toHaveCount(0);
    await studentSocket.waitFor<OrderEventData<StudentOrder>>(
      'order.collected',
      (d) => d.order.id === order.id,
    );
    const final = await student.data<StudentOrder>('GET', `/orders/${order.id}`);
    expect(final.status).toBe('COLLECTED');
    expect(final.timeline.map((t) => t.status)).toEqual([
      'PLACED',
      'PAYMENT_CONFIRMED',
      'PREPARING',
      'READY',
      'COLLECTED',
    ]);
    await staff.getByRole('tab', { name: 'Collected' }).click();
    await expect(staff.getByText(order.orderNumber)).toBeVisible();
  });

  await test.step('the admin dashboard reflects the collected order', async () => {
    await admin.getByRole('link', { name: 'Dashboard' }).click();
    const row = admin.getByRole('row').filter({ hasText: order.orderNumber });
    await expect(row.getByText('Collected')).toBeVisible();
  });

  studentSocket.close();
});
