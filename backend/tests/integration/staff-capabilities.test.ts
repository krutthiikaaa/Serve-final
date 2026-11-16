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

function assign(
  staffId: string,
  primaryCanteenId: string,
  assignments: { canteenId: string; capabilities: string[] }[],
) {
  return request(app)
    .put(`/api/admin/staff/${staffId}/assignments`)
    .set(bearer(admin.token))
    .send({ primaryCanteenId, assignments });
}

async function capabilitiesOn(staffId: string, canteenId: string) {
  const assignment = await prisma.staffCanteenAssignment.findUnique({
    where: { staffId_canteenId: { staffId, canteenId } },
    include: { capabilities: true },
  });
  return (assignment?.capabilities.map((row) => row.capability) ?? []).sort();
}

describe('approved staff keep KITCHEN/MENU/PAUSE and do not get CASHIER', () => {
  it('grants operating capabilities on approval and leaves CASHIER off', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id, { replaceExisting: true });
    expect(await capabilitiesOn(staff.id, kg.id)).toEqual(['KITCHEN', 'MENU', 'PAUSE']);

    await request(app).get('/api/staff/dashboard').set(bearer(staff.token)).expect(200);
    await request(app).get('/api/staff/orders').set(bearer(staff.token)).expect(200);
    await request(app).get('/api/staff/menu').set(bearer(staff.token)).expect(200);
    await request(app)
      .patch('/api/staff/canteen/status')
      .set(bearer(staff.token))
      .send({ isAcceptingOrders: true })
      .expect(200);
    await request(app).get('/api/admin/dashboard').set(bearer(admin.token)).expect(200);
  });
});

