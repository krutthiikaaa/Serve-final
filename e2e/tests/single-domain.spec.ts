import { expect, test, type Page } from '@playwright/test';
import { approvedStaff, uniqueEmail } from './support/api';
import { E2E } from './support/constants.mjs';
import { enableFlutterSemantics, typeInto } from './support/flutter';
import { expectLive, signIn } from './support/ui';

/**
 * SINGLE-DOMAIN DEPLOYMENT — the built apps behind one origin, as deployed:
 *   /          Flutter student app      /staff/   staff dashboard
 *   /admin/    admin portal             /api      REST     /socket.io  realtime
 * Run with `npm run test:e2e:single-domain` (playwright.single-domain.config.ts).
 * E2E_SINGLE_DOMAIN_URL runs the same checks through a proxy in front of the
 * backend, e.g. https://YOUR_DOMAIN → Caddy/nginx → E2E backend.
 */
const ORIGIN = process.env.E2E_SINGLE_DOMAIN_URL ?? E2E.apiUrl;
const SELF_SIGNED = process.env.E2E_IGNORE_HTTPS_ERRORS === '1';
const at = (path: string) => `${ORIGIN}${path}`;

/** The official logo has not been supplied yet; the apps fall back to the wordmark. */
const KNOWN_MISSING = new Set([
  '/assets/assets/images/serve_logo.png',
  '/staff/brand/serve-logo.png',
  '/admin/brand/serve-logo.png',
]);

/** Collects problems a visitor would hit: script errors, CSP blocks, broken files. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) problems.push(`CSP: ${msg.text()}`);
  });
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (url.origin !== ORIGIN || url.pathname.startsWith('/api/')) return;
    if (res.status() >= 400 && !KNOWN_MISSING.has(url.pathname))
      problems.push(`${res.status()} ${url.pathname}`);
  });
  page.on('requestfailed', (req) => {
    const url = new URL(req.url());
    const error = req.failure()?.errorText ?? '';
    // A reload or navigation cancels requests still in flight (net::ERR_ABORTED).
    if (url.origin === ORIGIN && !error.includes('ERR_ABORTED'))
      problems.push(`failed: ${url.pathname} ${error}`);
  });
  return problems;
}

async function expectApp(page: Page, app: 'student' | 'staff' | 'admin') {
  if (app === 'student') {
    await expect(page).toHaveTitle('SERVE');
    await page.waitForSelector('flt-semantics-placeholder, flt-glass-pane', {
      state: 'attached',
      timeout: 30_000,
    });
  } else {
    await expect(page).toHaveTitle(app === 'staff' ? 'SERVE Staff' : 'SERVE Admin');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  }
}

/** Chrome's own verdict on whether the page can be installed as an app. */
async function installabilityErrors(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  const check = async () =>
    (
      (await cdp.send('Page.getInstallabilityErrors')) as {
        installabilityErrors: { errorId: string }[];
      }
    ).installabilityErrors.map((e) => e.errorId);
  try {
    // The manifest and icons load asynchronously after navigation.
    await expect.poll(check, { timeout: 15_000 }).toEqual([]);
    return [];
  } catch {
    return await check();
  } finally {
    await cdp.detach();
  }
}

test.describe.configure({ mode: 'serial' });

test('every app loads from one origin, and deep links survive a refresh', async ({ page }) => {
  const problems = watch(page);
  for (const [path, app] of [
    ['/', 'student'],
    ['/orders/history', 'student'],
    ['/staff/', 'staff'],
    ['/staff/orders', 'staff'],
    ['/admin/', 'admin'],
    ['/admin/change-requests', 'admin'],
  ] as const) {
    await test.step(`${path} → ${app}`, async () => {
      const res = await page.goto(at(path));
      expect(res?.status()).toBe(200);
      await expectApp(page, app);
      await page.reload();
      await expectApp(page, app);
    });
  }
  await page.goto(at('/staff'));
  expect(new URL(page.url()).pathname).toBe('/staff/');
  expect(problems).toEqual([]);
});

test('the API is same-origin under /api', async ({ request }) => {
  const health = await request.get(at('/api/health'));
  expect(health.status()).toBe(200);
  expect(((await health.json()) as { status: string }).status).toBe('ok');
  const missing = await request.get(at('/api/not-a-route'));
  expect(missing.status()).toBe(404);
  expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
    'ROUTE_NOT_FOUND',
  );
});

test('all three apps are installable (manifest, icons, Chrome install check)', async ({ page }) => {
  test.skip(SELF_SIGNED, 'Chrome never offers to install apps from an untrusted certificate');
  for (const [path, name, scope] of [
    ['/', 'SERVE', '/'],
    ['/staff/', 'SERVE Staff', '/staff/'],
    ['/admin/', 'SERVE Admin', '/admin/'],
  ] as const) {
    await test.step(name, async () => {
      await page.goto(at(path));
      const href = await page.locator('link[rel="manifest"]').getAttribute('href');
      const manifestUrl = new URL(href!, page.url());
      const manifest = (await (await page.request.get(manifestUrl.href)).json()) as {
        name: string;
        display: string;
        start_url: string;
        scope: string;
        icons: { src: string; sizes: string; type: string }[];
      };
      expect(manifest).toMatchObject({ name, display: 'standalone' });
      expect(new URL(manifest.scope, manifestUrl).pathname).toBe(scope);
      expect(new URL(manifest.start_url, manifestUrl).pathname).toBe(scope);
      expect(manifest.icons.map((i) => i.sizes)).toEqual(
        expect.arrayContaining(['192x192', '512x512']),
      );
      for (const icon of manifest.icons) {
        const res = await page.request.get(new URL(icon.src, manifestUrl).href);
        expect(res.status(), icon.src).toBe(200);
        expect(res.headers()['content-type']).toBe('image/png');
      }
      await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

      expect(await installabilityErrors(page)).toEqual([]);
    });
  }
  await page.goto(at('/'));
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
});

