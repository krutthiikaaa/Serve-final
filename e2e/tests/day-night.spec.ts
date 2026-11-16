import { expect, test, type Page } from '@playwright/test';
import type { Menu, ServiceArea, StudentService } from '@serve/contracts';
import { StudentActor, adminActor, approvedStaff } from './support/api';
import { E2E } from './support/constants.mjs';
import { expectLive, signIn } from './support/ui';

/**
 * Day & Night canteens in the real apps: the admin switches which canteen of
 * a service area takes orders, uploads a per-canteen payment QR, and a Day
 * canteen's dedicated staff account sees only its own canteen. Screens are
 * captured to test-results/visual/ for review.
 */
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `test-results/visual/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });

// 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

test('admin switches a service area between its Day and Night canteens', async ({ page }) => {
  const student = await StudentActor.register('Day Night Student');
  const service = () => student.data<StudentService>('GET', '/students/me/service');
  const area = (await service()).serviceArea;
  const night = (await service()).canteens.find((c) => c.type === 'NIGHT')!;
  const day = (await service()).canteens.find((c) => c.type === 'DAY')!;
  expect((await service()).current?.id).toBe(night.id);

  await signIn(page, E2E.adminUrl, E2E.adminEmail, E2E.password);
  // Let sign-in finish its redirect before navigating elsewhere.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.getByRole('complementary').getByRole('link', { name: 'Canteens' }).click();
  const card = page.locator('section.area-card').filter({ hasText: area.name });
  const group = card.getByRole('group', { name: 'Taking orders' });
  await expect(group.getByRole('button', { name: 'Night' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await shot(page, 'daynight-01-admin-canteens-night');

  await group.getByRole('button', { name: 'Day' }).click();
  await expect(group.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
  await expect(
    card.getByRole('row').filter({ hasText: day.name }).getByText('Taking orders'),
  ).toBeVisible();
  await expect(
    card.getByRole('row').filter({ hasText: night.name }).getByText('Off duty'),
  ).toBeVisible();
  await shot(page, 'daynight-02-admin-canteens-day');

  // The student now sees the Day canteen; the Night canteen refuses orders.
  await expect.poll(async () => (await service()).current?.id).toBe(day.id);
  const dayMenu = await student.data<Menu>('GET', `/canteens/${day.id}/menu`);
  expect(dayMenu.servicePeriod).toBe('DAY');
  const dayItem = dayMenu.categories.flatMap((c) => c.items).find((i) => i.isOrderable)!;
  expect(
    (await student.quote(day.id, [{ menuItemId: dayItem.id, quantity: 1 }])).canteen,
  ).toMatchObject({
    id: day.id,
    type: 'DAY',
  });
  const nightMenu = await student.data<Menu>('GET', `/canteens/${night.id}/menu`);
  const nightItem = nightMenu.categories.flatMap((c) => c.items)[0]!;
  const refused = await student.placeOrder(night.id, [{ menuItemId: nightItem.id, quantity: 1 }]);
  expect(refused.status).toBe(409);

  await group.getByRole('button', { name: 'Neither' }).click();
  await expect(group.getByRole('button', { name: 'Neither' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(async () => (await service()).unavailable).toBe(true);

  await group.getByRole('button', { name: 'Night' }).click();
  await expect(group.getByRole('button', { name: 'Night' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const admin = await adminActor();
  const areas = await admin.data<ServiceArea[]>('GET', '/admin/service-areas');
  expect(areas.find((row) => row.id === area.id)?.openCanteenId).toBe(night.id);
});

test('admin uploads and replaces a Day canteen’s own payment QR', async ({ page }) => {
  const student = await StudentActor.register('QR Student');
  const day = (await student.data<StudentService>('GET', '/students/me/service')).canteens.find(
    (c) => c.type === 'DAY',
  )!;
  await signIn(page, E2E.adminUrl, E2E.adminEmail, E2E.password);
  // Let sign-in finish its redirect before navigating elsewhere.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.goto(`${E2E.adminUrl}/canteens/${day.id}`);
  const qr = page.getByRole('region', { name: 'Payment QR' });
  await expect(qr.getByAltText('DEMO ONLY — NOT PAYABLE')).toBeVisible();
  await expect(qr.getByText('Placeholder (DEMO)')).toBeVisible();

  await qr
    .getByLabel('QR image file')
    .setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: PNG });
  const preview = qr.getByAltText(`Payment QR for ${day.name}`);
  await expect(preview).toBeVisible();
  const first = await preview.getAttribute('src');
  expect(first).toMatch(/\/api\/qr-codes\/[0-9a-f-]{36}$/);
  await expect(qr.getByRole('button', { name: 'Replace QR' })).toBeVisible();
  await shot(page, 'daynight-03-admin-qr-uploaded');

  await qr
    .getByLabel('QR image file')
    .setInputFiles({ name: 'qr2.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(async () => preview.getAttribute('src')).not.toBe(first);
  await expect(qr.getByText('Previous QR codes (1)')).toBeVisible();
  // The replaced image is no longer served.
  expect((await fetch(`${E2E.apiUrl}${new URL(first!).pathname}`)).status).toBe(404);
});

test('a Day canteen’s dedicated staff account sees only its canteen, with no switcher', async ({
  page,
}) => {
  const { email, canteen } = await approvedStaff('Day Kitchen', 'Krishna & Godavari Day Canteen');
  await signIn(page, E2E.staffUrl, email, E2E.password);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expectLive(page);
  const sidebar = page.getByRole('complementary');
  await expect(sidebar.getByText(canteen.name)).toBeVisible();
  await expect(sidebar.getByText('Day', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Selected canteen')).toHaveCount(0);
  await expect(page.getByText(/is serving this area now/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume orders' })).toHaveCount(0);
  await shot(page, 'daynight-04-staff-day-dashboard');
});

test('admin schedules automatic Day/Night switching, overrides it and restores it', async ({
  page,
}) => {
  const admin = await adminActor();
  const area = (await admin.data<ServiceArea[]>('GET', '/admin/service-areas')).find(
    (row) => row.name === 'Yamuna & Narmada',
  )!;
  const day = area.canteens.find((c) => c.type === 'DAY')!;
  const night = area.canteens.find((c) => c.type === 'NIGHT')!;
  // Hours built around the server's current time in Asia/Kolkata, so the Day
  // canteen is scheduled now: Day = now-1h … now+2h, Night = now+3h … now-2h.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const nowMin =
    Number(parts.find((p) => p.type === 'hour')!.value) * 60 +
    Number(parts.find((p) => p.type === 'minute')!.value);
  const clock = (offset: number) => {
    const m = (((nowMin + offset) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };

  try {
    await signIn(page, E2E.adminUrl, E2E.adminEmail, E2E.password);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.getByRole('complementary').getByRole('link', { name: 'Canteens' }).click();
    const card = page.locator('section.area-card').filter({ hasText: area.name });
    const strip = card.getByRole('group', { name: `${area.name} schedule` });
    await expect(strip.getByText('Manual', { exact: true })).toBeVisible();

    await strip.getByRole('button', { name: 'Edit schedule' }).click();
    const dialog = page.getByRole('dialog', { name: `${area.name} schedule` });
    await dialog.getByText('Switch automatically').click();
    await dialog.getByLabel('Day opens').fill(clock(-60));
    await dialog.getByLabel('Day closes').fill(clock(120));
    await dialog.getByLabel('Night opens').fill(clock(180));
    await dialog.getByLabel('Night closes').fill(clock(-120));
    await dialog.getByRole('button', { name: 'Save schedule' }).click();
    await expect(dialog).toHaveCount(0);

    // The server applied the schedule at once: Day on duty, Night off duty.
    await expect(strip.getByText('Automatic', { exact: true })).toBeVisible();
    await expect(strip.getByText(/Next: closes at/)).toBeVisible();
    await expect(
      card.getByRole('row').filter({ hasText: day.name }).getByText('Taking orders'),
    ).toBeVisible();
    await expect(
      card.getByRole('row').filter({ hasText: night.name }).getByText('Off duty'),
    ).toBeVisible();
    await shot(page, 'daynight-05-admin-schedule-automatic');

    // A manual switch asks how long it overrides the schedule.
    const group = card.getByRole('group', { name: 'Taking orders' });
    await group.getByRole('button', { name: 'Night' }).click();
    const override = page.getByRole('dialog', { name: 'Override the schedule?' });
    await override.getByText('Until I restore automatic switching').click();
    await override.getByRole('button', { name: 'Override' }).click();
    await expect(strip.getByText('Manual override')).toBeVisible();
    await expect(group.getByRole('button', { name: 'Night' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await shot(page, 'daynight-06-admin-schedule-override');

    await strip.getByRole('button', { name: 'Restore automatic' }).click();
    await expect(strip.getByText('Automatic', { exact: true })).toBeVisible();
    await expect(group.getByRole('button', { name: 'Day' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  } finally {
    // Leave the area as other specs expect it: manual, Night on duty.
    await admin.data('PUT', `/admin/service-areas/${area.id}/schedule`, {
      autoSwitchEnabled: false,
      timezone: 'Asia/Kolkata',
      day: null,
      night: null,
    });
    await admin.data('PUT', `/admin/service-areas/${area.id}/active-canteen`, {
      canteenId: night.id,
    });
  }
});
