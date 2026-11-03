import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { DEMO_QR_WARNING, containsPaymentUri } from '../../src/modules/canteens/demo-qr.js';
import { canteenPaymentConfigSchema, receiptSchema } from '../helpers/contract.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  itemByName,
  newAdmin,
  newApprovedStaff,
  newStudent,
  placeOrder,
  type Actor,
} from '../helpers/actors.js';

const { app, prisma, env } = buildTestApp();

let admin: Actor;
let student: Actor;
let cashier: Actor;
let kg: { id: string; name: string };
let yn: { id: string; name: string };
let coffee: { id: string };

const officialLive = (canteenId: string) => ({
  mode: 'LIVE' as const,
  upiVpa: `canteen${canteenId.slice(0, 8)}@okicici`,
  merchantName: 'Test merchant (not university official)',
  qrImageUrl: 'https://cdn.example.com/official-qr.png',
  isActive: true,
});

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  yn = await canteenBySlug(prisma, 'yamuna-narmada');
  coffee = await itemByName(prisma, kg.id, 'Coffee');
  admin = await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
  cashier = await newApprovedStaff(app, admin, kg.id);
  await request(app)
    .put(`/api/admin/staff/${cashier.id}/assignments`)
    .set(bearer(admin.token))
    .send({
      primaryCanteenId: kg.id,
      assignments: [
        { canteenId: kg.id, capabilities: ['CASHIER'] },
        { canteenId: yn.id, capabilities: ['CASHIER'] },
      ],
    })
    .expect(200);
});
afterAll(() => prisma.$disconnect());

