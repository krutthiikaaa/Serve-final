import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { createApp } from '../../src/app.js';
import { fromIst } from '../../src/lib/time.js';
import { buildTestApp, buildTestContext } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  idempotencyKey,
  itemByName,
  newAdmin,
  newStudent,
  type Actor,
} from '../helpers/actors.js';

const { app, prisma, env } = buildTestApp();

let student: Actor;
let kg: { id: string };
let yn: { id: string };
let coffee: { id: string };
let sandwich: { id: string };

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  yn = await canteenBySlug(prisma, 'yamuna-narmada');
  coffee = await itemByName(prisma, kg.id, 'Coffee');
  sandwich = await itemByName(prisma, kg.id, 'Veg Grilled Sandwich');
  await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
  await prisma.canteenService.create({
    data: { canteenId: kg.id, period: 'DAY', isEnabled: true, override: 'FORCE_OPEN' },
  });
  await prisma.menuItemService.create({
    data: { menuItemId: coffee.id, period: 'DAY', pricePaise: 2_000, isAvailable: true },
  });
});
afterAll(() => prisma.$disconnect());

describe('canteen DTOs', () => {
  it('includes supported periods, FORCE_OPEN night services, and isOpenNow', async () => {
    const list = await request(app).get('/api/canteens').set(bearer(student.token)).expect(200);
    const row = list.body.data.find((canteen: { id: string }) => canteen.id === kg.id);
    expect(row.supportedPeriods).toEqual(['DAY', 'NIGHT']);
    expect(row.services).toEqual([
      { period: 'DAY', isEnabled: true, override: 'FORCE_OPEN', isOpenNow: true },
      { period: 'NIGHT', isEnabled: true, override: 'FORCE_OPEN', isOpenNow: true },
    ]);
    expect(row.configurationWarnings).toEqual([]);
    expect(row).not.toHaveProperty('upiVpa');
    expect(row).not.toHaveProperty('qrStorageKey');

    const one = await request(app)
      .get(`/api/canteens/${kg.id}`)
      .set(bearer(student.token))
      .expect(200);
    expect(one.body.data.services[0].isOpenNow).toBe(true);
  });
});

