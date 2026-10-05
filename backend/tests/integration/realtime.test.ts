import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { truncateAll } from '../helpers/db.js';
import { createFirebaseUser } from '../helpers/firebase.js';
import {
  bearer,
  canteenBySlug,
  itemByName,
  newAdmin,
  newApprovedStaff,
  newPendingStaff,
  newStudent,
  payOrder,
  placeOrder,
  type Actor,
} from '../helpers/actors.js';
import {
  nextEvent,
  recordEvents,
  settle,
  startTestServer,
  subscribeMenu,
  type TestServer,
} from '../helpers/realtime.js';

/**
 * Genuine Socket.IO over a real HTTP server, authenticated with Firebase Auth
 * Emulator tokens, backed by PostgreSQL. No polling, no simulated events.
 */
let server: TestServer;
let admin: Actor;
let studentA: Actor;
let studentB: Actor;
let staffKG: Actor;
let staffYN: Actor;
let kg: { id: string };
let yn: { id: string };

beforeAll(async () => {
  server = await startTestServer();
  const { app, prisma, ctx } = server;
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  yn = await canteenBySlug(prisma, 'yamuna-narmada');
  admin = await newAdmin(prisma, ctx.env);
  studentA = await newStudent(app, prisma);
  studentB = await newStudent(app, prisma);
  staffKG = await newApprovedStaff(app, admin, kg.id);
  staffYN = await newApprovedStaff(app, admin, yn.id);
});
afterAll(() => server.close());

describe('socket authentication', () => {
  it('rejects connections without a valid token or account', async () => {
    expect(await server.rejectedConnect(null)).toBe('AUTH_REQUIRED');
    expect(await server.rejectedConnect('garbage.token.value')).toBe('AUTH_TOKEN_INVALID');
    const unregistered = await createFirebaseUser();
    expect(await server.rejectedConnect(unregistered.idToken)).toBe('ACCOUNT_NOT_REGISTERED');
  });

  it('accepts registered users', async () => {
    const socket = await server.connect(studentA.token);
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });
});

