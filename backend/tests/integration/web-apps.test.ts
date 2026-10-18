import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { io as connectClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { parseEnv } from '../../src/config/env.js';
import { seedDatabase } from '../../src/db/seed.js';
import { createRealtimeServer } from '../../src/realtime/socket-server.js';
import { pageContentSecurityPolicy } from '../../src/web/web-apps.js';
import { buildTestApp, buildTestContext } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import { bearer, canteenBySlug, itemByName, newStudent, placeOrder } from '../helpers/actors.js';

/**
 * Single-domain deployment: one process serves the three web apps, the API
 * and Socket.IO. WEB_ROOT points at a stand-in build with the same layout as
 * `npm run build:web` output.
 */
const webRoot = mkdtempSync(path.join(os.tmpdir(), 'serve-web-'));
const page = (app: string) => `<!doctype html><title>${app}</title><div id="${app}"></div>`;
for (const app of ['student', 'staff', 'admin']) {
  mkdirSync(path.join(webRoot, app, 'assets'), { recursive: true });
  writeFileSync(path.join(webRoot, app, 'index.html'), page(app));
}
writeFileSync(path.join(webRoot, 'staff', 'assets', 'index-AbC123.js'), 'console.log("staff")');
writeFileSync(path.join(webRoot, 'staff', 'manifest.webmanifest'), '{"name":"SERVE Staff"}');
writeFileSync(path.join(webRoot, 'student', 'main.dart.js'), 'console.log("student")');
writeFileSync(path.join(webRoot, 'student', '.secret'), 'do-not-serve');
writeFileSync(path.join(webRoot, 'package.json'), '{"name":"outside-the-apps"}');

const { app, prisma } = buildTestApp({ WEB_ROOT: webRoot });
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(webRoot, { recursive: true, force: true });
});