describe('period menu and pricing', () => {
  it('defaults to NIGHT prices and uses DAY prices when requested', async () => {
    const nightMenu = await request(app)
      .get(`/api/canteens/${kg.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    expect(nightMenu.body.data.servicePeriod).toBe('NIGHT');
    const nightCoffee = nightMenu.body.data.categories
      .flatMap((category: { items: { name: string; pricePaise: number }[] }) => category.items)
      .find((item: { name: string }) => item.name === 'Coffee');
    expect(nightCoffee.pricePaise).toBe(3_000);

    const dayMenu = await request(app)
      .get(`/api/canteens/${kg.id}/menu`)
      .query({ period: 'DAY' })
      .set(bearer(student.token))
      .expect(200);
    expect(dayMenu.body.data.servicePeriod).toBe('DAY');
    const dayItems = dayMenu.body.data.categories.flatMap(
      (category: { items: { name: string; pricePaise: number }[] }) => category.items,
    );
    expect(dayItems).toEqual([
      expect.objectContaining({ name: 'Coffee', pricePaise: 2_000 }),
    ]);
    expect(dayItems.some((item: { name: string }) => item.name === 'Veg Grilled Sandwich')).toBe(
      false,
    );
  });

  it('quotes NIGHT by default, DAY when asked, and ignores client prices', async () => {
    const night = await request(app)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({ canteenId: kg.id, items: [{ menuItemId: coffee.id, quantity: 2 }] })
      .expect(200);
    expect(night.body.data).toMatchObject({
      servicePeriod: 'NIGHT',
      totalPaise: 6_000,
      items: [{ unitPricePaise: 3_000, lineTotalPaise: 6_000 }],
    });

    const day = await request(app)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({
        canteenId: kg.id,
        servicePeriod: 'DAY',
        items: [{ menuItemId: coffee.id, quantity: 2, unitPricePaise: 1 }],
      });
    expect(day.status).toBe(422);

    const dayOk = await request(app)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({
        canteenId: kg.id,
        servicePeriod: 'DAY',
        items: [{ menuItemId: coffee.id, quantity: 2 }],
      })
      .expect(200);
    expect(dayOk.body.data).toMatchObject({ servicePeriod: 'DAY', totalPaise: 4_000 });
  });

  it('does not fall back to MenuItem.pricePaise when the period row is missing', async () => {
    const res = await request(app)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({
        canteenId: kg.id,
        servicePeriod: 'DAY',
        items: [{ menuItemId: sandwich.id, quantity: 1 }],
      })
      .expect(409);
    expect(res.body.error.code).toBe('PERIOD_PRICE_NOT_CONFIGURED');
  });

  it('rejects unavailable period rows and foreign-canteen items', async () => {
    await prisma.menuItemService.update({
      where: { menuItemId_period: { menuItemId: coffee.id, period: 'DAY' } },
      data: { isAvailable: false },
    });
    try {
      const res = await request(app)
        .post('/api/cart/quote')
        .set(bearer(student.token))
        .send({
          canteenId: kg.id,
          servicePeriod: 'DAY',
          items: [{ menuItemId: coffee.id, quantity: 1 }],
        })
        .expect(422);
      expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
    } finally {
      await prisma.menuItemService.update({
        where: { menuItemId_period: { menuItemId: coffee.id, period: 'DAY' } },
        data: { isAvailable: true },
      });
    }

    const ynCoffee = await itemByName(prisma, yn.id, 'Coffee');
    const mixed = await request(app)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({
        canteenId: kg.id,
        items: [
          { menuItemId: coffee.id, quantity: 1 },
          { menuItemId: ynCoffee.id, quantity: 1 },
        ],
      })
      .expect(422);
    expect(mixed.body.error.code).toBe('ITEM_NOT_FOUND');
  });

  it('stores servicePeriod and keeps OrderItem snapshots when prices change', async () => {
    const created = await request(app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', idempotencyKey())
      .send({
        canteenId: kg.id,
        servicePeriod: 'DAY',
        items: [{ menuItemId: coffee.id, quantity: 1 }],
      })
      .expect(201);
    expect(created.body.data.servicePeriod).toBe('DAY');
    expect(created.body.data.items[0]).toMatchObject({
      itemName: 'Coffee',
      unitPricePaise: 2_000,
      lineTotalPaise: 2_000,
    });
    const snapshotId = created.body.data.items[0].id;

    await prisma.menuItemService.update({
      where: { menuItemId_period: { menuItemId: coffee.id, period: 'DAY' } },
      data: { pricePaise: 9_900 },
    });
    await prisma.menuItem.update({ where: { id: coffee.id }, data: { pricePaise: 9_900 } });
    try {
      const snapshot = await prisma.orderItem.findUniqueOrThrow({ where: { id: snapshotId } });
      expect(snapshot).toMatchObject({ unitPricePaise: 2_000, lineTotalPaise: 2_000 });
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: created.body.data.id } }))
          .servicePeriod,
      ).toBe('DAY');
    } finally {
      await prisma.menuItemService.update({
        where: { menuItemId_period: { menuItemId: coffee.id, period: 'DAY' } },
        data: { pricePaise: 2_000 },
      });
      await prisma.menuItem.update({ where: { id: coffee.id }, data: { pricePaise: 3_000 } });
    }
  });
});

describe('availability gates on quote and order', () => {
  it('follows the canteen/service priority and AUTO schedule clock', async () => {
    const night = await prisma.canteenService.findUniqueOrThrow({
      where: { canteenId_period: { canteenId: kg.id, period: 'NIGHT' } },
    });
    const body = { canteenId: kg.id, items: [{ menuItemId: coffee.id, quantity: 1 }] };

    await prisma.canteen.update({ where: { id: kg.id }, data: { isActive: false } });
    expect(
      (
        await request(app)
          .post('/api/cart/quote')
          .set(bearer(student.token))
          .send(body)
          .expect(409)
      ).body.error.code,
    ).toBe('CANTEEN_INACTIVE');
    await prisma.canteen.update({
      where: { id: kg.id },
      data: { isActive: true, isAcceptingOrders: false },
    });
    expect(
      (
        await request(app)
          .post('/api/cart/quote')
          .set(bearer(student.token))
          .send(body)
          .expect(409)
      ).body.error.code,
    ).toBe('CANTEEN_NOT_ACCEPTING_ORDERS');
    await prisma.canteen.update({ where: { id: kg.id }, data: { isAcceptingOrders: true } });

    await prisma.canteenService.update({
      where: { id: night.id },
      data: { isEnabled: false, override: 'FORCE_OPEN' },
    });
    expect(
      (
        await request(app)
          .post('/api/cart/quote')
          .set(bearer(student.token))
          .send(body)
          .expect(409)
      ).body.error.code,
    ).toBe('SERVICE_DISABLED');

    await prisma.canteenService.update({
      where: { id: night.id },
      data: { isEnabled: true, override: 'FORCE_CLOSED' },
    });
    expect(
      (
        await request(app)
          .post('/api/cart/quote')
          .set(bearer(student.token))
          .send(body)
          .expect(409)
      ).body.error.code,
    ).toBe('SERVICE_CLOSED');

    await prisma.canteenService.update({
      where: { id: night.id },
      data: { override: 'AUTO' },
    });
    expect(
      (
        await request(app)
          .post('/api/cart/quote')
          .set(bearer(student.token))
          .send(body)
          .expect(409)
      ).body.error.code,
    ).toBe('SERVICE_SCHEDULE_NOT_CONFIGURED');
    const warned = await request(app)
      .get(`/api/canteens/${kg.id}`)
      .set(bearer(student.token))
      .expect(200);
    expect(warned.body.data.configurationWarnings).toEqual([
      { period: 'NIGHT', code: 'AUTO_WITHOUT_SCHEDULE' },
    ]);
    expect(
      warned.body.data.services.find((service: { period: string }) => service.period === 'NIGHT')
        .isOpenNow,
    ).toBe(false);

    await prisma.canteenOperatingSchedule.create({
      data: {
        canteenServiceId: night.id,
        weekday: 1,
        opensAtMinutes: 21 * 60,
        closesAtMinutes: 3 * 60,
      },
    });

    const frozen = { current: fromIst({ year: 2026, month: 11, day: 3, hours: 1 }) };
    const timed = createApp(buildTestContext({ prisma, clock: () => frozen.current }));
    expect(
      (
        await request(timed)
          .post('/api/cart/quote')
          .set(bearer(student.token))
          .send(body)
          .expect(200)
      ).body.data.totalPaise,
    ).toBe(3_000);

    frozen.current = fromIst({ year: 2026, month: 11, day: 3, hours: 3 });
    expect(
      (
        await request(timed)
          .post('/api/orders')
          .set(bearer(student.token))
          .set('Idempotency-Key', idempotencyKey())
          .send(body)
          .expect(409)
      ).body.error.code,
    ).toBe('SERVICE_CLOSED');

    await prisma.canteenOperatingSchedule.create({
      data: {
        canteenServiceId: night.id,
        weekday: 2,
        opensAtMinutes: 2 * 60,
        closesAtMinutes: 14 * 60,
      },
    });
    frozen.current = fromIst({ year: 2026, month: 11, day: 3, hours: 1 });
    const invalid = await request(timed)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send(body)
      .expect(409);
    expect(invalid.body.error.code).toBe('SERVICE_SCHEDULE_NOT_CONFIGURED');

    await prisma.canteenOperatingSchedule.deleteMany({ where: { canteenServiceId: night.id } });
    await prisma.canteenService.update({
      where: { id: night.id },
      data: { isEnabled: true, override: 'FORCE_OPEN' },
    });
  });
});
