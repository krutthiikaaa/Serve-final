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
let kgDay: { id: string };
let yn: { id: string };
let coffee: { id: string };
let dayCoffee: { id: string };
let sandwich: { id: string };

const itemsOf = (body: {
  data: { categories: { items: { name: string; pricePaise: number }[] }[] };
}) => body.data.categories.flatMap((category) => category.items);

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  kgDay = await canteenBySlug(prisma, 'krishna-godavari-day');
  yn = await canteenBySlug(prisma, 'yamuna-narmada');
  coffee = await itemByName(prisma, kg.id, 'Coffee');
  dayCoffee = await itemByName(prisma, kgDay.id, 'Coffee');
  sandwich = await itemByName(prisma, kg.id, 'Veg Grilled Sandwich');
  await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
});
afterAll(() => prisma.$disconnect());

describe('canteen DTOs', () => {
  it('identifies the type, service area and availability of Day and Night canteens', async () => {
    const list = await request(app).get('/api/canteens').set(bearer(student.token)).expect(200);
    const night = list.body.data.find((canteen: { id: string }) => canteen.id === kg.id);
    const day = list.body.data.find((canteen: { id: string }) => canteen.id === kgDay.id);
    expect(night).toMatchObject({
      type: 'NIGHT',
      serviceArea: { name: 'Krishna & Godavari' },
      supportedPeriods: ['NIGHT'],
      services: [{ period: 'NIGHT', isEnabled: true, override: 'FORCE_OPEN', isOpenNow: true }],
      availability: { state: 'OPEN', isOpenNow: true },
    });
    expect(day).toMatchObject({
      type: 'DAY',
      serviceArea: { id: night.serviceArea.id },
      supportedPeriods: ['DAY'],
      isAcceptingOrders: false,
      availability: {
        state: 'OTHER_SERVICE_ACTIVE',
        isOpenNow: false,
        otherServiceCanteen: { id: kg.id, type: 'NIGHT' },
      },
    });
    expect(night.configurationWarnings).toEqual([]);
    expect(night).not.toHaveProperty('upiVpa');
    expect(night).not.toHaveProperty('qrStorageKey');
  });
});

