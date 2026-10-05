import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
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

const { app, prisma, env } = buildTestApp();

let admin: Actor;
let student: Actor;
let kg: { id: string; name: string };
let yn: { id: string; name: string };

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  yn = await canteenBySlug(prisma, 'yamuna-narmada');
  admin = await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
});
afterAll(() => prisma.$disconnect());

async function pendingRequestFor(staffId: string) {
  return prisma.canteenChangeRequest.findFirstOrThrow({ where: { staffId, status: 'PENDING' } });
}

describe('staff approval lifecycle', () => {
  it('pending staff cannot operate a canteen', async () => {
    const staff = await newPendingStaff(app);
    for (const path of ['/api/staff/dashboard', '/api/staff/orders', '/api/staff/menu']) {
      const res = await request(app).get(path).set(bearer(staff.token)).expect(403);
      expect(res.body.error.code).toBe('STAFF_NOT_APPROVED');
    }
    await request(app)
      .patch('/api/staff/canteen/status')
      .set(bearer(staff.token))
      .send({ isAcceptingOrders: false })
      .expect(403);
  });

  it('staff request access, an admin approves, and the staff member gains access', async () => {
    const staff = await newPendingStaff(app);
    const created = await request(app)
      .post('/api/staff/change-requests')
      .set(bearer(staff.token))
      .send({ requestedCanteenId: kg.id, notes: 'I work the night shift' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      status: 'PENDING',
      requestedCanteen: { id: kg.id },
      fromCanteen: null,
    });

    const dup = await request(app)
      .post('/api/staff/change-requests')
      .set(bearer(staff.token))
      .send({ requestedCanteenId: yn.id })
      .expect(409);
    expect(dup.body.error.code).toBe('CHANGE_REQUEST_PENDING');

    const pending = await request(app)
      .get('/api/admin/change-requests?status=PENDING')
      .set(bearer(admin.token))
      .expect(200);
    expect(pending.body.data.map((r: { id: string }) => r.id)).toContain(created.body.data.id);

    const approved = await request(app)
      .post(`/api/admin/change-requests/${created.body.data.id}/approve`)
      .set(bearer(admin.token))
      .send({ notes: 'Welcome' })
      .expect(200);
    expect(approved.body.data).toMatchObject({
      status: 'APPROVED',
      reviewNotes: 'Welcome',
      reviewedBy: { id: admin.id },
    });

    const row = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(row).toMatchObject({ status: 'APPROVED', canteenId: kg.id });
    const request_ = await prisma.canteenChangeRequest.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(request_.reviewedByAdminId).toBe(admin.id);
    expect(request_.reviewedAt).toBeTruthy();

    // Same Firebase token, new database-backed permissions.
    const dash = await request(app)
      .get('/api/staff/dashboard')
      .set(bearer(staff.token))
      .expect(200);
    expect(dash.body.data.canteen.id).toBe(kg.id);
    const me = await request(app).get('/api/auth/me').set(bearer(staff.token)).expect(200);
    expect(me.body.data).toMatchObject({ status: 'APPROVED', canteen: { id: kg.id } });

    const notes = await prisma.notification.findMany({ where: { staffId: staff.id } });
    expect(notes.map((n) => n.type)).toContain('STAFF_APPROVED');

    const again = await request(app)
      .post(`/api/admin/change-requests/${created.body.data.id}/approve`)
      .set(bearer(admin.token))
      .send({});
    expect(again.status).toBe(409);
  });

  it('rejection keeps a new applicant out; they may apply again', async () => {
    const staff = await newPendingStaff(app, yn.id);
    const pending = await pendingRequestFor(staff.id);
    await request(app)
      .post(`/api/admin/change-requests/${pending.id}/reject`)
      .set(bearer(admin.token))
      .send({ notes: 'No' })
      .expect(200);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).status).toBe(
      'REJECTED',
    );
    await request(app).get('/api/staff/orders').set(bearer(staff.token)).expect(403);
    expect(
      (await prisma.notification.findMany({ where: { staffId: staff.id } })).map((n) => n.type),
    ).toContain('STAFF_REJECTED');

    await request(app)
      .post('/api/staff/change-requests')
      .set(bearer(staff.token))
      .send({ requestedCanteenId: yn.id })
      .expect(201);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).status).toBe(
      'PENDING',
    );
  });

  it('approved staff can request reassignment; rejection keeps their current canteen', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id);
    const same = await request(app)
      .post('/api/staff/change-requests')
      .set(bearer(staff.token))
      .send({ requestedCanteenId: kg.id })
      .expect(409);
    expect(same.body.error.code).toBe('ALREADY_ASSIGNED');

    const move = await request(app)
      .post('/api/staff/change-requests')
      .set(bearer(staff.token))
      .send({ requestedCanteenId: yn.id })
      .expect(201);
    expect(move.body.data.fromCanteen).toMatchObject({ id: kg.id });
    await request(app)
      .post(`/api/admin/change-requests/${move.body.data.id}/reject`)
      .set(bearer(admin.token))
      .send({})
      .expect(200);
    expect(await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).toMatchObject({
      status: 'APPROVED',
      canteenId: kg.id,
    });

    const move2 = await request(app)
      .post('/api/staff/change-requests')
      .set(bearer(staff.token))
      .send({ requestedCanteenId: yn.id })
      .expect(201);
    await request(app)
      .post(`/api/admin/change-requests/${move2.body.data.id}/approve`)
      .set(bearer(admin.token))
      .send({})
      .expect(200);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).canteenId).toBe(
      yn.id,
    );

    const history = await request(app)
      .get('/api/staff/change-requests')
      .set(bearer(staff.token))
      .expect(200);
    expect(history.body.data).toHaveLength(3);
  });

  it('staff cannot review requests (including their own)', async () => {
    const staff = await newPendingStaff(app, kg.id);
    const pending = await pendingRequestFor(staff.id);
    const res = await request(app)
      .post(`/api/admin/change-requests/${pending.id}/approve`)
      .set(bearer(staff.token))
      .send({})
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
    expect(
      (await prisma.canteenChangeRequest.findUniqueOrThrow({ where: { id: pending.id } })).status,
    ).toBe('PENDING');
  });

  it('admin can assign directly and deactivate staff', async () => {
    const staff = await newPendingStaff(app, kg.id);
    const assigned = await request(app)
      .patch(`/api/admin/staff/${staff.id}/assignment`)
      .set(bearer(admin.token))
      .send({ canteenId: kg.id })
      .expect(200);
    expect(assigned.body.data).toMatchObject({ status: 'APPROVED', canteen: { id: kg.id } });
    // The matching pending request is closed as approved.
    expect(
      await prisma.canteenChangeRequest.count({ where: { staffId: staff.id, status: 'PENDING' } }),
    ).toBe(0);

    await request(app)
      .post(`/api/admin/staff/${staff.id}/deactivate`)
      .set(bearer(admin.token))
      .expect(200);
    const res = await request(app).get('/api/staff/dashboard').set(bearer(staff.token)).expect(403);
    expect(res.body.error.code).toBe('STAFF_DEACTIVATED');
    await request(app)
      .post(`/api/admin/staff/${staff.id}/deactivate`)
      .set(bearer(admin.token))
      .expect(409);

    const detail = await request(app)
      .get(`/api/admin/staff/${staff.id}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(detail.body.data).toMatchObject({ status: 'DEACTIVATED', canteen: null });
    const list = await request(app)
      .get('/api/admin/staff?status=DEACTIVATED')
      .set(bearer(admin.token))
      .expect(200);
    expect(list.body.data.map((s: { id: string }) => s.id)).toContain(staff.id);
  });
});

describe('admin canteen and hostel management', () => {
  it('creates, updates, activates and deactivates canteens', async () => {
    const created = await request(app)
      .post('/api/admin/canteens')
      .set(bearer(admin.token))
      .send({ name: 'Saraswati Night Canteen', location: 'Block S', openingHours: '10 PM – 2 AM' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      slug: 'saraswati-night-canteen',
      status: 'ACCEPTING_ORDERS',
    });

    const dup = await request(app)
      .post('/api/admin/canteens')
      .set(bearer(admin.token))
      .send({ name: 'Saraswati Night Canteen' })
      .expect(409);
    expect(dup.body.error.code).toBe('CANTEEN_NAME_TAKEN');

    const paused = await request(app)
      .patch(`/api/admin/canteens/${created.body.data.id}`)
      .set(bearer(admin.token))
      .send({ isAcceptingOrders: false })
      .expect(200);
    expect(paused.body.data.status).toBe('PAUSED');
    const off = await request(app)
      .patch(`/api/admin/canteens/${created.body.data.id}`)
      .set(bearer(admin.token))
      .send({ isActive: false })
      .expect(200);
    expect(off.body.data.status).toBe('INACTIVE');
  });

  it('shows canteen details with staff, hostels and a menu summary', async () => {
    const res = await request(app)
      .get(`/api/admin/canteens/${kg.id}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(res.body.data.hostels.map((h: { name: string }) => h.name)).toEqual([
      'Godavari',
      'Krishna',
    ]);
    expect(res.body.data.menuSummary.categories).toBeGreaterThanOrEqual(6);
    expect(res.body.data.menuSummary.items).toBeGreaterThanOrEqual(29);
    const list = await request(app).get('/api/admin/canteens').set(bearer(admin.token)).expect(200);
    expect(list.body.data.find((c: { id: string }) => c.id === kg.id).counts.hostels).toBe(2);
  });

  it('manages hostel mapping', async () => {
    const created = await request(app)
      .post('/api/admin/hostels')
      .set(bearer(admin.token))
      .send({ name: 'Krishna Annexe', canteenId: kg.id })
      .expect(201);
    expect(created.body.data.canteen.id).toBe(kg.id);
    const moved = await request(app)
      .patch(`/api/admin/hostels/${created.body.data.id}`)
      .set(bearer(admin.token))
      .send({ canteenId: yn.id })
      .expect(200);
    expect(moved.body.data.canteen.id).toBe(yn.id);
    await request(app)
      .post('/api/admin/hostels')
      .set(bearer(admin.token))
      .send({ name: 'Krishna Annexe', canteenId: kg.id })
      .expect(409);
  });

  it('reports the admin dashboard from live data', async () => {
    const roll = await itemByName(prisma, kg.id, 'Egg Roll');
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    await payOrder(app, student, order.id);
    const res = await request(app).get('/api/admin/dashboard').set(bearer(admin.token)).expect(200);
    expect(res.body.data.canteens).toMatchObject({ total: await prisma.canteen.count() });
    expect(res.body.data.pendingChangeRequests).toBe(
      await prisma.canteenChangeRequest.count({ where: { status: 'PENDING' } }),
    );
    expect(res.body.data.staff.active).toBe(
      await prisma.staff.count({ where: { status: 'APPROVED' } }),
    );
    expect(res.body.data.today.orderCount).toBeGreaterThanOrEqual(1);
  });

  it('rejects non-admins on every admin route', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id);
    for (const actor of [student, staff]) {
      for (const [method, path] of [
        ['get', '/api/admin/dashboard'],
        ['get', '/api/admin/canteens'],
        ['post', '/api/admin/canteens'],
        ['get', '/api/admin/staff'],
        ['get', '/api/admin/change-requests'],
        ['get', '/api/admin/orders'],
      ] as const) {
        const res = await request(app)[method](path).set(bearer(actor.token)).send({ name: 'X' });
        expect(res.status).toBe(403);
      }
    }
    await request(app).get('/api/admin/dashboard').expect(401);
  });
});

