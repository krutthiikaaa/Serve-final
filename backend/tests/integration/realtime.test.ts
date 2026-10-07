import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { truncateAll } from '../helpers/db.js';
import { createFirebaseUser } from '../helpers/firebase.js';
import { testEnv } from '../helpers/test-app.js';
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

type OrderEvent = {
  order: { id: string; status: string; student?: { id: string }; totalPaise: number };
  previousStatus: string | null;
};

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

const orderEvents = (events: { name: string }[]) =>
  events.filter((e) => e.name.startsWith('order.'));

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

  it('disconnects a socket when its ID token expires', async () => {
    // Emulator-format token (unsigned; accepted only by the emulator) for a
    // real user, expiring in 2 seconds.
    const env = testEnv();
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const shortLived = [
      encode({ alg: 'none', typ: 'JWT' }),
      encode({
        iss: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
        aud: env.FIREBASE_PROJECT_ID,
        auth_time: now,
        iat: now,
        exp: now + 2,
        sub: studentA.uid,
        user_id: studentA.uid,
        email: studentA.email,
        firebase: { identities: {}, sign_in_provider: 'password' },
      }),
      '',
    ].join('.');
    const socket = await server.connect(shortLived);
    const expired = nextEvent<{ reason: string }>(socket, 'auth.expired', () => true, 6_000);
    const disconnected = new Promise<string>((resolve) => socket.once('disconnect', resolve));
    expect((await expired).reason).toBe('TOKEN_EXPIRED');
    expect(await disconnected).toBe('io server disconnect');
    expect(await server.rejectedConnect(shortLived)).toBe('AUTH_TOKEN_EXPIRED');
  });
});

