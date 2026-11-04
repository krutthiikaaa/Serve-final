import { expect, test } from '@playwright/test';
import type { StaffOrder } from '@serve/contracts';
import { approvedStaff, uniqueEmail } from './support/api';
import { E2E } from './support/constants.mjs';
import { enableFlutterSemantics, typeInto } from './support/flutter';

/**
 * The real Flutter student app (web build) against the isolated stack:
 * registration, menu, one-canteen cart rule, checkout, DEMO payment (cashier
 * confirmation) and live tracking driven by the kitchen.
 * Opt-in: E2E_STUDENT_WEB=1 (needs Flutter).
 */
test.skip(
  process.env.E2E_STUDENT_WEB !== '1',
  'Set E2E_STUDENT_WEB=1 to build and test the Flutter web app',
);
test.use({ viewport: { width: 390, height: 844 }, locale: 'en-IN', hasTouch: false });

test('student registers, orders, pays and watches the order become ready live', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { staff, canteen, admin } = await approvedStaff(
    'Web Kitchen Staff',
    'Krishna & Godavari Night Canteen',
  );
  const me = await staff.data<{ id: string }>('GET', '/auth/me');
  await admin.data('PUT', `/admin/staff/${me.id}/assignments`, {
    primaryCanteenId: canteen.id,
    assignments: [
      {
        canteenId: canteen.id,
        capabilities: ['KITCHEN', 'MENU', 'PAUSE', 'CASHIER'],
      },
    ],
  });
  const name = `Web Student ${Date.now()}`;

  await page.goto(E2E.studentUrl);
  await enableFlutterSemantics(page);

  await test.step('registration with hostel', async () => {
    await expect(page.getByRole('button', { name: /^Student/ })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /^Student/ }).click();
    await page.getByRole('button', { name: 'Create an account' }).click();
    await typeInto(page, 'Full name', name);
    await typeInto(page, 'University email', uniqueEmail('web.student'));
    await typeInto(page, 'Password', E2E.password);
    await page.getByRole('button', { name: /Select your hostel/ }).click();
    await page
      .getByRole('menuitem', { name: /^Krishna\s+·/ })
      .or(page.getByRole('button', { name: /^Krishna\s+·/ }))
      .first()
      .click();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/^Hi, Web/)).toBeVisible({ timeout: 20_000 });
  });

  await test.step('menu and cart', async () => {
    await page.getByRole('tab', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Add Veg Grilled Sandwich' }).click();
    await page.getByRole('button', { name: 'Add one more Veg Grilled Sandwich' }).click();
    await expect(page.getByRole('button', { name: 'Cart, 2' })).toBeVisible();
  });

  await test.step('switching canteens asks before clearing the cart', async () => {
    await page.getByRole('button', { name: 'Change' }).click();
    await page.getByRole('button', { name: /^Vedavathi Night Canteen/ }).click();
    await expect(
      page.getByText(
        'Your cart contains items from another canteen. Switching canteens will clear your current cart.',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: 'Cart, 2' })).toBeVisible();
  });

  let orderNumber = '';
  await test.step('checkout leaves payment pending in DEMO mode', async () => {
    await page.getByRole('button', { name: 'Cart, 2' }).click();
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('DEMO ONLY — NOT PAYABLE').first()).toBeVisible();
    await expect(page.getByText(/PAYMENT PENDING/)).toBeVisible();
    const amountLine = await page.getByText(/Order SV\d+/).first().textContent();
    orderNumber = amountLine?.match(/SV\d+/)?.[0] ?? '';
    expect(orderNumber).toMatch(/^SV\d+$/);
    await page.getByRole('textbox', { name: 'Optional' }).fill('E2EDEMOUTR1');
    await page.getByRole('button', { name: 'Save demo reference' }).click();
    await expect(page.getByText(/still pending cashier confirmation/i)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Track this order' }).click();
    await expect(page.getByText('Order received').first()).toBeVisible({ timeout: 15_000 });
  });

  await test.step('cashier confirms DEMO payment; kitchen progresses live', async () => {
    const pending = await staff.call<{ data: StaffOrder[] }>(
      'GET',
      `/staff/payments/pending?limit=100&canteenId=${canteen.id}`,
    );
    const unpaid = pending.body.data.find((o) => o.orderNumber === orderNumber);
    expect(unpaid, `pending DEMO order ${orderNumber}`).toBeTruthy();
    expect(unpaid!.student.name).toBe(name);
    await staff.data(
      'POST',
      `/staff/orders/${unpaid!.id}/confirm-demo-payment?canteenId=${canteen.id}`,
      { simulatedPaymentReceived: true, utr: 'E2EDEMOUTR1' },
    );

    const board = await staff.call<{ data: StaffOrder[] }>(
      'GET',
      `/staff/orders?status=active&limit=100&canteenId=${canteen.id}`,
    );
    const order = board.body.data.find((o) => o.orderNumber === orderNumber);
    expect(order?.status).toBe('PAYMENT_CONFIRMED');

    await staff.data('PATCH', `/staff/orders/${order!.id}/status?canteenId=${canteen.id}`, {
      status: 'PREPARING',
    });
    await expect(page.getByText('Your food is being prepared').first()).toBeVisible({
      timeout: 15_000,
    });
    await staff.data('PATCH', `/staff/orders/${order!.id}/status?canteenId=${canteen.id}`, {
      status: 'READY',
    });
    await expect(page.getByText(/Show this number at the/).first()).toBeVisible();
    await staff.data('PATCH', `/staff/orders/${order!.id}/status?canteenId=${canteen.id}`, {
      status: 'COLLECTED',
    });
    await expect(page.getByText('Collected — enjoy!').first()).toBeVisible();
  });
});
