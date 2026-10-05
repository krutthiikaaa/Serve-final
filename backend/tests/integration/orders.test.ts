import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { createApp } from '../../src/app.js';
import { MockPaymentProvider } from '../../src/modules/payments/mock.provider.js';
import { buildTestApp, buildTestContext } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  idempotencyKey,
  itemByName,
  newAdmin,
  newApprovedStaff,
  newStudent,
  payOrder,
  placeOrder,
  type Actor,
} from '../helpers/actors.js';

const { app, prisma, env } = buildTestApp();

let admin: Actor;
let student: Actor;
let otherStudent: Actor;
let staffKG: Actor;
let staffYN: Actor;
let kg: { id: string };
let yn: { id: string };
let sandwich: { id: string }; // ₹50 at K&G
let coffee: { id: string }; // ₹30 at K&G

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  yn = await canteenBySlug(prisma, 'yamuna-narmada');
  sandwich = await itemByName(prisma, kg.id, 'Veg Grilled Sandwich');
  coffee = await itemByName(prisma, kg.id, 'Coffee');
  admin = await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
  otherStudent = await newStudent(app, prisma, 'Yamuna');
  staffKG = await newApprovedStaff(app, admin, kg.id);
  staffYN = await newApprovedStaff(app, admin, yn.id);
});
afterAll(() => prisma.$disconnect());

const quote = (body: object, actor = student) =>
  request(app).post('/api/cart/quote').set(bearer(actor.token)).send(body);

