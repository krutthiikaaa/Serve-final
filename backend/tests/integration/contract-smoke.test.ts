import request from 'supertest';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { truncateAll } from '../helpers/db.js';
import { createFirebaseUser, uniqueEmail } from '../helpers/firebase.js';
import { bearer, idempotencyKey, newAdmin, type Actor } from '../helpers/actors.js';
import { nextEvent, startTestServer, subscribeMenu, type TestServer } from '../helpers/realtime.js';
import {
  adminDashboardSchema,
  canteenSchema,
  changeRequestSchema,
  errorSchema,
  expectShape,
  hostelSchema,
  meAdminSchema,
  meStaffSchema,
  meStudentSchema,
  meUnregisteredSchema,
  menuItemSchema,
  menuSchema,
  notificationSchema,
  orderEventSchema,
  page,
  quoteSchema,
  staffDashboardSchema,
  staffOrderSchema,
  staffSummarySchema,
  studentOrderSchema,
} from '../helpers/contract.js';

/**
 * API CONTRACT SMOKE TEST — simulates the three frontend clients end to end
 * (REST + Socket.IO) and validates every response against the frozen, strict
 * contract in tests/helpers/contract.ts.
 */
const z_number = z.number();
const z_boolean = z.boolean();
const categoryRef = z.strictObject({ id: z.uuid(), name: z.string() });
const countsSchema = z.strictObject({
  hostels: z.number(),
  activeStaff: z.number(),
  menuItems: z.number(),
});
function z_data<T extends z.ZodType>(item: T) {
  return z.strictObject({ data: z.array(item) });
}

let server: TestServer;
let admin: Actor;
const student = { token: '', id: '', email: '' };
const staff = { token: '', id: '', email: '' };
let canteenId = '';
let itemId = '';
let orderId = '';

beforeAll(async () => {
  server = await startTestServer();
  await truncateAll(server.prisma);
  await seedDatabase(server.prisma);
  admin = await newAdmin(server.prisma, server.ctx.env);
});
afterAll(() => server.close());

const api = () => request(server.app);

describe('student client', () => {
  it('signs up with Firebase, sees itself as unregistered, and registers', async () => {
    const user = await createFirebaseUser(uniqueEmail('flutter'));
    student.token = user.idToken;
    student.email = user.email;
    expectShape(
      meUnregisteredSchema,
      (await api().get('/api/auth/me').set(bearer(user.idToken)).expect(200)).body.data,
    );

    const hostels = (await api().get('/api/hostels').expect(200)).body;
    expectShape(z_data(hostelSchema), hostels);
    const krishna = hostels.data.find((h: { name: string }) => h.name === 'Krishna');

    const registered = await api()
      .post('/api/auth/student/register')
      .set(bearer(user.idToken))
      .send({ name: 'Flutter Student', email: user.email, hostelId: krishna.id })
      .expect(201);
    const me = expectShape(meStudentSchema, registered.body.data);
    student.id = me.id;
    canteenId = me.defaultCanteen.id;
  });

  it('browses canteens, the menu and an item', async () => {
    expectShape(
      z_data(canteenSchema),
      (await api().get('/api/canteens').set(bearer(student.token)).expect(200)).body,
    );
    expectShape(
      canteenSchema,
      (await api().get(`/api/canteens/${canteenId}`).set(bearer(student.token)).expect(200)).body
        .data,
    );
    const menu = expectShape(
      menuSchema,
      (await api().get(`/api/canteens/${canteenId}/menu`).set(bearer(student.token)).expect(200))
        .body.data,
    );
    itemId = menu.categories[0]!.items[0]!.id;
    const item = (
      await api().get(`/api/menu/items/${itemId}`).set(bearer(student.token)).expect(200)
    ).body.data;
    expectShape(menuItemSchema.extend({ category: categoryRef, canteen: canteenSchema }), item);
  });

  it('gets an authoritative quote and places an order', async () => {
    const quote = expectShape(
      quoteSchema,
      (
        await api()
          .post('/api/cart/quote')
          .set(bearer(student.token))
          .send({ canteenId, items: [{ menuItemId: itemId, quantity: 2 }] })
          .expect(200)
      ).body.data,
    );
    const order = expectShape(
      studentOrderSchema,
      (
        await api()
          .post('/api/orders')
          .set(bearer(student.token))
          .set('Idempotency-Key', idempotencyKey())
          .send({ canteenId, items: [{ menuItemId: itemId, quantity: 2 }] })
          .expect(201)
      ).body.data,
    );
    expect(order.totalPaise).toBe(quote.totalPaise);
    expect(order.payment?.status).toBe('PENDING');
    orderId = order.id;

    expectShape(
      page(studentOrderSchema),
      (await api().get('/api/orders').set(bearer(student.token)).expect(200)).body,
    );
    expectShape(
      studentOrderSchema,
      (await api().get(`/api/orders/${orderId}`).set(bearer(student.token)).expect(200)).body.data,
    );
    const notes = (await api().get('/api/notifications').set(bearer(student.token)).expect(200))
      .body;
    expectShape(page(notificationSchema).extend({ unreadCount: z_number }), notes);
    expect(
      (
        await api()
          .get(`/api/students/me/recommendations?canteenId=${canteenId}`)
          .set(bearer(student.token))
          .expect(200)
      ).body.data.items.every((i: unknown) => menuItemSchema.safeParse(i).success),
    ).toBe(true);
  });

  it('returns the documented error envelope', async () => {
    const res = await api()
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({ canteenId, items: [{ menuItemId: itemId, quantity: 0 }] })
      .expect(422);
    expectShape(errorSchema, res.body);
    expectShape(errorSchema, (await api().get('/api/orders').expect(401)).body);
  });
});