describe('capability isolation', () => {
  it('kitchen-only cannot edit menu prices or pause the canteen', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id, { replaceExisting: true });
    await assign(staff.id, kg.id, [{ canteenId: kg.id, capabilities: ['KITCHEN'] }]).expect(200);
    expect(await capabilitiesOn(staff.id, kg.id)).toEqual(['KITCHEN']);

    const item = await itemByName(prisma, kg.id, 'Egg Roll');
    const price = await request(app)
      .patch(`/api/staff/menu/items/${item.id}/price`)
      .set(bearer(staff.token))
      .send({ pricePaise: 9_900 });
    expect(price.status).toBe(403);
    expect(price.body.error.code).toBe('FORBIDDEN_CAPABILITY');

    const pause = await request(app)
      .patch('/api/staff/canteen/status')
      .set(bearer(staff.token))
      .send({ isAcceptingOrders: false });
    expect(pause.status).toBe(403);
    expect(pause.body.error.code).toBe('FORBIDDEN_CAPABILITY');
  });

  it('menu-only cannot update kitchen order status', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id, { replaceExisting: true });
    await assign(staff.id, kg.id, [{ canteenId: kg.id, capabilities: ['MENU'] }]).expect(200);
    const item = await itemByName(prisma, kg.id, 'Veg Grilled Sandwich');
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: item.id, quantity: 1 }]);
    await payOrder(app, student, order.id);

    const kitchen = await request(app)
      .patch(`/api/staff/orders/${order.id}/status`)
      .set(bearer(staff.token))
      .send({ status: 'PREPARING' });
    expect(kitchen.status).toBe(403);
    expect(kitchen.body.error.code).toBe('FORBIDDEN_CAPABILITY');

    await request(app)
      .patch(`/api/staff/menu/items/${item.id}/price`)
      .set(bearer(staff.token))
      .send({ pricePaise: 4_400 })
      .expect(200);
  });

  it('cashier-only cannot update menu, kitchen orders, or pause the canteen', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id, { replaceExisting: true });
    await assign(staff.id, kg.id, [{ canteenId: kg.id, capabilities: ['CASHIER'] }]).expect(200);
    expect(await capabilitiesOn(staff.id, kg.id)).toEqual(['CASHIER']);

    const item = await itemByName(prisma, kg.id, 'Egg Roll');
    const order = await placeOrder(app, student, kg.id, [{ menuItemId: item.id, quantity: 1 }]);
    await payOrder(app, student, order.id);

    for (const res of [
      await request(app)
        .patch(`/api/staff/menu/items/${item.id}/price`)
        .set(bearer(staff.token))
        .send({ pricePaise: 8_800 }),
      await request(app)
        .patch(`/api/staff/orders/${order.id}/status`)
        .set(bearer(staff.token))
        .send({ status: 'PREPARING' }),
      await request(app)
        .patch('/api/staff/canteen/status')
        .set(bearer(staff.token))
        .send({ isAcceptingOrders: false }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_CAPABILITY');
    }
  });

  it('unapproved staff cannot use protected routes even with stale assignment rows', async () => {
    const staff = await newPendingStaff(app, kg.id);
    // Capabilities are only editable on an approved account's own canteen.
    expect(
      (
        await assign(staff.id, kg.id, [
          { canteenId: kg.id, capabilities: ['KITCHEN', 'MENU', 'PAUSE', 'CASHIER'] },
        ]).expect(409)
      ).body.error.code,
    ).toBe('ASSIGNMENT_REQUIRED');
    // Even a stale grant written straight into PostgreSQL is not enough.
    await prisma.staffCanteenAssignment.create({
      data: {
        staffId: staff.id,
        canteenId: kg.id,
        capabilities: { create: [{ capability: 'KITCHEN' }] },
      },
    });

    const res = await request(app).get('/api/staff/orders').set(bearer(staff.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STAFF_NOT_APPROVED');
  });

  it('staff can never operate, or be granted, another canteen', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id, { replaceExisting: true });
    expect(
      (
        await assign(staff.id, kg.id, [
          { canteenId: kg.id, capabilities: ['KITCHEN'] },
          { canteenId: yn.id, capabilities: ['MENU', 'PAUSE'] },
        ]).expect(422)
      ).body.error.code,
    ).toBe('SINGLE_CANTEEN_ONLY');

    // A client-supplied canteen id never switches the operating canteen.
    for (const path of ['/api/staff/orders', '/api/staff/menu', '/api/staff/dashboard']) {
      const res = await request(app).get(path).query({ canteenId: yn.id }).set(bearer(staff.token));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CANTEEN_NOT_ASSIGNED');
    }
    await request(app).get('/api/staff/orders').set(bearer(staff.token)).expect(200);
    await request(app)
      .get('/api/staff/orders')
      .query({ canteenId: kg.id })
      .set(bearer(staff.token))
      .expect(200);
  });
});

describe('admin staff assignment API', () => {
  it('edits capabilities on the account’s own canteen and never moves the account', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id, { replaceExisting: true });
    const res = await assign(staff.id, kg.id, [
      { canteenId: kg.id, capabilities: ['KITCHEN', 'MENU', 'CASHIER'] },
    ]).expect(200);
    expect(res.body.data).toMatchObject({ id: staff.id, status: 'APPROVED', canteenId: kg.id });
    expect(res.body.data.assignments).toEqual([
      expect.objectContaining({
        canteenId: kg.id,
        capabilities: expect.arrayContaining(['CASHIER', 'KITCHEN', 'MENU']),
      }),
    ]);

    const moved = await assign(staff.id, yn.id, [{ canteenId: yn.id, capabilities: ['KITCHEN'] }]);
    expect(moved.status).toBe(409);
    expect(moved.body.error.code).toBe('ASSIGNMENT_REQUIRED');
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).canteenId).toBe(
      kg.id,
    );
  });

  it('rejects an assignment list naming any other canteen', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id, { replaceExisting: true });
    const res = await assign(staff.id, kg.id, [{ canteenId: yn.id, capabilities: ['KITCHEN'] }]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SINGLE_CANTEEN_ONLY');
  });
});