describe('cart quote', () => {
  it('prices the cart from the database', async () => {
    const res = await quote({
      canteenId: kg.id,
      items: [
        { menuItemId: sandwich.id, quantity: 2 },
        { menuItemId: coffee.id, quantity: 3 },
      ],
    }).expect(200);
    expect(res.body.data).toMatchObject({
      canteen: { id: kg.id, name: 'Krishna & Godavari Night Canteen' },
      itemCount: 5,
      subtotalPaise: 2 * 5_000 + 3 * 3_000,
      totalPaise: 2 * 5_000 + 3 * 3_000,
      currency: 'INR',
    });
    expect(res.body.data.items[0]).toMatchObject({
      menuItemId: sandwich.id,
      itemName: 'Veg Grilled Sandwich',
      unitPricePaise: 5_000,
      quantity: 2,
      lineTotalPaise: 10_000,
    });
  });

  it('rejects client-submitted prices and totals instead of trusting them', async () => {
    for (const body of [
      { canteenId: kg.id, totalPaise: 1, items: [{ menuItemId: sandwich.id, quantity: 1 }] },
      { canteenId: kg.id, items: [{ menuItemId: sandwich.id, quantity: 1, pricePaise: 1 }] },
      { canteenId: kg.id, items: [{ menuItemId: sandwich.id, quantity: 1, unitPricePaise: 1 }] },
      { canteenId: kg.id, items: [{ menuItemId: sandwich.id, quantity: 1, lineTotalPaise: 1 }] },
    ]) {
      const res = await quote(body).expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects non-numeric, infinite and oversized values', async () => {
    for (const quantity of ['2', null, 'NaN', 'Infinity', 1e9]) {
      await quote({ canteenId: kg.id, items: [{ menuItemId: sandwich.id, quantity }] }).expect(422);
    }
    const tooMany = Array.from({ length: 51 }, () => ({ menuItemId: sandwich.id, quantity: 1 }));
    await quote({ canteenId: kg.id, items: tooMany }).expect(422);
  });

  it('reports every problem item with a reason', async () => {
    const off = await itemByName(prisma, kg.id, 'Banana Fresh Juice');
    const gone = await itemByName(prisma, kg.id, 'Muskmelon Fresh Juice');
    await prisma.menuItem.update({ where: { id: off.id }, data: { isAvailable: false } });
    await prisma.menuItem.update({ where: { id: gone.id }, data: { isActive: false } });
    try {
      const res = await quote({
        canteenId: kg.id,
        items: [
          { menuItemId: sandwich.id, quantity: 1 },
          { menuItemId: off.id, quantity: 1 },
          { menuItemId: gone.id, quantity: 1 },
        ],
      }).expect(422);
      expect(res.body.error).toMatchObject({
        code: 'ITEM_UNAVAILABLE',
        details: {
          items: [
            { menuItemId: off.id, reason: 'UNAVAILABLE' },
            { menuItemId: gone.id, reason: 'INACTIVE' },
          ],
        },
      });
    } finally {
      await prisma.menuItem.updateMany({
        where: { id: { in: [off.id, gone.id] } },
        data: { isAvailable: true, isActive: true },
      });
    }
  });

  it('rejects invalid quantities, duplicates, foreign and unknown items', async () => {
    for (const quantity of [0, 21, 1.5, -1]) {
      await quote({ canteenId: kg.id, items: [{ menuItemId: sandwich.id, quantity }] }).expect(422);
    }
    const dup = await quote({
      canteenId: kg.id,
      items: [
        { menuItemId: sandwich.id, quantity: 1 },
        { menuItemId: sandwich.id, quantity: 1 },
      ],
    }).expect(422);
    expect(dup.body.error.code).toBe('DUPLICATE_ITEM');

    const ynItem = await itemByName(prisma, yn.id, 'Coffee');
    const foreign = await quote({
      canteenId: kg.id,
      items: [{ menuItemId: ynItem.id, quantity: 1 }],
    }).expect(422);
    expect(foreign.body.error).toMatchObject({
      code: 'ITEM_NOT_FOUND',
      details: { items: [{ menuItemId: ynItem.id, reason: 'NOT_IN_CANTEEN' }] },
    });

    await quote({ canteenId: kg.id, items: [] }).expect(422);
    await quote({
      canteenId: '00000000-0000-4000-8000-000000000000',
      items: [{ menuItemId: sandwich.id, quantity: 1 }],
    }).expect(404);
  });

  it('is student-only', async () => {
    await quote(
      { canteenId: kg.id, items: [{ menuItemId: sandwich.id, quantity: 1 }] },
      staffKG,
    ).expect(403);
    await request(app).post('/api/cart/quote').send({}).expect(401);
  });
});

describe('order creation', () => {
  it('creates the order, snapshots and a PENDING payment with a server-calculated total', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', idempotencyKey())
      .send({
        canteenId: kg.id,
        items: [
          { menuItemId: sandwich.id, quantity: 2 },
          { menuItemId: coffee.id, quantity: 1 },
        ],
      })
      .expect(201);

    const order = res.body.data;
    expect(order).toMatchObject({
      status: 'PLACED',
      totalPaise: 13_000,
      canteen: { id: kg.id },
      payment: { status: 'PENDING', provider: 'MOCK', amountPaise: 13_000 },
    });
    expect(order.orderNumber).toMatch(/^SV\d+$/);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true, payment: true },
    });
    expect(row.studentId).toBe(student.id); // owner comes from the verified token
    expect(
      row.items.map((i) => [i.itemName, i.unitPricePaise, i.quantity, i.lineTotalPaise]).sort(),
    ).toEqual(
      [
        ['Coffee', 3_000, 1, 3_000],
        ['Veg Grilled Sandwich', 5_000, 2, 10_000],
      ].sort(),
    );
    expect(row.payment?.amountPaise).toBe(13_000);

    const notes = await prisma.notification.findMany({
      where: { studentId: student.id, orderId: order.id },
    });
    expect(notes.map((n) => n.type)).toEqual(['ORDER_PLACED']);
  });

  it('keeps historical snapshots when the price changes later', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    await request(app)
      .patch(`/api/staff/menu/items/${coffee.id}/price`)
      .set(bearer(staffKG.token))
      .send({ pricePaise: 3_300 })
      .expect(200);
    const res = await request(app)
      .get(`/api/orders/${order.id}`)
      .set(bearer(student.token))
      .expect(200);
    expect(res.body.data.items[0]).toMatchObject({ itemName: 'Coffee', unitPricePaise: 3_000 });
    expect(res.body.data.totalPaise).toBe(3_000);
    await request(app)
      .patch(`/api/staff/menu/items/${coffee.id}/price`)
      .set(bearer(staffKG.token))
      .send({ pricePaise: 3_000 })
      .expect(200);
  });

  it('requires a valid Idempotency-Key', async () => {
    const body = { canteenId: kg.id, items: [{ menuItemId: coffee.id, quantity: 1 }] };
    const missing = await request(app)
      .post('/api/orders')
      .set(bearer(student.token))
      .send(body)
      .expect(400);
    expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const bad = await request(app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', 'no!')
      .send(body)
      .expect(422);
    expect(bad.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('never creates duplicates for a repeated Idempotency-Key', async () => {
    const key = idempotencyKey();
    const body = { canteenId: kg.id, items: [{ menuItemId: sandwich.id, quantity: 1 }] };
    const send = () =>
      request(app)
        .post('/api/orders')
        .set(bearer(student.token))
        .set('Idempotency-Key', key)
        .send(body);

    const first = await send().expect(201);
    const second = await send().expect(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);

    // Concurrent duplicates also collapse to one order.
    const raceKey = idempotencyKey();
    const racers = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/orders')
          .set(bearer(student.token))
          .set('Idempotency-Key', raceKey)
          .send(body),
      ),
    );
    expect(new Set(racers.map((r) => r.body.data.id)).size).toBe(1);
    expect(await prisma.order.count({ where: { idempotencyKey: { in: [key, raceKey] } } })).toBe(2);

    const reuse = await request(app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', key)
      .send({ canteenId: kg.id, items: [{ menuItemId: coffee.id, quantity: 5 }] })
      .expect(422);
    expect(reuse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('scopes idempotency keys per student', async () => {
    const key = idempotencyKey();
    const body = { canteenId: kg.id, items: [{ menuItemId: coffee.id, quantity: 1 }] };
    const a = await request(app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const b = await request(app)
      .post('/api/orders')
      .set(bearer(otherStudent.token))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });

  it('rejects unavailable and disabled items', async () => {
    const juice = await itemByName(prisma, kg.id, 'Grape Fresh Juice');
    await request(app)
      .patch(`/api/staff/menu/items/${juice.id}/availability`)
      .set(bearer(staffKG.token))
      .send({ isAvailable: false })
      .expect(200);
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', idempotencyKey())
      .send({ canteenId: kg.id, items: [{ menuItemId: juice.id, quantity: 1 }] })
      .expect(422);
    expect(res.body.error).toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      message: 'This item is currently unavailable.',
    });
    await request(app)
      .patch(`/api/staff/menu/items/${juice.id}/availability`)
      .set(bearer(staffKG.token))
      .send({ isAvailable: true })
      .expect(200);
  });

  it('rejects orders when the canteen is paused or inactive', async () => {
    const body = { canteenId: kg.id, items: [{ menuItemId: coffee.id, quantity: 1 }] };
    await request(app)
      .patch('/api/staff/canteen/status')
      .set(bearer(staffKG.token))
      .send({ isAcceptingOrders: false })
      .expect(200);
    const paused = await request(app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', idempotencyKey())
      .send(body)
      .expect(409);
    expect(paused.body.error).toMatchObject({
      code: 'CANTEEN_NOT_ACCEPTING_ORDERS',
      message: 'This canteen is currently not accepting orders.',
    });
    const menu = await request(app)
      .get(`/api/canteens/${kg.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    expect(menu.body.data.canteen.status).toBe('PAUSED');
    expect(menu.body.data.categories[0].items[0].isOrderable).toBe(false);
    await request(app)
      .patch('/api/staff/canteen/status')
      .set(bearer(staffKG.token))
      .send({ isAcceptingOrders: true })
      .expect(200);

    await request(app)
      .patch(`/api/admin/canteens/${kg.id}`)
      .set(bearer(admin.token))
      .send({ isActive: false })
      .expect(200);
    const inactive = await request(app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', idempotencyKey())
      .send(body);
    // Inactive canteens are invisible to students -> 409 from pricing.
    expect(inactive.status).toBe(409);
    expect(inactive.body.error.code).toBe('CANTEEN_INACTIVE');
    const resume = await request(app)
      .patch('/api/staff/canteen/status')
      .set(bearer(staffKG.token))
      .send({ isAcceptingOrders: true })
      .expect(409);
    expect(resume.body.error.code).toBe('CANTEEN_INACTIVE');
    await request(app)
      .patch(`/api/admin/canteens/${kg.id}`)
      .set(bearer(admin.token))
      .send({ isActive: true })
      .expect(200);
  });

  it('lets students order from any active, accepting canteen (not just their hostel’s)', async () => {
    const ynSandwich = await itemByName(prisma, yn.id, 'Paneer Grilled Sandwich');
    const order = await placeOrder(app, student, yn.id, [
      { menuItemId: ynSandwich.id, quantity: 1 },
    ]);
    expect(order.totalPaise).toBe(7_500);
  });
});

describe('order access control', () => {
  it('students see only their own orders', async () => {
    const mine = await placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    const res = await request(app)
      .get(`/api/orders/${mine.id}`)
      .set(bearer(otherStudent.token))
      .expect(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    const list = await request(app)
      .get('/api/orders?limit=100')
      .set(bearer(otherStudent.token))
      .expect(200);
    expect(list.body.data.map((o: { id: string }) => o.id)).not.toContain(mine.id);
  });

  it('paginates order history', async () => {
    const page1 = await request(app)
      .get('/api/orders?limit=2')
      .set(bearer(student.token))
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await request(app)
      .get(`/api/orders?limit=2&cursor=${page1.body.nextCursor}`)
      .set(bearer(student.token))
      .expect(200);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
    await request(app).get('/api/orders?limit=1000').set(bearer(student.token)).expect(422);
  });

  it('staff see only paid orders of their own canteen', async () => {
    const unpaid = await placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    await request(app).get(`/api/staff/orders/${unpaid.id}`).set(bearer(staffKG.token)).expect(404);

    await payOrder(app, student, unpaid.id);
    await request(app).get(`/api/staff/orders/${unpaid.id}`).set(bearer(staffKG.token)).expect(200);
    const cross = await request(app)
      .get(`/api/staff/orders/${unpaid.id}`)
      .set(bearer(staffYN.token))
      .expect(404);
    expect(cross.body.error.code).toBe('ORDER_NOT_FOUND');

    const ynList = await request(app)
      .get('/api/staff/orders?limit=100')
      .set(bearer(staffYN.token))
      .expect(200);
    expect(ynList.body.data.every((o: { canteen: { id: string } }) => o.canteen.id === yn.id)).toBe(
      true,
    );
    const kgList = await request(app)
      .get('/api/staff/orders?limit=100')
      .set(bearer(staffKG.token))
      .expect(200);
    expect(kgList.body.data.map((o: { id: string }) => o.id)).toContain(unpaid.id);
    expect(kgList.body.data.every((o: { status: string }) => o.status !== 'PLACED')).toBe(true);
  });

  it('admins can read any order', async () => {
    const order = await placeOrder(app, otherStudent, yn.id, [
      { menuItemId: (await itemByName(prisma, yn.id, 'Coffee')).id, quantity: 1 },
    ]);
    const res = await request(app)
      .get(`/api/admin/orders/${order.id}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(res.body.data.student).toMatchObject({ id: otherStudent.id });
    await request(app).get(`/api/admin/orders/${order.id}`).set(bearer(student.token)).expect(403);
  });
});

describe('order status transitions', () => {
  it('follows PAYMENT_CONFIRMED -> PREPARING -> READY -> COLLECTED with timestamps and notifications', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: sandwich.id, quantity: 1 }]);
    await payOrder(app, student, order.id);
    for (const status of ['PREPARING', 'READY', 'COLLECTED']) {
      const res = await request(app)
        .patch(`/api/staff/orders/${order.id}/status`)
        .set(bearer(staffKG.token))
        .send({ status })
        .expect(200);
      expect(res.body.data.status).toBe(status);
    }
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.paidAt && row.preparingAt && row.readyAt && row.collectedAt).toBeTruthy();
    const notes = await prisma.notification.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(notes.map((n) => n.type)).toEqual([
      'ORDER_PLACED',
      'PAYMENT_CONFIRMED',
      'ORDER_PREPARING',
      'ORDER_READY',
      'ORDER_COLLECTED',
    ]);
    expect(notes[3]?.message).toContain('Your order is ready for pickup');
  });

  it('rejects invalid transitions', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: sandwich.id, quantity: 1 }]);
    await payOrder(app, student, order.id);
    const skip = await request(app)
      .patch(`/api/staff/orders/${order.id}/status`)
      .set(bearer(staffKG.token))
      .send({ status: 'READY' })
      .expect(409);
    expect(skip.body.error).toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
      details: { from: 'PAYMENT_CONFIRMED', to: 'READY' },
    });

    for (const status of ['PREPARING', 'READY', 'COLLECTED']) {
      await request(app)
        .patch(`/api/staff/orders/${order.id}/status`)
        .set(bearer(staffKG.token))
        .send({ status })
        .expect(200);
    }
    for (const status of ['PREPARING', 'READY', 'CANCELLED']) {
      await request(app)
        .patch(`/api/staff/orders/${order.id}/status`)
        .set(bearer(staffKG.token))
        .send({ status })
        .expect(409);
    }
    // Staff can never set payment states.
    for (const status of ['PLACED', 'PAYMENT_CONFIRMED', 'SHIPPED']) {
      await request(app)
        .patch(`/api/staff/orders/${order.id}/status`)
        .set(bearer(staffKG.token))
        .send({ status })
        .expect(422);
    }
  });

  it('staff of another canteen cannot change the status', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: sandwich.id, quantity: 1 }]);
    await payOrder(app, student, order.id);
    await request(app)
      .patch(`/api/staff/orders/${order.id}/status`)
      .set(bearer(staffYN.token))
      .send({ status: 'PREPARING' })
      .expect(404);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PAYMENT_CONFIRMED',
    );
  });

  it('students cannot set order status', async () => {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: sandwich.id, quantity: 1 }]);
    await request(app)
      .patch(`/api/staff/orders/${order.id}/status`)
      .set(bearer(student.token))
      .send({ status: 'COLLECTED' })
      .expect(403);
  });

  it('cancellation: students cancel unpaid orders; staff cancel paid ones with a refund', async () => {
    const unpaid = await placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    const cancelled = await request(app)
      .post(`/api/orders/${unpaid.id}/cancel`)
      .set(bearer(student.token))
      .expect(200);
    expect(cancelled.body.data).toMatchObject({
      status: 'CANCELLED',
      payment: { status: 'FAILED' },
    });
    await request(app)
      .post(`/api/orders/${unpaid.id}/cancel`)
      .set(bearer(student.token))
      .expect(409);

    const paid = await placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    await payOrder(app, student, paid.id);
    await request(app).post(`/api/orders/${paid.id}/cancel`).set(bearer(student.token)).expect(409);
    const byStaff = await request(app)
      .patch(`/api/staff/orders/${paid.id}/status`)
      .set(bearer(staffKG.token))
      .send({ status: 'CANCELLED', reason: 'Out of milk' })
      .expect(200);
    expect(byStaff.body.data).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Out of milk',
      payment: { status: 'REFUNDED' },
    });
  });
});