describe('notifications', () => {
  it('lists only the caller’s notifications and marks them read', async () => {
    const other = await newStudent(app, prisma);
    const roll = await itemByName(prisma, kg.id, 'Veg Roll');
    await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    await placeOrder(app, other, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);

    const mine = await request(app)
      .get('/api/notifications')
      .set(bearer(student.token))
      .expect(200);
    expect(mine.body.unreadCount).toBeGreaterThan(0);
    const studentRow = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    const ids = (mine.body.data as { id: string }[]).map((n) => n.id);
    const owners = await prisma.notification.findMany({ where: { id: { in: ids } } });
    expect(owners.every((n) => n.studentId === studentRow.id)).toBe(true);

    const othersNote = await prisma.notification.findFirstOrThrow({
      where: { studentId: other.id },
    });
    await request(app)
      .patch(`/api/notifications/${othersNote.id}/read`)
      .set(bearer(student.token))
      .expect(404);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: othersNote.id } })).readAt,
    ).toBeNull();

    const one = await request(app)
      .patch(`/api/notifications/${ids[0]}/read`)
      .set(bearer(student.token))
      .expect(200);
    expect(one.body.data.readAt).toBeTruthy();
    const all = await request(app)
      .patch('/api/notifications/read-all')
      .set(bearer(student.token))
      .expect(200);
    expect(all.body.data.updated).toBeGreaterThanOrEqual(0);
    const after = await request(app)
      .get('/api/notifications?unread=true')
      .set(bearer(student.token))
      .expect(200);
    expect(after.body).toMatchObject({ data: [], unreadCount: 0 });
    expect(
      (await request(app).get('/api/notifications').set(bearer(other.token))).body.unreadCount,
    ).toBeGreaterThan(0);
  });

  it('works for staff and admins too, and requires registration', async () => {
    const staffRes = await request(app)
      .get('/api/notifications')
      .set(bearer((await newApprovedStaff(app, admin, kg.id)).token))
      .expect(200);
    expect(staffRes.body.data.map((n: { type: string }) => n.type)).toContain('STAFF_APPROVED');
    const adminRes = await request(app)
      .get('/api/notifications')
      .set(bearer(admin.token))
      .expect(200);
    expect(adminRes.body.data.map((n: { type: string }) => n.type)).toContain(
      'STAFF_ACCESS_REQUESTED',
    );
  });
});

describe('student recommendations', () => {
  it('suggests the student’s most-ordered items, otherwise popular items', async () => {
    const fresh = await newStudent(app, prisma);
    const before = await request(app)
      .get('/api/students/me/recommendations')
      .set(bearer(fresh.token))
      .expect(200);
    expect(before.body.data.basis).toBe('POPULAR');
    expect(before.body.data.items.length).toBeGreaterThan(0);

    const dosa = await itemByName(prisma, kg.id, 'Onion Dosa');
    const order = await placeOrder(app, fresh, kg.id, [{ menuItemId: dosa.id, quantity: 3 }]);
    await payOrder(app, fresh, order.id);
    const after = await request(app)
      .get(`/api/students/me/recommendations?canteenId=${kg.id}`)
      .set(bearer(fresh.token))
      .expect(200);
    expect(after.body.data.basis).toBe('MOST_ORDERED');
    expect(after.body.data.items[0].name).toBe('Onion Dosa');
  });
});
