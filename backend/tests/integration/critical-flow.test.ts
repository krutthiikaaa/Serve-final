import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  idempotencyKey,
  newAdmin,
  newPendingStaff,
  newStudent,
  type Actor,
} from '../helpers/actors.js';
import { nextEvent, startTestServer, subscribeMenu, type TestServer } from '../helpers/realtime.js';

/**
 * CRITICAL END-TO-END BACKEND SCENARIO (master spec §57)
 *
 * Real HTTP + Socket.IO server, real PostgreSQL, real Firebase Auth Emulator
 * tokens. Database state is asserted at every critical point. Steps run in
 * order and share state.
 */
let server: TestServer;
let admin: Actor;
let staff: Actor;
let student: Actor;
let kg: { id: string; name: string };
let categoryId: string;
let itemId: string;
let orderId: string;

const findItem = (menu: { categories: { items: { id: string }[] }[] }, id: string) =>
  menu.categories.flatMap((c) => c.items).find((i) => i.id === id) as
    | { id: string; name: string; pricePaise: number; isAvailable: boolean; isOrderable: boolean }
    | undefined;

beforeAll(async () => {
  server = await startTestServer();
  await truncateAll(server.prisma);
  await seedDatabase(server.prisma);
  kg = await canteenBySlug(server.prisma, 'krishna-godavari');
  admin = await newAdmin(server.prisma, server.ctx.env);
  student = await newStudent(server.app, server.prisma, 'Krishna');
});
afterAll(() => server.close());