describe('order events and room isolation', () => {
  it('sends each lifecycle event only to the owner, that canteen’s staff and admins', async () => {
    const [kgStaff, ynStaff, owner, otherStudent, adminSocket] = await Promise.all([
      server.connect(staffKG.token),
      server.connect(staffYN.token),
      server.connect(studentA.token),
      server.connect(studentB.token),
      server.connect(admin.token),
    ]);
    const kgEvents = recordEvents(kgStaff);
    const ynEvents = recordEvents(ynStaff);
    const otherEvents = recordEvents(otherStudent);

    const roll = await itemByName(server.prisma, kg.id, 'Chicken Roll');
    const created = nextEvent<OrderEvent>(owner, 'order.created');
    const adminCreated = nextEvent<OrderEvent>(adminSocket, 'order.created');
    const order = await placeOrder(server.app, studentA, kg.id, [
      { menuItemId: roll.id, quantity: 1 },
    ]);
    expect((await created).order).toMatchObject({ id: order.id, status: 'PLACED' });
    expect((await created).order.student).toBeUndefined(); // student view
    expect((await adminCreated).order.student).toMatchObject({ id: studentA.id }); // admin view
    await settle();
    expect(orderEvents(kgEvents)).toEqual([]); // the kitchen never sees unpaid orders

    const paidForKitchen = nextEvent<OrderEvent>(
      kgStaff,
      'order.payment_confirmed',
      (d) => d.order.id === order.id,
    );
    const paidForOwner = nextEvent<OrderEvent>(
      owner,
      'order.payment_confirmed',
      (d) => d.order.id === order.id,
    );
    await payOrder(server.app, studentA, order.id);
    expect(await paidForKitchen).toMatchObject({
      previousStatus: 'PLACED',
      order: { status: 'PAYMENT_CONFIRMED', student: { id: studentA.id } },
    });
    expect((await paidForOwner).order.status).toBe('PAYMENT_CONFIRMED');

    for (const [status, event] of [
      ['PREPARING', 'order.preparing'],
      ['READY', 'order.ready'],
      ['COLLECTED', 'order.collected'],
    ] as const) {
      const toOwner = nextEvent<OrderEvent>(owner, event, (d) => d.order.id === order.id);
      const toKitchen = nextEvent<OrderEvent>(kgStaff, event, (d) => d.order.id === order.id);
      await request(server.app)
        .patch(`/api/staff/orders/${order.id}/status`)
        .set(bearer(staffKG.token))
        .send({ status })
        .expect(200);
      expect((await toOwner).order.status).toBe(status);
      expect((await toKitchen).order.status).toBe(status);
    }

    await settle();
    expect(orderEvents(ynEvents)).toEqual([]);
    expect(
      otherEvents.filter((e) => e.name.startsWith('order.') || e.name === 'notification.created'),
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
    const committed = new Promise<string>((resolve) => {
      owner.on('order.preparing', (envelope: { data: OrderEvent }) => {
        if (envelope.data.order.id !== order.id) return;
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
    expect(await committed).toBe('PREPARING');

    const before = events.length;
    await request(server.app)
      .patch(`/api/staff/orders/${order.id}/status`)
      .set(bearer(staffKG.token))
      .send({ status: 'COLLECTED' })
      .expect(409);
    await settle();
    expect(orderEvents(events.slice(before))).toEqual([]);
    owner.disconnect();
  });

  it('delivers notification.created to the recipient only, matching the stored row', async () => {
    const owner = await server.connect(studentA.token);
    const other = await server.connect(studentB.token);
    const otherEvents = recordEvents(other);
    const coffee = await itemByName(server.prisma, kg.id, 'Coffee');
    const note = nextEvent<{ notification: { id: string; type: string; readAt: null } }>(
      owner,
      'notification.created',
    );
    await placeOrder(server.app, studentA, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    const received = (await note).notification;
    expect(received.type).toBe('ORDER_PLACED');
    const stored = await server.prisma.notification.findUniqueOrThrow({
      where: { id: received.id },
    });
    expect(stored).toMatchObject({ studentId: studentA.id, type: 'ORDER_PLACED', readAt: null });
    await settle();
    expect(otherEvents).toEqual([]);
    owner.disconnect();
    other.disconnect();
  });

  it('ignores every client attempt to join privileged rooms', async () => {
    const intruder = await server.connect(studentB.token);
    const events = recordEvents(intruder);
    for (const room of [
      `canteen:${kg.id}`,
      'admin',
      `student:${studentA.id}`,
      `staff:${staffKG.id}`,
    ]) {
      intruder.emit('join', room);
      intruder.emit('join', { room });
      intruder.emit('subscribe', room);
      intruder.emit('menu:subscribe', { canteenId: room });
    }

    const roll = await itemByName(server.prisma, kg.id, 'Veg Roll');
    const order = await placeOrder(server.app, studentA, kg.id, [
      { menuItemId: roll.id, quantity: 1 },
    ]);
    await payOrder(server.app, studentA, order.id);
    await request(server.app)
      .patch(`/api/staff/orders/${order.id}/status`)
      .set(bearer(staffKG.token))
      .send({ status: 'PREPARING' })
      .expect(200);
    await request(server.app)
      .patch(`/api/admin/canteens/${yn.id}`)
      .set(bearer(admin.token))
      .send({ isAcceptingOrders: true })
      .expect(200);
    await settle();
    expect(events).toEqual([]);
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
    const price = nextEvent<{ itemId: string; pricePaise: number; previousPricePaise: number }>(
      browsingKG,
      'menu.item_price_changed',
      (d) => d.itemId === dosa.id,
    );
    const item = nextEvent<{ item: { id: string; pricePaise: number; availability: string } }>(
      browsingKG,
      'menu.item_updated',
      (d) => d.item.id === dosa.id,
    );
    await request(server.app)
      .patch(`/api/staff/menu/items/${dosa.id}/price`)
      .set(bearer(staffKG.token))
      .send({ pricePaise: 5_500 })
      .expect(200);
    expect(await price).toMatchObject({ pricePaise: 5_500, previousPricePaise: 5_000 });
    expect((await item).item).toMatchObject({ pricePaise: 5_500, availability: 'AVAILABLE' });

    const availability = nextEvent<{ itemId: string; availability: string; isOrderable: boolean }>(
      browsingKG,
      'menu.item_availability_changed',
      (d) => d.itemId === dosa.id,
    );
    await request(server.app)
      .patch(`/api/staff/menu/items/${dosa.id}/availability`)
      .set(bearer(staffKG.token))
      .send({ isAvailable: false })
      .expect(200);
    expect(await availability).toMatchObject({ availability: 'UNAVAILABLE', isOrderable: false });

    const paused = nextEvent<{ canteenId: string; status: string }>(
      browsingKG,
      'canteen.status_changed',
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
      ynEvents.filter((e) => e.name.startsWith('menu.') || e.name.startsWith('canteen.')),
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

    const approved = nextEvent<{ staffId: string; status: string; canteen: { id: string } }>(
      socket,
      'staff.approved',
    );
    const assigned = nextEvent<{ canteen: { id: string; name: string } }>(
      socket,
      'staff.canteen_assigned',
    );
    const pending = await server.prisma.canteenChangeRequest.findFirstOrThrow({
      where: { staffId: staff.id, status: 'PENDING' },
    });
    await request(server.app)
      .post(`/api/admin/change-requests/${pending.id}/approve`)
      .set(bearer(admin.token))
      .send({})
      .expect(200);
    expect(await approved).toMatchObject({
      staffId: staff.id,
      status: 'APPROVED',
      canteen: { id: yn.id },
    });
    expect((await assigned).canteen).toMatchObject({
      id: yn.id,
      name: 'Yamuna & Narmada Night Canteen',
    });
    await settle(100);
    expect(events.map((e) => e.name)).toEqual(
      expect.arrayContaining(['change_request.updated', 'notification.created']),
    );

    // Same connection now receives Yamuna & Narmada orders.
    const coffee = await itemByName(server.prisma, yn.id, 'Coffee');
    const order = await placeOrder(server.app, studentB, yn.id, [
      { menuItemId: coffee.id, quantity: 1 },
    ]);
    const newOrder = nextEvent<OrderEvent>(
      socket,
      'order.payment_confirmed',
      (d) => d.order.id === order.id,
    );
    await payOrder(server.app, studentB, order.id);
    await newOrder;

    // Reassignment moves the live socket out of the old canteen room.
    const moved = nextEvent(socket, 'staff.canteen_assigned');
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
    expect(orderEvents(events.slice(before))).toEqual([]);
    socket.disconnect();
  });

  it('rejection reaches the applicant live', async () => {
    const staff = await newPendingStaff(server.app, kg.id);
    const socket = await server.connect(staff.token);
    const rejected = nextEvent<{ staffId: string; status: string }>(socket, 'staff.rejected');
    const pending = await server.prisma.canteenChangeRequest.findFirstOrThrow({
      where: { staffId: staff.id, status: 'PENDING' },
    });
    await request(server.app)
      .post(`/api/admin/change-requests/${pending.id}/reject`)
      .set(bearer(admin.token))
      .send({})
      .expect(200);
    expect(await rejected).toMatchObject({ staffId: staff.id, status: 'REJECTED' });
    socket.disconnect();
  });

  it('admins receive change requests live; deactivation disconnects the staff socket', async () => {
    const adminSocket = await server.connect(admin.token);
    const createdEvent = nextEvent<{ changeRequest: { requestedCanteen: { id: string } } }>(
      adminSocket,
      'change_request.created',
    );
    const staff = await newPendingStaff(server.app, kg.id);
    expect((await createdEvent).changeRequest.requestedCanteen.id).toBe(kg.id);

    const approvedStaff = await newApprovedStaff(server.app, admin, kg.id);
    const staffSocket = await server.connect(approvedStaff.token);
    const deactivatedEvent = nextEvent<{ staffId: string }>(staffSocket, 'staff.deactivated');
    const disconnected = new Promise<string>((resolve) => staffSocket.once('disconnect', resolve));
    await request(server.app)
      .post(`/api/admin/staff/${approvedStaff.id}/deactivate`)
      .set(bearer(admin.token))
      .expect(200);
    expect((await deactivatedEvent).staffId).toBe(approvedStaff.id);
    expect(await disconnected).toBe('io server disconnect');
    expect(await server.rejectedConnect(approvedStaff.token)).toBe('ACCOUNT_DISABLED');
    expect(staff.id).toBeTruthy();
    adminSocket.disconnect();
  });

  it('re-verifies identity on reconnect and restores server-assigned rooms', async () => {
    const first = await server.connect(studentA.token);
    first.disconnect();
    const again = await server.connect(studentA.token);
    const coffee = await itemByName(server.prisma, kg.id, 'Coffee');
    const note = nextEvent(again, 'notification.created');
    await placeOrder(server.app, studentA, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
    await note;
    again.disconnect();
  });
});
