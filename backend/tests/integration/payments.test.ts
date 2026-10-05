import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { createApp } from '../../src/app.js';
import { RazorpayPaymentProvider } from '../../src/modules/payments/razorpay.provider.js';
import { hmacSha256Hex } from '../../src/modules/payments/signature.js';
import { buildTestApp, buildTestContext } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  itemByName,
  newStudent,
  placeOrder,
  type Actor,
} from '../helpers/actors.js';

const { app, prisma } = buildTestApp();

let student: Actor;
let otherStudent: Actor;
let kg: { id: string };
let roll: { id: string }; // ₹90

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  roll = await itemByName(prisma, kg.id, 'Chicken Roll');
  student = await newStudent(app, prisma);
  otherStudent = await newStudent(app, prisma);
});
afterAll(() => prisma.$disconnect());

const initiate = (orderId: string, actor = student) =>
  request(app).post(`/api/payments/${orderId}/initiate`).set(bearer(actor.token));
const mockComplete = (orderId: string, body: object = {}, actor = student) =>
  request(app).post(`/api/payments/${orderId}/mock-complete`).set(bearer(actor.token)).send(body);

describe('mock payment flow', () => {
  it('initiates for the server amount and confirms the order on success', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 2 }]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe(
      'PENDING',
    );

    const init = await initiate(order.id).expect(200);
    expect(init.body.data).toMatchObject({
      provider: 'MOCK',
      amountPaise: 18_000,
      currency: 'INR',
    });
    expect(init.body.data.providerOrderId).toMatch(/^mock_order_/);
    // Initiation is idempotent while pending.
    const again = await initiate(order.id).expect(200);
    expect(again.body.data.providerOrderId).toBe(init.body.data.providerOrderId);

    const done = await mockComplete(order.id, { outcome: 'success' }).expect(200);
    expect(done.body.data.order).toMatchObject({
      status: 'PAYMENT_CONFIRMED',
      payment: { status: 'SUCCESS', amountPaise: 18_000 },
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment).toMatchObject({
      status: 'SUCCESS',
      providerOrderId: init.body.data.providerOrderId,
    });
    expect(payment.providerPaymentId).toMatch(/^mock_pay_/);
    expect(payment.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(payment.paidAt).toBeTruthy();
  });

  it('requires initiation before completion', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    const res = await mockComplete(order.id).expect(409);
    expect(res.body.error.code).toBe('PAYMENT_NOT_INITIATED');
  });

  it('rejects a captured amount that differs from the order total', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    await initiate(order.id).expect(200);
    const res = await mockComplete(order.id, { capturedAmountPaise: 100 }).expect(422);
    expect(res.body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    expect(row.status).toBe('PLACED');
    expect(row.payment?.status).toBe('PENDING');
  });

  it('handles gateway failure and allows retry', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    const first = await initiate(order.id).expect(200);
    const failed = await mockComplete(order.id, { outcome: 'failure' }).expect(422);
    expect(failed.body.error.code).toBe('PAYMENT_FAILED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe(
      'FAILED',
    );

    const retry = await initiate(order.id).expect(200);
    expect(retry.body.data.providerOrderId).not.toBe(first.body.data.providerOrderId);
    await mockComplete(order.id).expect(200);
  });

  it('treats repeated confirmations as idempotent and processes the event once', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    await initiate(order.id).expect(200);
    const done = await mockComplete(order.id).expect(200);
    const confirmation = done.body.data.confirmation;
    const paidAt = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paidAt;

    const replay = await request(app)
      .post(`/api/payments/${order.id}/verify`)
      .set(bearer(student.token))
      .send(confirmation)
      .expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const repeatMock = await mockComplete(order.id).expect(200);
    expect(repeatMock.headers['idempotent-replayed']).toBe('true');

    expect(
      await prisma.processedPaymentEvent.count({
        where: { eventId: `payment.captured:${confirmation.providerPaymentId}` },
      }),
    ).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paidAt).toEqual(
      paidAt,
    );
    expect(
      await prisma.notification.count({ where: { orderId: order.id, type: 'PAYMENT_CONFIRMED' } }),
    ).toBe(1);

    await initiate(order.id).expect(409);
  });

  it('rejects forged signatures and confirmations for another order', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    const init = await initiate(order.id).expect(200);
    const forged = await request(app)
      .post(`/api/payments/${order.id}/verify`)
      .set(bearer(student.token))
      .send({
        providerOrderId: init.body.data.providerOrderId,
        providerPaymentId: 'mock_pay_x',
        signature: 'ab'.repeat(32),
      })
      .expect(422);
    expect(forged.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');

    const wrongOrder = await request(app)
      .post(`/api/payments/${order.id}/verify`)
      .set(bearer(student.token))
      .send({
        providerOrderId: 'mock_order_other',
        providerPaymentId: 'mock_pay_x',
        signature: 'ab'.repeat(32),
      })
      .expect(422);
    expect(wrongOrder.body.error.code).toBe('PAYMENT_ORDER_MISMATCH');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PLACED',
    );
  });

  it('only the ordering student can pay for an order', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    await initiate(order.id, otherStudent).expect(404);
    await mockComplete(order.id, {}, otherStudent).expect(404);
  });

  it('refuses payment initiation when the canteen paused after ordering', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    await prisma.canteen.update({ where: { id: kg.id }, data: { isAcceptingOrders: false } });
    const res = await initiate(order.id).expect(409);
    expect(res.body.error.code).toBe('CANTEEN_NOT_ACCEPTING_ORDERS');
    await prisma.canteen.update({ where: { id: kg.id }, data: { isAcceptingOrders: true } });
  });
});