describe('staff and admin clients', () => {
  it('staff registers and stays pending; admin reviews and approves', async () => {
    const user = await createFirebaseUser(uniqueEmail('react-staff'));
    staff.token = user.idToken;
    const adminSocket = await server.connect(admin.token);
    const requestEvent = nextEvent(adminSocket, 'change_request.created');
    const registered = await api()
      .post('/api/auth/staff/register')
      .set(bearer(user.idToken))
      .send({ name: 'React Staff', email: user.email, requestedCanteenId: canteenId })
      .expect(201);
    const me = expectShape(meStaffSchema, registered.body.data);
    staff.id = me.id;
    expect(me).toMatchObject({ status: 'PENDING', canteen: null });
    expectShape(z.strictObject({ changeRequest: changeRequestSchema }), await requestEvent);
    adminSocket.disconnect();
    expect(
      expectShape(
        errorSchema,
        (await api().get('/api/staff/orders').set(bearer(staff.token)).expect(403)).body,
      ).error.code,
    ).toBe('STAFF_NOT_APPROVED');

    expectShape(
      meAdminSchema,
      (await api().get('/api/auth/me').set(bearer(admin.token)).expect(200)).body.data,
    );
    expectShape(
      adminDashboardSchema,
      (await api().get('/api/admin/dashboard').set(bearer(admin.token)).expect(200)).body.data,
    );
    expectShape(
      page(staffSummarySchema),
      (await api().get('/api/admin/staff').set(bearer(admin.token)).expect(200)).body,
    );
    const requests = expectShape(
      page(changeRequestSchema),
      (
        await api()
          .get('/api/admin/change-requests?status=PENDING')
          .set(bearer(admin.token))
          .expect(200)
      ).body,
    );
    const pending = requests.data.find((r) => r.staff.id === staff.id)!;

    const staffSocket = await server.connect(staff.token);
    const assigned = nextEvent(staffSocket, 'staff.canteen_assigned');
    const approved = await api()
      .post(`/api/admin/change-requests/${pending.id}/approve`)
      .set(bearer(admin.token))
      .send({ notes: 'Welcome' })
      .expect(200);
    expectShape(changeRequestSchema, approved.body.data);
    expect(await assigned).toMatchObject({
      staffId: staff.id,
      status: 'APPROVED',
      canteen: { id: canteenId },
    });
    staffSocket.disconnect();

    const meAfter = expectShape(
      meStaffSchema,
      (await api().get('/api/auth/me').set(bearer(staff.token)).expect(200)).body.data,
    );
    expect(meAfter.canteen?.id).toBe(canteenId);
    expectShape(
      z_data(canteenSchema.extend({ counts: countsSchema })),
      (await api().get('/api/admin/canteens').set(bearer(admin.token)).expect(200)).body,
    );
    expectShape(
      z_data(hostelSchema.extend({ isActive: z_boolean })),
      (await api().get('/api/admin/hostels').set(bearer(admin.token)).expect(200)).body,
    );
  });

  it('staff dashboard, managed menu and menu updates reach a browsing student', async () => {
    expectShape(
      staffDashboardSchema,
      (await api().get('/api/staff/dashboard').set(bearer(staff.token)).expect(200)).body.data,
    );
    const managed = (await api().get('/api/staff/menu').set(bearer(staff.token)).expect(200)).body
      .data;
    expect(
      managed.every((c: unknown) => menuSchema.shape.categories.element.safeParse(c).success),
    ).toBe(true);

    const studentSocket = await server.connect(student.token);
    expect((await subscribeMenu(studentSocket, canteenId)).ok).toBe(true);
    const price = nextEvent(studentSocket, 'menu.item_price_changed');
    const availability = nextEvent(studentSocket, 'menu.item_availability_changed');
    const updated = await api()
      .patch(`/api/staff/menu/items/${itemId}/price`)
      .set(bearer(staff.token))
      .send({ pricePaise: 7_700 })
      .expect(200);
    expectShape(menuItemSchema, updated.body.data);
    expect(await price).toMatchObject({ itemId, canteenId, pricePaise: 7_700 });
    await api()
      .patch(`/api/staff/menu/items/${itemId}/availability`)
      .set(bearer(staff.token))
      .send({ isAvailable: false })
      .expect(200);
    expect(await availability).toMatchObject({
      itemId,
      availability: 'UNAVAILABLE',
      isOrderable: false,
    });
    await api()
      .patch(`/api/staff/menu/items/${itemId}/availability`)
      .set(bearer(staff.token))
      .send({ isAvailable: true })
      .expect(200);
    studentSocket.disconnect();
  });

  it('payment, order board and live status updates between student and staff', async () => {
    const staffSocket = await server.connect(staff.token);
    const studentSocket = await server.connect(student.token);
    const newOrder = nextEvent(
      staffSocket,
      'order.payment_confirmed',
      (d: { order: { id: string } }) => d.order.id === orderId,
    );

    await api().post(`/api/payments/${orderId}/initiate`).set(bearer(student.token)).expect(200);
    await api()
      .post(`/api/payments/${orderId}/mock-complete`)
      .set(bearer(student.token))
      .send({})
      .expect(200);
    expectShape(orderEventSchema(staffOrderSchema), await newOrder);

    expectShape(
      page(staffOrderSchema),
      (await api().get('/api/staff/orders?status=active').set(bearer(staff.token)).expect(200))
        .body,
    );
    expectShape(
      staffOrderSchema,
      (await api().get(`/api/staff/orders/${orderId}`).set(bearer(staff.token)).expect(200)).body
        .data,
    );

    for (const [status, event] of [
      ['PREPARING', 'order.preparing'],
      ['READY', 'order.ready'],
      ['COLLECTED', 'order.collected'],
    ] as const) {
      const live = nextEvent(
        studentSocket,
        event,
        (d: { order: { id: string } }) => d.order.id === orderId,
      );
      const res = await api()
        .patch(`/api/staff/orders/${orderId}/status`)
        .set(bearer(staff.token))
        .send({ status })
        .expect(200);
      expectShape(staffOrderSchema, res.body.data);
      const data = expectShape(orderEventSchema(studentOrderSchema), await live);
      expect(data.order.status).toBe(status);
    }
    const note = (
      await api().get('/api/notifications?unread=true').set(bearer(student.token)).expect(200)
    ).body.data;
    expect(note.map((n: { type: string }) => n.type)).toContain('ORDER_READY');
    staffSocket.disconnect();
    studentSocket.disconnect();
  });
});