test('full flow on one origin: Flutter student pays, staff works the order live, admin sees it', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { email: staffEmail } = await approvedStaff(
    'Single Domain Staff',
    'Krishna & Godavari Night Canteen',
  );

  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  const staffProblems = watch(staff);
  const sockets: string[] = [];
  staff.on('websocket', (ws) => sockets.push(ws.url()));

  await test.step('staff signs in at /staff/ and goes live over a WebSocket', async () => {
    await signIn(staff, at('/staff/'), staffEmail, E2E.password);
    await expect(staff.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await staff.getByRole('link', { name: 'Orders' }).click();
    await expect(staff).toHaveURL(at('/staff/orders'));
    await expectLive(staff);
    expect(
      sockets.some((url) => url.startsWith(`${ORIGIN.replace(/^http/, 'ws')}/socket.io/`)),
    ).toBe(true);
    // A refresh on the deep link keeps the session and the page.
    await staff.reload();
    await expect(staff.getByRole('region', { name: 'New' })).toBeVisible();
    await expectLive(staff);
  });

  const student = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-IN' })
  ).newPage();
  const studentProblems = watch(student);
  const name = `Domain Student ${Date.now()}`;
  let orderNumber = '';

  await test.step('student registers in the Flutter app at /', async () => {
    await student.goto(at('/'));
    await enableFlutterSemantics(student);
    await student.getByRole('button', { name: /^Student/ }).click();
    await student.getByRole('button', { name: 'Create an account' }).click();
    await typeInto(student, 'Full name', name);
    await typeInto(student, 'University email', uniqueEmail('domain.student'));
    await typeInto(student, 'Password', E2E.password);
    await student.getByRole('button', { name: /Select your hostel/ }).click();
    await student
      .getByRole('menuitem', { name: /^Krishna\s+·/ })
      .or(student.getByRole('button', { name: /^Krishna\s+·/ }))
      .first()
      .click();
    await student.getByRole('button', { name: 'Create account' }).click();
    await expect(student.getByText(/^Hi, Domain/)).toBeVisible({ timeout: 20_000 });
  });

  await test.step('student orders and pays with the demo gateway', async () => {
    await student.getByRole('tab', { name: 'Menu' }).click();
    await student.getByRole('button', { name: 'Add Veg Grilled Sandwich' }).click();
    await student.getByRole('button', { name: 'Cart, 1' }).click();
    await student.getByRole('button', { name: 'Checkout' }).click();
    await student.getByRole('button', { name: 'Place order' }).click();
    await expect(student.getByText(/no real money is charged/)).toBeVisible();
    await student.getByRole('button', { name: /^Pay ₹/ }).click();
    await expect(student.getByText('Payment confirmed')).toBeVisible({ timeout: 15_000 });
    const label = await student
      .getByText(/^Order number SV\d+$/)
      .first()
      .textContent();
    orderNumber = (label ?? '').replace('Order number', '').trim();
    expect(orderNumber).toMatch(/^SV\d+$/);
    await student.getByRole('button', { name: 'Track order' }).click();
    await expect(student.getByText('Order received').first()).toBeVisible();
  });

  await test.step('the order reaches the staff board live; staff moves it, student sees it', async () => {
    const card = staff.getByRole('article').filter({ hasText: orderNumber });
    await expect(staff.getByRole('region', { name: 'New' }).getByText(orderNumber)).toBeVisible();
    await card.getByRole('button', { name: 'Start preparing' }).click();
    await expect(student.getByText('Your food is being prepared').first()).toBeVisible();
    await card.getByRole('button', { name: 'Mark ready' }).click();
    await expect(student.getByText(/Show this number at the/).first()).toBeVisible();
    await card.getByRole('button', { name: 'Mark collected' }).click();
    await expect(student.getByText('Collected — enjoy!').first()).toBeVisible();
  });

  await test.step('the same browser session is not an admin session at /admin/', async () => {
    // Same origin, same Firebase session: the backend account decides.
    await staff.goto(at('/admin/'));
    await expect(
      staff.getByText('You are signed in with a staff account. Use the staff dashboard instead.'),
    ).toBeVisible();
    await expect(staff.getByRole('link', { name: 'Change requests' })).toHaveCount(0);
  });

  await test.step('admin signs in at /admin/ and sees the collected order', async () => {
    const admin = await (await browser.newContext()).newPage();
    const adminProblems = watch(admin);
    await signIn(admin, at('/admin/'), E2E.adminEmail, E2E.password);
    await expect(admin.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const row = admin.getByRole('row').filter({ hasText: orderNumber });
    await expect(row.getByText('Collected')).toBeVisible();
    await admin.getByRole('link', { name: /^Change requests/ }).click();
    await expect(admin).toHaveURL(at('/admin/change-requests'));
    await admin.reload();
    await expect(admin.getByRole('heading', { name: 'Change requests' })).toBeVisible();
    expect(adminProblems).toEqual([]);
  });

  expect(staffProblems).toEqual([]);
  expect(studentProblems).toEqual([]);
});
