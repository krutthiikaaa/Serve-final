import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import { receiptSchema } from '../helpers/contract.js';
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
let kitchen: Actor;
let kg: { id: string; name: string };
let yn: { id: string; name: string };
let coffee: { id: string };

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  yn = await canteenBySlug(prisma, 'yamuna-narmada');
  coffee = await itemByName(prisma, kg.id, 'Coffee');
  admin = await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
  cashier = await newApprovedStaff(app, admin, kg.id);
  kitchen = await newApprovedStaff(app, admin, kg.id);
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
  await request(app)
    .put(`/api/admin/staff/${kitchen.id}/assignments`)
    .set(bearer(admin.token))
    .send({
      primaryCanteenId: kg.id,
      assignments: [{ canteenId: kg.id, capabilities: ['KITCHEN'] }],
    })
    .expect(200);
});
afterAll(() => prisma.$disconnect());

describe('staff assignments on /auth/me and canteen switching', () => {
  it('returns assigned canteens and capabilities without granting extras on switch', async () => {
    const me = await request(app).get('/api/auth/me').set(bearer(cashier.token)).expect(200);
    expect(me.body.data.canteen.id).toBe(kg.id);
    expect(me.body.data.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canteenId: kg.id,
          capabilities: ['CASHIER'],
        }),
        expect.objectContaining({
          canteenId: yn.id,
          capabilities: ['CASHIER'],
        }),
      ]),
    );
  });

  it('rejects an unassigned canteen id', async () => {
    const res = await request(app)
      .get(`/api/staff/dashboard?canteenId=${yn.id}`)
      .set(bearer(kitchen.token))
      .expect(403);
    expect(res.body.error.code).toBe('CANTEEN_NOT_ASSIGNED');
  });
});

describe('app order cashier confirmation', () => {
  it('keeps unpaid orders out of the kitchen and confirms only once', async () => {
    const placed = await placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);

    await request(app)
      .get('/api/staff/orders?status=active')
      .set(bearer(kitchen.token))
      .expect(200)
      .then((res) => {
        expect(res.body.data.map((row: { id: string }) => row.id)).not.toContain(placed.id);
      });

    const pending = await request(app)
      .get('/api/staff/payments/pending')
      .set(bearer(cashier.token))
      .expect(200);
    const row = pending.body.data.find((item: { id: string }) => item.id === placed.id);
    expect(row.status).toBe('PLACED');
    expect(row.payment.status).toBe('PENDING');
    expect(row.receiptNumber).toBeNull();

    await request(app)
      .post(`/api/payments/${placed.id}/claim`)
      .set(bearer(student.token))
      .send({ utr: 'AXIS123456789' })
      .expect(200);

    await request(app)
      .post(`/api/staff/orders/${placed.id}/confirm-demo-payment`)
      .set(bearer(kitchen.token))
      .send({ simulatedPaymentReceived: true })
      .expect(403);

    const liveRejected = await request(app)
      .post(`/api/staff/orders/${placed.id}/confirm-payment`)
      .set(bearer(cashier.token))
      .send({ paymentReceived: true, utr: 'AXIS123456789' })
      .expect(409);
    expect(liveRejected.body.error.code).toBe('LIVE_CONFIRMATION_NOT_ALLOWED');

    const confirmed = await request(app)
      .post(`/api/staff/orders/${placed.id}/confirm-demo-payment`)
      .set(bearer(cashier.token))
      .send({ simulatedPaymentReceived: true, utr: 'AXIS123456789' })
      .expect(200);
    expect(confirmed.body.data.order.status).toBe('PAYMENT_CONFIRMED');
    expect(confirmed.body.data.order.payment.status).toBe('SUCCESS');
    expect(confirmed.body.data.order.payment.isSimulated).toBe(true);
    expect(confirmed.body.data.order.payment.utr).toBe('AXIS123456789');
    expect(confirmed.body.data.receipt.receiptNumber).toMatch(/^RC\d+$/);
    expect(confirmed.body.data.receipt.simulated).toBe(true);
    expect(confirmed.body.data.receipt.notice).toBe('DEMO TRANSACTION — NO REAL PAYMENT');
    receiptSchema.parse(confirmed.body.data.receipt);

    const kitchenList = await request(app)
      .get('/api/staff/orders?status=PAYMENT_CONFIRMED')
      .set(bearer(kitchen.token))
      .expect(200);
    expect(kitchenList.body.data.map((row: { id: string }) => row.id)).toContain(placed.id);

    const duplicate = await request(app)
      .post(`/api/staff/orders/${placed.id}/confirm-demo-payment`)
      .set(bearer(cashier.token))
      .send({ simulatedPaymentReceived: true })
      .expect(409);
    expect(duplicate.body.error.code).toBe('PAYMENT_ALREADY_CONFIRMED');

    const receiptAgain = await request(app)
      .get(`/api/staff/orders/${placed.id}/receipt`)
      .set(bearer(cashier.token))
      .expect(200);
    expect(receiptAgain.body.data.receiptNumber).toBe(confirmed.body.data.receipt.receiptNumber);
  });

  it('rejected payments never enter the kitchen queue', async () => {
    const placed = await placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    await request(app)
      .post(`/api/staff/orders/${placed.id}/reject-payment`)
      .set(bearer(cashier.token))
      .send({ reason: 'No credit on merchant account' })
      .expect(200)
      .then((res) => {
        expect(res.body.data.payment.status).toBe('FAILED');
        expect(res.body.data.status).toBe('PLACED');
      });

    const kitchenList = await request(app)
      .get('/api/staff/orders?status=active')
      .set(bearer(kitchen.token))
      .expect(200);
    expect(kitchenList.body.data.map((row: { id: string }) => row.id)).not.toContain(placed.id);

    await request(app)
      .get(`/api/staff/orders/${placed.id}/receipt`)
      .set(bearer(cashier.token))
      .expect(409);
  });

  it('cannot confirm another canteen payment queue', async () => {
    const placed = await placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    const res = await request(app)
      .post(`/api/staff/orders/${placed.id}/confirm-demo-payment?canteenId=${yn.id}`)
      .set(bearer(cashier.token))
      .send({ simulatedPaymentReceived: true })
      .expect(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });
});