describe('staff dashboard', () => {
  it('reports counts and revenue for the assigned canteen only', async () => {
    const res = await request(app)
      .get('/api/staff/dashboard')
      .set(bearer(staffKG.token))
      .expect(200);
    expect(res.body.data.canteen.id).toBe(kg.id);
    expect(res.body.data.today.orderCount).toBeGreaterThan(0);
    expect(res.body.data.today.revenuePaise).toBeGreaterThan(0);
    const fromDb = await prisma.order.aggregate({
      where: { canteenId: kg.id, status: { notIn: ['PLACED', 'CANCELLED'] } },
      _sum: { totalPaise: true },
    });
    expect(res.body.data.today.revenuePaise).toBe(fromDb._sum.totalPaise);
  });
});

describe('audit: transitions, concurrency, limits, refunds', () => {
  async function paidOrder() {
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: sandwich.id, quantity: 1 }]);
    await payOrder(app, student, order.id);
    return order;
  }
  const setStatus = (orderId: string, status: string, actor = staffKG) =>
    request(app)
      .patch(`/api/staff/orders/${orderId}/status`)
      .set(bearer(actor.token))
      .send({ status });

  it('rejects COLLECTED->PREPARING/READY and CANCELLED->PREPARING/READY', async () => {
    const collected = await paidOrder();
    for (const status of ['PREPARING', 'READY', 'COLLECTED'])
      await setStatus(collected.id, status).expect(200);
    for (const status of ['PREPARING', 'READY']) {
      const res = await setStatus(collected.id, status).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
        details: { from: 'COLLECTED', to: status },
      });
    }

    const cancelled = await paidOrder();
    await setStatus(cancelled.id, 'CANCELLED').expect(200);
    for (const status of ['PREPARING', 'READY']) {
      const res = await setStatus(cancelled.id, status).expect(409);
      expect(res.body.error.details).toEqual({ from: 'CANCELLED', to: status });
    }
  });

  it('rejects moving back to PLACED (READY->PLACED, PREPARING->PLACED)', async () => {
    const order = await paidOrder();
    await setStatus(order.id, 'PREPARING').expect(200);
    expect((await setStatus(order.id, 'PLACED').expect(422)).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    await setStatus(order.id, 'READY').expect(200);
    await setStatus(order.id, 'PLACED').expect(422);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'READY',
    );
  });

  it('lets exactly one of several concurrent identical updates win', async () => {
    const order = await paidOrder();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => setStatus(order.id, 'PREPARING')),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PREPARING',
    );
    expect(
      await prisma.notification.count({ where: { orderId: order.id, type: 'ORDER_PREPARING' } }),
    ).toBe(1);
  });

  it('keeps payment and order consistent when PREPARING and CANCELLED race', async () => {
    for (let round = 0; round < 3; round += 1) {
      const order = await paidOrder();
      const [a, b] = await Promise.all([
        setStatus(order.id, 'PREPARING'),
        setStatus(order.id, 'CANCELLED'),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { payment: true },
      });
      if (row.status === 'CANCELLED') expect(row.payment?.status).toBe('REFUNDED');
      else {
        expect(row.status).toBe('PREPARING');
        expect(row.payment?.status).toBe('SUCCESS'); // no refund for an order being prepared
      }
    }
  });

  it('exposes a status timeline for tracking screens', async () => {
    const order = await paidOrder();
    await setStatus(order.id, 'PREPARING').expect(200);
    const res = await request(app)
      .get(`/api/orders/${order.id}`)
      .set(bearer(student.token))
      .expect(200);
    expect(res.body.data.timeline.map((t: { status: string }) => t.status)).toEqual([
      'PLACED',
      'PAYMENT_CONFIRMED',
      'PREPARING',
    ]);
  });

  it('caps the order total (no integer overflow, clear error)', async () => {
    const items = await prisma.menuItem.findMany({
      where: { canteenId: kg.id, isActive: true },
      take: 6,
    });
    const before = items.map((i) => [i.id, i.pricePaise] as const);
    await prisma.menuItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { pricePaise: 1_000_000 },
    });
    try {
      const res = await quote({
        canteenId: kg.id,
        items: items.map((i) => ({ menuItemId: i.id, quantity: 20 })),
      }).expect(422);
      expect(res.body.error.code).toBe('ORDER_TOTAL_TOO_LARGE');
      const atCap = await quote({
        canteenId: kg.id,
        items: items.slice(0, 5).map((i) => ({ menuItemId: i.id, quantity: 20 })),
      }).expect(200);
      expect(atCap.body.data.totalPaise).toBe(100_000_000);
    } finally {
      for (const [id, pricePaise] of before)
        await prisma.menuItem.update({ where: { id }, data: { pricePaise } });
    }
    await request(app)
      .patch(`/api/staff/menu/items/${sandwich.id}/price`)
      .set(bearer(staffKG.token))
      .send({ pricePaise: 1_000_001 })
      .expect(422);
  });

  it('isolates staff dashboard statistics per canteen', async () => {
    const res = await request(app)
      .get('/api/staff/dashboard')
      .set(bearer(staffYN.token))
      .expect(200);
    const ynRevenue = await prisma.order.aggregate({
      where: { canteenId: yn.id, status: { notIn: ['PLACED', 'CANCELLED'] } },
      _sum: { totalPaise: true },
    });
    expect(res.body.data.canteen.id).toBe(yn.id);
    expect(res.body.data.today.revenuePaise).toBe(ynRevenue._sum.totalPaise ?? 0);
  });
});

describe('audit: refund failure after cancellation', () => {
  it('keeps the order cancelled and records the pending refund instead of hiding it', async () => {
    class FailingRefundProvider extends MockPaymentProvider {
      override refund(): Promise<{ refundId: string }> {
        return Promise.reject(new Error('provider down'));
      }
    }
    const ctx = { ...buildTestContext(), payments: new FailingRefundProvider(env.PAYMENT_SECRET!) };
    const failingApp = createApp(ctx);
    try {
      const order = await placeOrder(failingApp, student, kg.id, [
        { menuItemId: coffee.id, quantity: 1 },
      ]);
      await payOrder(failingApp, student, order.id);
      const res = await request(failingApp)
        .patch(`/api/staff/orders/${order.id}/status`)
        .set(bearer(staffKG.token))
        .send({ status: 'CANCELLED' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        status: 'CANCELLED',
        payment: {
          status: 'SUCCESS',
          failureReason: 'Refund pending: the payment provider refund failed',
        },
      });
    } finally {
      await ctx.prisma.$disconnect();
    }
  });
});