describe('per-canteen DEMO/LIVE payment configuration', () => {
  it('gives each seeded canteen its own DEMO config and a non-payable QR placeholder', async () => {
    const kgConfig = await request(app)
      .get(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .expect(200);
    const ynConfig = await request(app)
      .get(`/api/admin/canteens/${yn.id}/payment-config`)
      .set(bearer(admin.token))
      .expect(200);
    canteenPaymentConfigSchema.parse(kgConfig.body.data);
    canteenPaymentConfigSchema.parse(ynConfig.body.data);
    expect(kgConfig.body.data.mode).toBe('DEMO');
    expect(ynConfig.body.data.mode).toBe('DEMO');
    expect(kgConfig.body.data.upiVpa).toBeNull();
    expect(kgConfig.body.data.demoQr.warning).toBe(DEMO_QR_WARNING);
    expect(kgConfig.body.data.demoQr.payload).toBe(`SERVE-DEMO:${kg.id}`);
    expect(ynConfig.body.data.demoQr.payload).toBe(`SERVE-DEMO:${yn.id}`);
    expect(kgConfig.body.data.demoQr.payload).not.toBe(ynConfig.body.data.demoQr.payload);
    expect(containsPaymentUri(kgConfig.body.data.demoQr.payload)).toBe(false);
    expect(containsPaymentUri(kgConfig.body.data.demoQr.svg)).toBe(false);
    expect(kgConfig.body.data.demoQr.svg).not.toMatch(/upi:\/\//i);

    const asStaff = await request(app)
      .put(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(cashier.token))
      .send({ mode: 'LIVE' });
    expect(asStaff.status).toBe(403);

    const asStudent = await request(app)
      .get(`/api/canteens/${kg.id}/payment-config`)
      .set(bearer(student.token))
      .expect(200);
    expect(asStudent.body.data.mode).toBe('DEMO');
    expect(asStudent.body.data.upiVpa).toBeNull();
    expect(asStudent.body.data.qrStorageKey).toBeUndefined();
    expect(asStudent.body.data.demoQr.warning).toBe(DEMO_QR_WARNING);
    expect(containsPaymentUri(asStudent.body.data.demoQr.payload)).toBe(false);
    expect(JSON.stringify(asStudent.body.data)).not.toMatch(/upi:\/\//i);
  });

  it('rejects LIVE mode without official UPI, merchant and QR details', async () => {
    const res = await request(app)
      .put(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .send({ mode: 'LIVE', upiVpa: 'kg-live@okicici' })
      .expect(422);
    expect(res.body.error.code).toBe('LIVE_CONFIG_INCOMPLETE');
    const still = await request(app)
      .get(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .expect(200);
    expect(still.body.data.mode).toBe('DEMO');
  });

  it('switches one canteen to LIVE without changing another canteen', async () => {
    await request(app)
      .put(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .send(officialLive(kg.id))
      .expect(200)
      .then((res) => {
        expect(res.body.data.mode).toBe('LIVE');
        expect(res.body.data.demoQr).toBeNull();
        expect(res.body.data.isActive).toBe(true);
      });

    const ynConfig = await request(app)
      .get(`/api/admin/canteens/${yn.id}/payment-config`)
      .set(bearer(admin.token))
      .expect(200);
    expect(ynConfig.body.data.mode).toBe('DEMO');
    expect(ynConfig.body.data.upiVpa).toBeNull();

    const studentLive = await request(app)
      .get(`/api/canteens/${kg.id}/payment-config`)
      .set(bearer(student.token))
      .expect(200);
    expect(studentLive.body.data.mode).toBe('LIVE');
    expect(studentLive.body.data.demoQr).toBeNull();
    expect(studentLive.body.data.upiVpa).toBe(`canteen${kg.id.slice(0, 8)}@okicici`);
    expect(studentLive.body.data.qrStorageKey).toBeUndefined();
    expect(studentLive.body.data.qrImageUrl).toBe('https://cdn.example.com/official-qr.png');
  });

  it('rejects DEMO confirmation on LIVE and records a real LIVE confirmation', async () => {
    const placed = await placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    const demoRejected = await request(app)
      .post(`/api/staff/orders/${placed.id}/confirm-demo-payment`)
      .set(bearer(cashier.token))
      .send({ simulatedPaymentReceived: true })
      .expect(409);
    expect(demoRejected.body.error.code).toBe('DEMO_CONFIRMATION_NOT_ALLOWED');

    const confirmed = await request(app)
      .post(`/api/staff/orders/${placed.id}/confirm-payment`)
      .set(bearer(cashier.token))
      .send({ paymentReceived: true, utr: 'LIVEUTR001' })
      .expect(200);
    expect(confirmed.body.data.order.payment.isSimulated).toBe(false);
    expect(confirmed.body.data.receipt.simulated).toBe(false);
    expect(confirmed.body.data.receipt.notice).toBeNull();

    const concurrent = await placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/staff/orders/${concurrent.id}/confirm-payment`)
        .set(bearer(cashier.token))
        .send({ paymentReceived: true }),
      request(app)
        .post(`/api/staff/orders/${concurrent.id}/confirm-payment`)
        .set(bearer(cashier.token))
        .send({ paymentReceived: true }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect([first.body.error?.code, second.body.error?.code].filter(Boolean)).toEqual([
      'PAYMENT_ALREADY_CONFIRMED',
    ]);

    const dashboard = await request(app)
      .get('/api/staff/dashboard')
      .set(bearer(cashier.token))
      .expect(200);
    const liveSum = await prisma.payment.aggregate({
      where: { order: { canteenId: kg.id }, status: 'SUCCESS', isSimulated: false },
      _sum: { amountPaise: true },
    });
    expect(dashboard.body.data.today.revenuePaise).toBe(liveSum._sum.amountPaise ?? 0);
    expect(dashboard.body.data.today.revenuePaise).toBeGreaterThan(0);
  });

  it('keeps DEMO walk-in sales out of real revenue and historical LIVE rows unchanged', async () => {
    await request(app)
      .put(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .send({ mode: 'DEMO' })
      .expect(200);

    const before = await prisma.payment.findMany({
      where: { order: { canteenId: kg.id }, isSimulated: false, status: 'SUCCESS' },
      select: { id: true, isSimulated: true, amountPaise: true },
    });
    expect(before.length).toBeGreaterThan(0);

    const demoSale = await request(app)
      .post('/api/staff/pos/demo-sales')
      .set(bearer(cashier.token))
      .send({
        servicePeriod: 'NIGHT',
        paymentMethod: 'UPI',
        simulatedPaymentReceived: true,
        items: [{ menuItemId: coffee.id, quantity: 1 }],
      })
      .expect(201);
    expect(demoSale.body.data.order.payment.isSimulated).toBe(true);
    expect(demoSale.body.data.receipt.notice).toBe('DEMO TRANSACTION — NO REAL PAYMENT');

    const liveHistory = await request(app)
      .get('/api/staff/sales?simulated=false')
      .set(bearer(cashier.token))
      .expect(200);
    expect(liveHistory.body.data.map((row: { id: string }) => row.id)).not.toContain(
      demoSale.body.data.order.id,
    );

    const demoHistory = await request(app)
      .get('/api/staff/sales?simulated=true')
      .set(bearer(cashier.token))
      .expect(200);
    expect(demoHistory.body.data.map((row: { id: string }) => row.id)).toContain(
      demoSale.body.data.order.id,
    );

    const dashboard = await request(app)
      .get('/api/staff/dashboard')
      .set(bearer(cashier.token))
      .expect(200);
    const liveTotal = before.reduce((sum, row) => sum + row.amountPaise, 0);
    expect(dashboard.body.data.today.revenuePaise).toBe(liveTotal);

    const unchanged = await prisma.payment.findMany({
      where: { id: { in: before.map((row) => row.id) } },
      select: { isSimulated: true },
    });
    expect(unchanged.every((row) => row.isSimulated === false)).toBe(true);

    const staffConfig = await request(app)
      .get('/api/staff/canteen/payment-config')
      .set(bearer(cashier.token))
      .expect(200);
    expect(staffConfig.body.data.mode).toBe('DEMO');
    expect(staffConfig.body.data.upiVpa).toBeNull();
    expect(JSON.stringify(staffConfig.body.data)).not.toContain('okicici');
  });
});