describe('menu and pricing follow the canteen type', () => {
  it('serves each canteen its own menu and period; a legacy ?period= is ignored', async () => {
    const nightMenu = await request(app)
      .get(`/api/canteens/${kg.id}/menu`)
      .query({ period: 'DAY' })
      .set(bearer(student.token))
      .expect(200);
    expect(nightMenu.body.data.servicePeriod).toBe('NIGHT');
    expect(itemsOf(nightMenu.body).find((item) => item.name === 'Coffee')?.pricePaise).toBe(3_000);

    const dayMenu = await request(app)
      .get(`/api/canteens/${kgDay.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    expect(dayMenu.body.data.servicePeriod).toBe('DAY');
    const dayItems = itemsOf(dayMenu.body);
    expect(dayItems.find((item) => item.name === 'Coffee')?.pricePaise).toBe(2_500);
    expect(dayItems.some((item) => item.name === 'Veg Grilled Sandwich')).toBe(false);
    expect(dayItems.some((item) => item.name === 'Masala Dosa')).toBe(true);
  });

  it('quotes in the canteen’s own period and ignores client prices', async () => {
    const night = await request(app)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({ canteenId: kg.id, items: [{ menuItemId: coffee.id, quantity: 2 }] })
      .expect(200);
    expect(night.body.data).toMatchObject({
      canteen: { id: kg.id, type: 'NIGHT' },
      servicePeriod: 'NIGHT',
      totalPaise: 6_000,
      items: [{ unitPricePaise: 3_000, lineTotalPaise: 6_000 }],
    });

    const clientPrice = await request(app)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({
        canteenId: kg.id,
        items: [{ menuItemId: coffee.id, quantity: 2, unitPricePaise: 1 }],
      });
    expect(clientPrice.status).toBe(422);

    const wrongPeriod = await request(app)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({
        canteenId: kg.id,
        servicePeriod: 'DAY',
        items: [{ menuItemId: coffee.id, quantity: 1 }],
      })
      .expect(422);
    expect(wrongPeriod.body.error.code).toBe('SERVICE_PERIOD_MISMATCH');
  });

  it('refuses quotes from the Day canteen while the Night canteen serves the area', async () => {
    const res = await request(app)
      .post('/api/cart/quote')
      .set(bearer(student.token))
      .send({ canteenId: kgDay.id, items: [{ menuItemId: dayCoffee.id, quantity: 1 }] })
      .expect(409);
    expect(res.body.error.code).toBe('CANTEEN_NOT_ACCEPTING_ORDERS');
  });

  it('does not fall back to MenuItem.pricePaise when the period row is missing', async () => {
    const row = await prisma.menuItemService.findUniqueOrThrow({
      where: { menuItemId_period: { menuItemId: sandwich.id, period: 'NIGHT' } },
    });
    await prisma.menuItemService.delete({ where: { id: row.id } });
    try {
      const res = await request(app)
        .post('/api/cart/quote')
        .set(bearer(student.token))
        .send({ canteenId: kg.id, items: [{ menuItemId: sandwich.id, quantity: 1 }] })
        .expect(409);
      expect(res.body.error.code).toBe('PERIOD_PRICE_NOT_CONFIGURED');
    } finally {
      await prisma.menuItemService.create({
        data: {
          menuItemId: sandwich.id,
          period: 'NIGHT',
          pricePaise: row.pricePaise,
          isAvailable: row.isAvailable,
        },
      });
    }
  });

  it('rejects unavailable period rows and foreign-canteen items', async () => {
    await prisma.menuItemService.update({
      where: { menuItemId_period: { menuItemId: coffee.id, period: 'NIGHT' } },
      data: { isAvailable: false },
    });
    try {
      const res = await request(app)
        .post('/api/cart/quote')
        .set(bearer(student.token))
        .send({ canteenId: kg.id, items: [{ menuItemId: coffee.id, quantity: 1 }] })
        .expect(422);
      expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
    } finally {
      await prisma.menuItemService.update({
        where: { menuItemId_period: { menuItemId: coffee.id, period: 'NIGHT' } },
        data: { isAvailable: true },
      });
    }

    for (const foreign of [await itemByName(prisma, yn.id, 'Coffee'), dayCoffee]) {
      const mixed = await request(app)
        .post('/api/cart/quote')
        .set(bearer(student.token))
        .send({
          canteenId: kg.id,
          items: [
            { menuItemId: coffee.id, quantity: 1 },
            { menuItemId: foreign.id, quantity: 1 },
          ],
        })
        .expect(422);
      expect(mixed.body.error.code).toBe('ITEM_NOT_FOUND');
    }
  });

  it('stores servicePeriod and keeps OrderItem snapshots when prices change', async () => {
    const created = await request(app)
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', idempotencyKey())
      .send({ canteenId: kg.id, items: [{ menuItemId: coffee.id, quantity: 1 }] })
      .expect(201);
    expect(created.body.data.servicePeriod).toBe('NIGHT');
    expect(created.body.data.canteen).toEqual({
      id: kg.id,
      name: 'Krishna & Godavari Night Canteen',
      type: 'NIGHT',
    });
    expect(created.body.data.items[0]).toMatchObject({
      itemName: 'Coffee',
      unitPricePaise: 3_000,
      lineTotalPaise: 3_000,
    });
    const snapshotId = created.body.data.items[0].id;

    await prisma.menuItemService.update({
      where: { menuItemId_period: { menuItemId: coffee.id, period: 'NIGHT' } },
      data: { pricePaise: 9_900 },
    });
    try {
      const snapshot = await prisma.orderItem.findUniqueOrThrow({ where: { id: snapshotId } });
      expect(snapshot).toMatchObject({ unitPricePaise: 3_000, lineTotalPaise: 3_000 });
    } finally {
      await prisma.menuItemService.update({
        where: { menuItemId_period: { menuItemId: coffee.id, period: 'NIGHT' } },
        data: { pricePaise: 3_000 },
      });
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
      (await request(app).post('/api/cart/quote').set(bearer(student.token)).send(body).expect(409))
        .body.error.code,
    ).toBe('CANTEEN_INACTIVE');
    await prisma.canteen.update({
      where: { id: kg.id },
      data: { isActive: true, isAcceptingOrders: false },
    });
    expect(
      (await request(app).post('/api/cart/quote').set(bearer(student.token)).send(body).expect(409))
        .body.error.code,
    ).toBe('CANTEEN_NOT_ACCEPTING_ORDERS');
    await prisma.canteen.update({ where: { id: kg.id }, data: { isAcceptingOrders: true } });

    await prisma.canteenService.update({
      where: { id: night.id },
      data: { isEnabled: false, override: 'FORCE_OPEN' },
    });
    expect(
      (await request(app).post('/api/cart/quote').set(bearer(student.token)).send(body).expect(409))
        .body.error.code,
    ).toBe('SERVICE_DISABLED');

    await prisma.canteenService.update({
      where: { id: night.id },
      data: { isEnabled: true, override: 'FORCE_CLOSED' },
    });
    expect(
      (await request(app).post('/api/cart/quote').set(bearer(student.token)).send(body).expect(409))
        .body.error.code,
    ).toBe('SERVICE_CLOSED');

    await prisma.canteenService.update({
      where: { id: night.id },
      data: { override: 'AUTO' },
    });
    expect(
      (await request(app).post('/api/cart/quote').set(bearer(student.token)).send(body).expect(409))
        .body.error.code,
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