describe('walk-in POS', () => {
  it('prices on the server, confirms payment, and stays out of the kitchen board', async () => {
    const liveRejected = await request(app)
      .post('/api/staff/pos/sales')
      .set(bearer(cashier.token))
      .send({
        servicePeriod: 'NIGHT',
        paymentMethod: 'CASH',
        paymentReceived: true,
        guestName: 'Walk-in guest',
        items: [{ menuItemId: coffee.id, quantity: 2 }],
      })
      .expect(409);
    expect(liveRejected.body.error.code).toBe('LIVE_CONFIRMATION_NOT_ALLOWED');

    const sale = await request(app)
      .post('/api/staff/pos/demo-sales')
      .set(bearer(cashier.token))
      .send({
        servicePeriod: 'NIGHT',
        paymentMethod: 'CASH',
        simulatedPaymentReceived: true,
        guestName: 'Walk-in guest',
        items: [{ menuItemId: coffee.id, quantity: 2 }],
      })
      .expect(201);

    expect(sale.body.data.order.channel).toBe('WALK_IN');
    expect(sale.body.data.order.student).toBeNull();
    expect(sale.body.data.order.status).toBe('PAYMENT_CONFIRMED');
    expect(sale.body.data.order.payment.provider).toBe('CASH');
    expect(sale.body.data.order.payment.isSimulated).toBe(true);
    expect(sale.body.data.receipt.paymentMethod).toBe('CASH');
    expect(sale.body.data.receipt.simulated).toBe(true);
    expect(sale.body.data.order.totalPaise).toBe(sale.body.data.order.items[0].lineTotalPaise);
    receiptSchema.parse(sale.body.data.receipt);

    const kitchenList = await request(app)
      .get('/api/staff/orders?status=active')
      .set(bearer(kitchen.token))
      .expect(200);
    expect(kitchenList.body.data.map((row: { id: string }) => row.id)).not.toContain(
      sale.body.data.order.id,
    );

    const history = await request(app)
      .get('/api/staff/sales?channel=WALK_IN&method=CASH')
      .set(bearer(cashier.token))
      .expect(200);
    expect(history.body.data.map((row: { id: string }) => row.id)).toContain(sale.body.data.order.id);

    await request(app)
      .post('/api/staff/pos/demo-sales')
      .set(bearer(cashier.token))
      .send({
        servicePeriod: 'NIGHT',
        paymentMethod: 'UPI',
        simulatedPaymentReceived: false,
        items: [{ menuItemId: coffee.id, quantity: 1 }],
      })
      .expect(422);
  });

  it('kitchen staff cannot complete a walk-in sale', async () => {
    await request(app)
      .post('/api/staff/pos/demo-sales')
      .set(bearer(kitchen.token))
      .send({
        servicePeriod: 'NIGHT',
        paymentMethod: 'CASH',
        simulatedPaymentReceived: true,
        items: [{ menuItemId: coffee.id, quantity: 1 }],
      })
      .expect(403);
  });
});