describe('mock endpoint exposure', () => {
  it('is not mounted unless PAYMENT_MODE=mock', async () => {
    const ctx = buildTestContext({
      env: {
        PAYMENT_MODE: 'razorpay',
        RAZORPAY_KEY_ID: 'rzp_test_key',
        RAZORPAY_KEY_SECRET: 'test-key-secret',
        RAZORPAY_WEBHOOK_SECRET: 'test-webhook-secret',
      },
    });
    const razorpayApp = createApp(ctx);
    try {
      const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
      await request(razorpayApp)
        .post(`/api/payments/${order.id}/mock-complete`)
        .set(bearer(student.token))
        .send({})
        .expect(404);
      // Razorpay API calls are not implemented: initiation fails honestly with 503.
      const init = await request(razorpayApp)
        .post(`/api/payments/${order.id}/initiate`)
        .set(bearer(student.token))
        .expect(503);
      expect(init.body.error.code).toBe('PAYMENT_PROVIDER_NOT_IMPLEMENTED');
    } finally {
      await ctx.prisma.$disconnect();
    }
  });
});

describe('payment webhooks (replay protection)', () => {
  it('returns 404 when the Razorpay provider is not configured', async () => {
    await request(app)
      .post('/api/payments/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(404);
  });

  it('verifies the raw-body signature and processes each event id once', async () => {
    const webhookSecret = 'test-webhook-secret';
    const provider = new RazorpayPaymentProvider({
      keyId: 'rzp_test',
      keySecret: 'test-key-secret',
      webhookSecret,
    });
    const ctx = { ...buildTestContext(), payments: provider };
    const webhookApp = createApp(ctx);
    try {
      // An order whose payment was created with the Razorpay provider.
      const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
      await prisma.payment.update({
        where: { orderId: order.id },
        data: { provider: 'RAZORPAY', providerOrderId: 'order_TEST123' },
      });
      const body = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: { entity: { id: 'pay_TEST123', order_id: 'order_TEST123', amount: 9_000 } },
        },
      });
      const send = (signature: string, eventId = 'evt_TEST_1') =>
        request(webhookApp)
          .post('/api/payments/webhooks/razorpay')
          .set('Content-Type', 'application/json')
          .set('X-Razorpay-Signature', signature)
          .set('X-Razorpay-Event-Id', eventId)
          .send(body);

      const bad = await send('00'.repeat(32)).expect(422);
      expect(bad.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');

      const signature = hmacSha256Hex(webhookSecret, body);
      const first = await send(signature).expect(200);
      expect(first.body.data).toMatchObject({ processed: true });
      const replay = await send(signature).expect(200);
      expect(replay.body.data).toMatchObject({ processed: false, reason: 'duplicate' });

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { payment: true },
      });
      expect(row.status).toBe('PAYMENT_CONFIRMED');
      expect(row.payment).toMatchObject({ status: 'SUCCESS', providerPaymentId: 'pay_TEST123' });
      expect(await prisma.processedPaymentEvent.count({ where: { eventId: 'evt_TEST_1' } })).toBe(
        1,
      );
    } finally {
      await ctx.prisma.$disconnect();
    }
  });
});