describe('critical flow: admin -> staff -> student -> payment -> realtime pickup', () => {
  it('1. admin approves staff and assigns Krishna & Godavari Night Canteen', async () => {
    staff = await newPendingStaff(server.app, kg.id);
    const pending = await request(server.app)
      .get('/api/admin/change-requests?status=PENDING')
      .set(bearer(admin.token))
      .expect(200);
    const req = pending.body.data.find((r: { staff: { id: string } }) => r.staff.id === staff.id);
    await request(server.app)
      .post(`/api/admin/change-requests/${req.id}/approve`)
      .set(bearer(admin.token))
      .send({})
      .expect(200);

    const row = await server.prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(row).toMatchObject({ status: 'APPROVED', canteenId: kg.id });
    expect(kg.name).toBe('Krishna & Godavari Night Canteen');
  });

  it('2. staff creates a category and a ₹99 available item (persisted in PostgreSQL)', async () => {
    const category = await request(server.app)
      .post('/api/staff/menu/categories')
      .set(bearer(staff.token))
      .send({ name: 'Test Category' })
      .expect(201);
    categoryId = category.body.data.id;
    const item = await request(server.app)
      .post('/api/staff/menu/items')
      .set(bearer(staff.token))
      .send({ categoryId, name: 'Test Item', pricePaise: 9_900, isAvailable: true })
      .expect(201);
    itemId = item.body.data.id;

    const row = await server.prisma.menuItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { category: true },
    });
    expect(row).toMatchObject({
      name: 'Test Item',
      pricePaise: 9_900,
      isAvailable: true,
      canteenId: kg.id,
    });
    expect(row.category.name).toBe('Test Category');
  });

  it('3. student loads the menu, sees Test Item at ₹99, and the quote is ₹99', async () => {
    const me = await request(server.app).get('/api/auth/me').set(bearer(student.token)).expect(200);
    expect(me.body.data.defaultCanteen.id).toBe(kg.id);

    const menu = await request(server.app)
      .get(`/api/canteens/${kg.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    expect(findItem(menu.body.data, itemId)).toMatchObject({
      name: 'Test Item',
      pricePaise: 9_900,
      isOrderable: true,
    });

    const quote = await request(server.app)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({ canteenId: kg.id, items: [{ menuItemId: itemId, quantity: 1 }] })
      .expect(200);
    expect(quote.body.data.totalPaise).toBe(9_900);
  });

  it('4. staff changes the price to ₹120; the student sees ₹120 (live and on refresh)', async () => {
    const socket = await server.connect(student.token);
    expect((await subscribeMenu(socket, kg.id)).ok).toBe(true);
    const live = nextEvent<{ itemId: string; pricePaise: number }>(
      socket,
      'menu.item_price_changed',
      (p) => p.itemId === itemId,
    );

    await request(server.app)
      .patch(`/api/staff/menu/items/${itemId}/price`)
      .set(bearer(staff.token))
      .send({ pricePaise: 12_000 })
      .expect(200);
    expect((await live).pricePaise).toBe(12_000);
    expect(
      (await server.prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } })).pricePaise,
    ).toBe(12_000);

    const menu = await request(server.app)
      .get(`/api/canteens/${kg.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    expect(findItem(menu.body.data, itemId)?.pricePaise).toBe(12_000);
    socket.disconnect();
  });

  it('5. staff disables the item; the student sees it unavailable and cannot order it', async () => {
    await request(server.app)
      .patch(`/api/staff/menu/items/${itemId}/availability`)
      .set(bearer(staff.token))
      .send({ isAvailable: false })
      .expect(200);
    expect(
      (await server.prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } })).isAvailable,
    ).toBe(false);

    const menu = await request(server.app)
      .get(`/api/canteens/${kg.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    expect(findItem(menu.body.data, itemId)).toMatchObject({
      isAvailable: false,
      isOrderable: false,
    });

    const before = await server.prisma.order.count();
    const res = await request(server.app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', idempotencyKey())
      .send({ canteenId: kg.id, items: [{ menuItemId: itemId, quantity: 2 }] })
      .expect(422);
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
    expect(await server.prisma.order.count()).toBe(before);
  });

  it('6. staff re-enables it; the student orders 2 × ₹120 and the backend calculates ₹240', async () => {
    await request(server.app)
      .patch(`/api/staff/menu/items/${itemId}/availability`)
      .set(bearer(staff.token))
      .send({ isAvailable: true })
      .expect(200);

    // A manipulated client price/total is rejected outright — nothing is written.
    const ordersBefore = await server.prisma.order.count();
    const tampered = await request(server.app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', idempotencyKey())
      .send({
        canteenId: kg.id,
        totalPaise: 100,
        items: [{ menuItemId: itemId, quantity: 2, pricePaise: 1 }],
      })
      .expect(422);
    expect(tampered.body.error.code).toBe('VALIDATION_ERROR');
    expect(await server.prisma.order.count()).toBe(ordersBefore);

    const res = await request(server.app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', idempotencyKey())
      .send({ canteenId: kg.id, items: [{ menuItemId: itemId, quantity: 2 }] })
      .expect(201);
    orderId = res.body.data.id;
    expect(res.body.data).toMatchObject({ status: 'PLACED', totalPaise: 24_000 });

    const row = await server.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, payment: true },
    });
    expect(row.totalPaise).toBe(24_000);
    expect(row.items).toEqual([
      expect.objectContaining({
        itemName: 'Test Item',
        unitPricePaise: 12_000,
        quantity: 2,
        lineTotalPaise: 24_000,
      }),
    ]);
    expect(row.payment).toMatchObject({ status: 'PENDING', amountPaise: 24_000, provider: 'MOCK' });
  });

  it('7. mock payment succeeds; the order is PAYMENT_CONFIRMED and staff receive it in realtime', async () => {
    const staffSocket = await server.connect(staff.token);
    // For staff, order.payment_confirmed is the "new order" signal.
    const newOrder = nextEvent<{ order: { id: string; totalPaise: number; status: string } }>(
      staffSocket,
      'order.payment_confirmed',
      (p) => p.order.id === orderId,
    );

    const init = await request(server.app)
      .post(`/api/payments/${orderId}/initiate`)
      .set(bearer(student.token))
      .expect(200);
    expect(init.body.data.amountPaise).toBe(24_000);
    const done = await request(server.app)
      .post(`/api/payments/${orderId}/mock-complete`)
      .set(bearer(student.token))
      .send({ outcome: 'success' })
      .expect(200);
    expect(done.body.data.order.status).toBe('PAYMENT_CONFIRMED');

    const received = await newOrder;
    expect(received.order).toMatchObject({ totalPaise: 24_000, status: 'PAYMENT_CONFIRMED' });

    const row = await server.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { payment: true },
    });
    expect(row.status).toBe('PAYMENT_CONFIRMED');
    expect(row.paidAt).toBeTruthy();
    expect(row.payment).toMatchObject({ status: 'SUCCESS', amountPaise: 24_000 });
    staffSocket.disconnect();
  });

  it('8. PREPARING -> READY -> COLLECTED reach the student in realtime', async () => {
    const studentSocket = await server.connect(student.token);
    const notifications: { type: string; message: string }[] = [];
    studentSocket.on(
      'notification.created',
      (envelope: { data: { notification: { type: string; message: string } } }) =>
        notifications.push(envelope.data.notification),
    );

    for (const [status, event] of [
      ['PREPARING', 'order.preparing'],
      ['READY', 'order.ready'],
      ['COLLECTED', 'order.collected'],
    ] as const) {
      const update = nextEvent<{ order: { id: string; status: string } }>(
        studentSocket,
        event,
        (p) => p.order.id === orderId,
      );
      await request(server.app)
        .patch(`/api/staff/orders/${orderId}/status`)
        .set(bearer(staff.token))
        .send({ status })
        .expect(200);
      expect((await update).order.status).toBe(status);
      expect((await server.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        status,
      );
    }

    const readyNote = notifications.find((n) => n.type === 'ORDER_READY');
    expect(readyNote?.message).toContain('Your order is ready for pickup');

    const final = await server.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(final.preparingAt && final.readyAt && final.collectedAt).toBeTruthy();
    const detail = await request(server.app)
      .get(`/api/orders/${orderId}`)
      .set(bearer(student.token))
      .expect(200);
    expect(detail.body.data).toMatchObject({ status: 'COLLECTED', totalPaise: 24_000 });
    studentSocket.disconnect();
  });
});