describe('order events and room isolation', () => {
  it('delivers a new paid order only to that canteen’s staff, and status updates only to the owner', async () => {
    const [kgStaff, ynStaff, owner, otherStudent, adminSocket] = await Promise.all([
      server.connect(staffKG.token),
      server.connect(staffYN.token),
      server.connect(studentA.token),
      server.connect(studentB.token),
      server.connect(admin.token),
    ]);
    const ynEvents = recordEvents(ynStaff);
    const otherEvents = recordEvents(otherStudent);

    const roll = await itemByName(server.prisma, kg.id, 'Chicken Roll');
    const order = await placeOrder(server.app, studentA, kg.id, [
      { menuItemId: roll.id, quantity: 1 },
    ]);
    const created = nextEvent<{ order: { id: string; status: string } }>(
      kgStaff,
      'order:created',
      (p) => p.order.id === order.id,
    );
    const adminCreated = nextEvent<{ order: { id: string } }>(
      adminSocket,
      'order:created',
      (p) => p.order.id === order.id,
    );
    const confirmed = nextEvent<{ orderId: string; status: string }>(
      owner,
      'order:status_updated',
      (p) => p.orderId === order.id,
    );
    await payOrder(server.app, studentA, order.id);

    expect((await created).order.status).toBe('PAYMENT_CONFIRMED');
    await adminCreated;
    expect((await confirmed).status).toBe('PAYMENT_CONFIRMED');

    const preparing = nextEvent<{ orderId: string; status: string }>(
      owner,
      'order:status_updated',
      (p) => p.status === 'PREPARING',
    );
    await request(server.app)
      .patch(`/api/staff/orders/${order.id}/status`)
      .set(bearer(staffKG.token))
      .send({ status: 'PREPARING' })
      .expect(200);
    const event = await preparing;
    expect(event).toMatchObject({
      orderId: order.id,
      previousStatus: 'PAYMENT_CONFIRMED',
      canteenId: kg.id,
    });

    await settle();
    expect(ynEvents.filter((e) => e.name.startsWith('order:'))).toEqual([]);
    expect(
      otherEvents.filter((e) => e.name.startsWith('order:') || e.name === 'notification:created'),
    ).toEqual([]);
    for (const socket of [kgStaff, ynStaff, owner, otherStudent, adminSocket]) socket.disconnect();
  });

  it('emits only after the database commit, and never for rejected changes', async () => {
    const owner = await server.connect(studentA.token);
    const events = recordEvents(owner);
    const roll = await itemByName(server.prisma, kg.id, 'Egg Roll');
    const order = await placeOrder(server.app, studentA, kg.id, [
      { menuItemId: roll.id, quantity: 1 },
    ]);
    await payOrder(server.app, studentA, order.id);

    // The committed state is visible to anyone reacting to the event.
    const ready = new Promise<string>((resolve) => {
      owner.on('order:status_updated', (payload: { orderId: string; status: string }) => {
        if (payload.orderId !== order.id || payload.status !== 'PREPARING') return;
        void server.prisma.order
          .findUniqueOrThrow({ where: { id: order.id } })
          .then((row) => resolve(row.status));
      });
    });
    await request(server.app)
      .patch(`/api/staff/orders/${order.id}/status`)
      .set(bearer(staffKG.token))
      .send({ status: 'PREPARING' })
      .expect(200);
    expect(await ready).toBe('PREPARING');

    const before = events.length;
    await request(server.app)
      .patch(`/api/staff/orders/${order.id}/status`)
      .set(bearer(staffKG.token))
      .send({ status: 'COLLECTED' })
      .expect(409);
    await settle();
    expect(events.slice(before).filter((e) => e.name.startsWith('order:'))).toEqual([]);
    owner.disconnect();
  });

  it('delivers notification:created to the recipient only', async () => {
    const owner = await server.connect(studentA.token);
    const other = await server.connect(studentB.token);
    const otherEvents = recordEvents(other);
    const coffee = await itemByName(server.prisma, kg.id, 'Coffee');
    const note = nextEvent<{ notification: { type: string } }>(owner, 'notification:created');
    await placeOrder(server.app, studentA, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    expect((await note).notification.type).toBe('ORDER_PLACED');
    await settle();
    expect(otherEvents).toEqual([]);
    owner.disconnect();
    other.disconnect();
  });

  it('ignores client attempts to join arbitrary rooms', async () => {
    const intruder = await server.connect(studentB.token);
    const events = recordEvents(intruder);
    intruder.emit('join', `canteen:${kg.id}`);
    intruder.emit('join', { room: 'admin' });
    intruder.emit('subscribe', `student:${studentA.id}`);

    const roll = await itemByName(server.prisma, kg.id, 'Veg Roll');
    const order = await placeOrder(server.app, studentA, kg.id, [
      { menuItemId: roll.id, quantity: 1 },
    ]);
    await payOrder(server.app, studentA, order.id);
    await settle();
    expect(events.filter((e) => e.name.startsWith('order:'))).toEqual([]);
    intruder.disconnect();
  });
});

describe('menu events', () => {
  it('pushes price and availability changes to students browsing that canteen only', async () => {
    const browsingKG = await server.connect(studentA.token);
    const browsingYN = await server.connect(studentB.token);
    expect(await subscribeMenu(browsingKG, kg.id)).toEqual({ ok: true, canteenId: kg.id });
    expect((await subscribeMenu(browsingYN, yn.id)).ok).toBe(true);
    const ynEvents = recordEvents(browsingYN);

    const dosa = await itemByName(server.prisma, kg.id, 'Egg Dosa');
    const price = nextEvent<{ itemId: string; pricePaise: number }>(
      browsingKG,
      'menu:price_updated',
      (p) => p.itemId === dosa.id,
    );
    const item = nextEvent<{ item: { id: string; pricePaise: number } }>(
      browsingKG,
      'menu:item_updated',
      (p) => p.item.id === dosa.id,
    );
    await request(server.app)
      .patch(`/api/staff/menu/items/${dosa.id}/price`)
      .set(bearer(staffKG.token))
      .send({ pricePaise: 5_500 })
      .expect(200);
    expect((await price).pricePaise).toBe(5_500);
    expect((await item).item.pricePaise).toBe(5_500);

    const availability = nextEvent<{ itemId: string; isAvailable: boolean; isOrderable: boolean }>(
      browsingKG,
      'menu:availability_updated',
      (p) => p.itemId === dosa.id,
    );
    await request(server.app)
      .patch(`/api/staff/menu/items/${dosa.id}/availability`)
      .set(bearer(staffKG.token))
      .send({ isAvailable: false })
      .expect(200);
    expect(await availability).toMatchObject({ isAvailable: false, isOrderable: false });

    const paused = nextEvent<{ canteenId: string; status: string }>(
      browsingKG,
      'canteen:order_taking_updated',
    );
    await request(server.app)
      .patch('/api/staff/canteen/status')
      .set(bearer(staffKG.token))
      .send({ isAcceptingOrders: false })
      .expect(200);
    expect(await paused).toMatchObject({ canteenId: kg.id, status: 'PAUSED' });
    await request(server.app)
      .patch('/api/staff/canteen/status')
      .set(bearer(staffKG.token))
      .send({ isAcceptingOrders: true })
      .expect(200);

    await settle();
    expect(
      ynEvents.filter((e) => e.name.startsWith('menu:') || e.name.startsWith('canteen:')),
    ).toEqual([]);
    browsingKG.disconnect();
    browsingYN.disconnect();
  });

  it('validates menu subscriptions server-side', async () => {
    const socket = await server.connect(studentA.token);
    expect((await subscribeMenu(socket, 'not-a-uuid')).error?.code).toBe('VALIDATION_ERROR');
    const hidden = await server.prisma.canteen.create({
      data: { name: 'Hidden Canteen', slug: 'hidden-canteen', isActive: false },
    });
    expect((await subscribeMenu(socket, hidden.id)).error?.code).toBe('CANTEEN_NOT_FOUND');
    socket.disconnect();
  });
});

describe('staff assignment events', () => {
  it('approval reaches the staff member live and moves them into the canteen room', async () => {
    const staff = await newPendingStaff(server.app, yn.id);
    const socket = await server.connect(staff.token);
    const events = recordEvents(socket);

    const approved = nextEvent<{ staffId: string; canteen: { id: string } }>(
      socket,
      'staff:approved',
    );
    const assigned = nextEvent<{ canteen: { id: string } }>(
      socket,
      'staff:canteen_assignment_updated',
    );
    const pending = await server.prisma.canteenChangeRequest.findFirstOrThrow({
      where: { staffId: staff.id, status: 'PENDING' },
    });
    await request(server.app)
      .post(`/api/admin/change-requests/${pending.id}/approve`)
      .set(bearer(admin.token))
      .send({})
      .expect(200);
    expect((await approved).canteen.id).toBe(yn.id);
    expect((await assigned).canteen.id).toBe(yn.id);
    expect(events.map((e) => e.name)).toContain('notification:created');

    // Same connection now receives Yamuna & Narmada orders.
    const coffee = await itemByName(server.prisma, yn.id, 'Coffee');
    const order = await placeOrder(server.app, studentB, yn.id, [
      { menuItemId: coffee.id, quantity: 1 },
    ]);
    const created = nextEvent<{ order: { id: string } }>(
      socket,
      'order:created',
      (p) => p.order.id === order.id,
    );
    await payOrder(server.app, studentB, order.id);
    await created;

    // Reassignment moves the live socket out of the old canteen room.
    const moved = nextEvent(socket, 'staff:canteen_assignment_updated');
    await request(server.app)
      .patch(`/api/admin/staff/${staff.id}/assignment`)
      .set(bearer(admin.token))
      .send({ canteenId: kg.id })
      .expect(200);
    await moved;
    await settle(100);
    const before = events.length;
    const order2 = await placeOrder(server.app, studentB, yn.id, [
      { menuItemId: coffee.id, quantity: 1 },
    ]);
    await payOrder(server.app, studentB, order2.id);
    await settle();
    expect(events.slice(before).filter((e) => e.name === 'order:created')).toEqual([]);
    socket.disconnect();
  });

  it('admins receive change requests live; deactivation disconnects the staff socket', async () => {
    const adminSocket = await server.connect(admin.token);
    const createdEvent = nextEvent<{ changeRequest: { requestedCanteen: { id: string } } }>(
      adminSocket,
      'change_request:created',
    );
    const staff = await newPendingStaff(server.app, kg.id);
    expect((await createdEvent).changeRequest.requestedCanteen.id).toBe(kg.id);

    const staffSocket = await server.connect(staff.token);
    const disconnected = new Promise<string>((resolve) =>
      staffSocket.once('disconnect', (reason) => resolve(reason)),
    );
    await request(server.app)
      .post(`/api/admin/staff/${staff.id}/deactivate`)
      .set(bearer(admin.token))
      .expect(200);
    expect(await disconnected).toBe('io server disconnect');
    expect(await server.rejectedConnect(staff.token)).toBe('ACCOUNT_DISABLED');
    adminSocket.disconnect();
  });

  it('re-verifies identity on reconnect and restores server-assigned rooms', async () => {
    const first = await server.connect(studentA.token);
    first.disconnect();
    const again = await server.connect(studentA.token);
    const coffee = await itemByName(server.prisma, kg.id, 'Coffee');
    const note = nextEvent(again, 'notification:created');
    await placeOrder(server.app, studentA, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    await note;
    again.disconnect();
  });
});