describe('web apps on one origin', () => {
  it.each([
    ['/', 'student'],
    ['/orders/123', 'student'],
    ['/staff/', 'staff'],
    ['/staff/orders', 'staff'],
    ['/staff/menu/items/42', 'staff'],
    ['/admin/', 'admin'],
    ['/admin/canteens/0d9a', 'admin'],
  ])('%s loads the %s app (deep links survive a refresh)', async (url, appName) => {
    const res = await request(app).get(url).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(`id="${appName}"`);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('redirects /staff and /admin to the trailing-slash URL, keeping the query', async () => {
    await request(app).get('/staff').expect(301).expect('Location', '/staff/');
    await request(app).get('/admin?tab=staff').expect(301).expect('Location', '/admin/?tab=staff');
  });

  it('serves hashed assets with a long cache and other files revalidated', async () => {
    const asset = await request(app).get('/staff/assets/index-AbC123.js').expect(200);
    expect(asset.headers['content-type']).toMatch(/javascript/);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const manifest = await request(app).get('/staff/manifest.webmanifest').expect(200);
    expect(manifest.headers['content-type']).toMatch(/application\/manifest\+json/);
    expect(manifest.headers['cache-control']).toBe('no-cache');

    const flutter = await request(app).get('/main.dart.js').expect(200);
    expect(flutter.headers['cache-control']).toBe('no-cache');
  });

  it('answers missing files with 404, not an HTML page', async () => {
    const res = await request(app).get('/staff/assets/missing.js').expect(404);
    expect(res.headers['content-type']).toMatch(/json/);
    await request(app).get('/favicon.ico').expect(404);
  });

  it('never serves dotfiles or files outside the app folders', async () => {
    const dotfile = await request(app).get('/.secret');
    expect(dotfile.text).not.toContain('do-not-serve');
    for (const url of [
      '/staff/../package.json',
      '/staff/%2e%2e/package.json',
      '/../package.json',
    ]) {
      const res = await request(app).get(url);
      expect(res.text).not.toContain('outside-the-apps');
    }
  });

  it('keeps the API in charge of /api (JSON 404s, strict API headers)', async () => {
    const missing = await request(app).get('/api/does-not-exist').expect(404);
    expect(missing.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(missing.headers['content-security-policy']).toContain("default-src 'none'");

    const health = await request(app).get('/api/health').expect(200);
    expect(health.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('protects pages with a CSP that only runs this origin’s scripts', async () => {
    const res = await request(app).get('/staff/').expect(200);
    const csp = res.headers['content-security-policy'] ?? '';
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('http://127.0.0.1:9099'); // Auth Emulator, test environment only
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    // Pages are same-origin: no CORS grant even for an allowed origin.
    const cors = await request(app).get('/staff/').set('Origin', 'http://localhost:5173');
    expect(cors.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('only serves GET and HEAD', async () => {
    await request(app).head('/staff/orders').expect(200);
    await request(app).post('/staff/orders').expect(404);
  });

  it('is off without WEB_ROOT: the API alone, as in local development', async () => {
    const apiOnly = buildTestApp();
    try {
      const res = await request(apiOnly.app).get('/').expect(404);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    } finally {
      await apiOnly.prisma.$disconnect();
    }
  });

  it('refuses to start when WEB_ROOT lacks a built app', () => {
    const incomplete = mkdtempSync(path.join(os.tmpdir(), 'serve-web-incomplete-'));
    mkdirSync(path.join(incomplete, 'student'));
    writeFileSync(path.join(incomplete, 'student', 'index.html'), page('student'));
    const ctx = buildTestContext({ env: { WEB_ROOT: incomplete } });
    try {
      expect(() => createApp(ctx)).toThrow(/staff[/\\]index\.html.*admin[/\\]index\.html/);
    } finally {
      rmSync(incomplete, { recursive: true, force: true });
      void ctx.prisma.$disconnect();
    }
  });

  it('never serves a `build:web --local` preview in production', () => {
    const preview = mkdtempSync(path.join(os.tmpdir(), 'serve-web-preview-'));
    for (const app of ['student', 'staff', 'admin']) {
      mkdirSync(path.join(preview, app));
      writeFileSync(path.join(preview, app, 'index.html'), page(app));
    }
    writeFileSync(path.join(preview, '.serve-web-build'), '{"local":true}');
    const ctx = buildTestContext();
    try {
      // Tests may serve a preview build...
      expect(() => createApp({ ...ctx, env: { ...ctx.env, WEB_ROOT: preview } })).not.toThrow();
      // ...a production server refuses it.
      const production = { ...ctx.env, NODE_ENV: 'production' as const, WEB_ROOT: preview };
      expect(() => createApp({ ...ctx, env: production })).toThrow(/local preview build/);
      writeFileSync(path.join(preview, '.serve-web-build'), '{"local":false}');
      expect(() => createApp({ ...ctx, env: production })).not.toThrow();
    } finally {
      rmSync(preview, { recursive: true, force: true });
      void ctx.prisma.$disconnect();
    }
  });
});

describe('page CSP by environment', () => {
  const SECRET = 'x'.repeat(32);
  it('upgrades insecure requests and never allows the emulator in production', () => {
    const production = parseEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://serve:pw@db.internal:5432/serve',
      CORS_ORIGINS: 'https://serve.example',
      FIREBASE_PROJECT_ID: 'serve-demo-project',
      FIREBASE_CLIENT_EMAIL: 'sa@serve-demo-project.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'key',
      PAYMENT_MODE: 'mock',
      PAYMENT_SECRET: SECRET,
      DEMO_MODE: 'true',
    });
    const csp = pageContentSecurityPolicy(production);
    expect(csp.upgradeInsecureRequests).toEqual([]);
    expect(csp.connectSrc).toEqual(["'self'", 'https:', 'wss:']);
  });
});

describe('Socket.IO and the web apps share one server', () => {
  let server: Server;
  let close: () => Promise<void>;
  let url: string;
  let token: string;

  beforeAll(async () => {
    const ctx = buildTestContext({ env: { WEB_ROOT: webRoot } });
    server = createServer(createApp(ctx));
    const realtime = createRealtimeServer(server, ctx);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = async () => {
      await realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await ctx.prisma.$disconnect();
    };
    await truncateAll(ctx.prisma);
    await seedDatabase(ctx.prisma);
    token = (await newStudent(createApp(ctx), ctx.prisma)).token;
  });
  afterAll(() => close());

  it('upgrades /socket.io to a WebSocket while / serves the student app', async () => {
    const html = await fetch(`${url}/`);
    expect(await html.text()).toContain('id="student"');

    const socket = connectClient(url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      expect(socket.io.engine.transport.name).toBe('websocket');
    } finally {
      socket.disconnect();
    }
  });
});

describe('demo deployment payments (NODE_ENV=production, DEMO_MODE=true)', () => {
  // Production-shaped configuration with the test database and emulator-backed
  // identity verifier injected, as server.ts would wire real Firebase.
  const ctx = buildTestContext();
  const demoEnv = { ...ctx.env, NODE_ENV: 'production' as const, DEMO_MODE: true };
  const demoApp = createApp({ ...ctx, env: demoEnv });
  afterAll(() => ctx.prisma.$disconnect());

  it('runs the full mock payment flow with server-side verification', async () => {
    await truncateAll(ctx.prisma);
    await seedDatabase(ctx.prisma);
    const kg = await canteenBySlug(ctx.prisma, 'krishna-godavari');
    const roll = await itemByName(ctx.prisma, kg.id, 'Chicken Roll');
    const student = await newStudent(demoApp, ctx.prisma);
    const order = await placeOrder(demoApp, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);

    await request(demoApp)
      .post(`/api/payments/${order.id}/initiate`)
      .set(bearer(student.token))
      .expect(200);
    // A gateway reporting the wrong amount is still rejected.
    const tampered = await request(demoApp)
      .post(`/api/payments/${order.id}/mock-complete`)
      .set(bearer(student.token))
      .send({ capturedAmountPaise: 1 });
    expect(tampered.status).toBeGreaterThanOrEqual(400);
    expect(
      (await ctx.prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } })).status,
    ).not.toBe('SUCCESS');

    const other = await placeOrder(demoApp, student, kg.id, [{ menuItemId: roll.id, quantity: 2 }]);
    await request(demoApp)
      .post(`/api/payments/${other.id}/initiate`)
      .set(bearer(student.token))
      .expect(200);
    const paid = await request(demoApp)
      .post(`/api/payments/${other.id}/mock-complete`)
      .set(bearer(student.token))
      .send({ outcome: 'success' })
      .expect(200);
    expect(paid.body.data.order).toMatchObject({
      status: 'PAYMENT_CONFIRMED',
      payment: { status: 'SUCCESS', amountPaise: 18_000 },
    });
    // Idempotent replay.
    const replay = await request(demoApp)
      .post(`/api/payments/${other.id}/mock-complete`)
      .set(bearer(student.token))
      .send({ outcome: 'success' })
      .expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });

  it('still requires the owning student', async () => {
    const kg = await canteenBySlug(ctx.prisma, 'krishna-godavari');
    const roll = await itemByName(ctx.prisma, kg.id, 'Chicken Roll');
    const owner = await newStudent(demoApp, ctx.prisma);
    const intruder = await newStudent(demoApp, ctx.prisma);
    const order = await placeOrder(demoApp, owner, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    await request(demoApp).post(`/api/payments/${order.id}/mock-complete`).expect(401);
    const res = await request(demoApp)
      .post(`/api/payments/${order.id}/mock-complete`)
      .set(bearer(intruder.token))
      .send({});
    expect(res.status).toBe(404);
  });
});
