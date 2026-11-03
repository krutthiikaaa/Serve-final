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
    const staff = await newApprovedStaff(app, admin, kg.id);
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
    const staff = await newApprovedStaff(app, admin, kg.id);
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
    const staff = await newApprovedStaff(app, admin, kg.id);
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
    const staff = await newApprovedStaff(app, admin, kg.id);
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

  it('unapproved staff cannot use protected routes even with assignments', async () => {
    const staff = await newPendingStaff(app, kg.id);
    await assign(staff.id, kg.id, [
      { canteenId: kg.id, capabilities: ['KITCHEN', 'MENU', 'PAUSE', 'CASHIER'] },
    ]).expect(200);

    const res = await request(app).get('/api/staff/orders').set(bearer(staff.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STAFF_NOT_APPROVED');
  });

  it('staff cannot operate another canteen without a primary assignment there', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id);
    await assign(staff.id, kg.id, [
      { canteenId: kg.id, capabilities: ['KITCHEN'] },
      { canteenId: yn.id, capabilities: ['MENU', 'PAUSE'] },
    ]).expect(200);

    const item = await itemByName(prisma, kg.id, 'Egg Roll');
    const menu = await request(app)
      .patch(`/api/staff/menu/items/${item.id}/price`)
      .set(bearer(staff.token))
      .send({ pricePaise: 6_600 });
    expect(menu.status).toBe(403);

    await request(app).get('/api/staff/orders').set(bearer(staff.token)).expect(200);
  });
});

describe('admin staff assignment API', () => {
  it('grants multiple capabilities and canteens, keeps primary consistent, and does not auto-add CASHIER', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id);
    const res = await assign(staff.id, yn.id, [
      { canteenId: kg.id, capabilities: ['KITCHEN', 'MENU'] },
      { canteenId: yn.id, capabilities: ['PAUSE'] },
    ]).expect(200);

    expect(res.body.data).toMatchObject({
      id: staff.id,
      status: 'APPROVED',
      canteenId: yn.id,
    });
    expect(res.body.data.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canteenId: kg.id,
          capabilities: expect.arrayContaining(['KITCHEN', 'MENU']),
        }),
        expect.objectContaining({ canteenId: yn.id, capabilities: ['PAUSE'] }),
      ]),
    );
    expect(res.body.data.assignments.every((row: { capabilities: string[] }) => !row.capabilities.includes('CASHIER'))).toBe(
      true,
    );

    const row = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(row.canteenId).toBe(yn.id);

    const removed = await assign(staff.id, yn.id, [
      { canteenId: yn.id, capabilities: ['KITCHEN'] },
    ]).expect(200);
    expect(removed.body.data.assignments).toHaveLength(1);
    expect(await prisma.staffCanteenAssignment.findUnique({
      where: { staffId_canteenId: { staffId: staff.id, canteenId: kg.id } },
    })).toBeNull();
  });

  it('rejects a primary canteen that is missing from the assignment list', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id);
    const res = await assign(staff.id, yn.id, [{ canteenId: kg.id, capabilities: ['KITCHEN'] }]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRIMARY_ASSIGNMENT_REQUIRED');
  });
});
