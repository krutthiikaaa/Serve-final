import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { startOfIstDay } from '../../src/lib/time.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  itemByName,
  newAdmin,
  newApprovedStaff,
  newStudent,
  payOrder,
  placeOrder,
  type Actor,
} from '../helpers/actors.js';
import { adminReportSchema, expectShape } from '../helpers/contract.js';

const { app, prisma, env } = buildTestApp();

let admin: Actor;
let student: Actor;
let kg: { id: string; name: string };

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  admin = await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
});
afterAll(() => prisma.$disconnect());

function todayParam() {
  const start = startOfIstDay();
  const shifted = new Date(start.getTime() + (5 * 60 + 30) * 60 * 1000);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

describe('admin reports', () => {
  it('keeps DEMO payments out of live sales and counts LIVE payments', async () => {
    const roll = await itemByName(prisma, kg.id, 'Egg Roll');
    const day = todayParam();
    await prisma.canteenPaymentConfig.update({
      where: { canteenId: kg.id },
      data: { mode: 'DEMO' },
    });
    const demoOrder = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    await payOrder(app, student, demoOrder.id);

    const demoRes = await request(app)
      .get('/api/admin/reports')
      .query({ from: day, to: day, canteenId: kg.id })
      .set(bearer(admin.token))
      .expect(200);
    const demoReport = expectShape(adminReportSchema, demoRes.body.data);
    expect(demoReport.payments.demoSalesPaise).toBeGreaterThanOrEqual(demoOrder.totalPaise);
    expect(demoReport.payments.liveSalesPaise).toBe(0);

    await prisma.canteenPaymentConfig.update({
      where: { canteenId: kg.id },
      data: { mode: 'LIVE' },
    });
    const liveOrder = await placeOrder(app, student, kg.id, [{ menuItemId: roll.id, quantity: 1 }]);
    await payOrder(app, student, liveOrder.id);
    const liveRes = await request(app)
      .get('/api/admin/reports')
      .query({ from: day, to: day, canteenId: kg.id, paymentMode: 'LIVE' })
      .set(bearer(admin.token))
      .expect(200);
    const liveReport = expectShape(adminReportSchema, liveRes.body.data);
    expect(liveReport.payments.liveSalesPaise).toBe(liveOrder.totalPaise);
    expect(liveReport.payments.demoSalesPaise).toBe(0);
    expect(liveReport.payments.liveSalesPaise).toBe(
      (
        await prisma.payment.aggregate({
          where: {
            status: 'SUCCESS',
            isSimulated: false,
            refundedAt: null,
            order: {
              canteenId: kg.id,
              paidAt: { gte: startOfIstDay() },
              status: { notIn: ['PLACED', 'CANCELLED'] },
            },
          },
          _sum: { amountPaise: true },
        })
      )._sum.amountPaise ?? 0,
    );
  });

  it('rejects staff and anonymous callers', async () => {
    const staff = await newApprovedStaff(app, admin, kg.id);
    await request(app).get('/api/admin/reports').set(bearer(staff.token)).expect(403);
    await request(app).get('/api/admin/payments').set(bearer(staff.token)).expect(403);
    await request(app).get('/api/admin/settings').set(bearer(staff.token)).expect(403);
    await request(app).get('/api/admin/reports').expect(401);
  });
});
