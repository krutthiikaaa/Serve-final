import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import { auditRecords, capturingLogger } from '../helpers/logger.js';
import {
  bearer,
  canteenBySlug,
  itemByName,
  newAdmin,
  newApprovedStaff,
  newStudent,
  type Actor,
} from '../helpers/actors.js';

const { logger, records } = capturingLogger();
const { app, prisma, env } = buildTestApp({}, { logger });

let admin: Actor;
let student: Actor;
let staff: Actor;
let kg: { id: string; name: string };

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  admin = await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
  staff = await newApprovedStaff(app, admin, kg.id);
});
afterAll(() => prisma.$disconnect());

const dayWindow = { weekday: 1, opensAtMinutes: 8 * 60, closesAtMinutes: 16 * 60 };
const nightWindow = { weekday: 1, opensAtMinutes: 18 * 60, closesAtMinutes: 23 * 60 };
const overlappingNight = { weekday: 1, opensAtMinutes: 12 * 60, closesAtMinutes: 20 * 60 };

describe('admin canteen service configuration', () => {
  it('creates DAY and NIGHT services without deleting the other period', async () => {
    const created = await request(app)
      .put(`/api/admin/canteens/${kg.id}/services`)
      .set(bearer(admin.token))
      .send({
        services: [{ period: 'DAY', isEnabled: true, override: 'FORCE_OPEN' }],
      })
      .expect(200);

    const periods = created.body.data.services.map((row: { period: string }) => row.period).sort();
    expect(periods).toEqual(['DAY', 'NIGHT']);
    expect(created.body.data.services.find((row: { period: string }) => row.period === 'NIGHT')).toMatchObject({
      isEnabled: true,
      override: 'FORCE_OPEN',
    });

    const again = await request(app)
      .put(`/api/admin/canteens/${kg.id}/services`)
      .set(bearer(admin.token))
      .send({
        services: [{ period: 'DAY', isEnabled: true, override: 'FORCE_OPEN' }],
      })
      .expect(200);
    expect(again.body.data.services).toHaveLength(2);

    const duplicate = await request(app)
      .put(`/api/admin/canteens/${kg.id}/services`)
      .set(bearer(admin.token))
      .send({
        services: [
          { period: 'DAY', isEnabled: true, override: 'AUTO' },
          { period: 'DAY', isEnabled: false, override: 'AUTO' },
        ],
      });
    expect(duplicate.status).toBe(422);
    expect(duplicate.body.error.code).toBe('DUPLICATE_SERVICE');
  });

  it('rejects invalid and AUTO-empty schedules, and allows FORCE_OPEN without hours', async () => {
    await request(app)
      .put(`/api/admin/canteens/${kg.id}/services`)
      .set(bearer(admin.token))
      .send({
        services: [
          { period: 'DAY', isEnabled: true, override: 'AUTO' },
          { period: 'NIGHT', isEnabled: true, override: 'FORCE_OPEN' },
        ],
      })
      .expect(200);

    const autoEmpty = await request(app)
      .put(`/api/admin/canteens/${kg.id}/services/DAY/schedule`)
      .set(bearer(admin.token))
      .send({ schedules: [] });
    expect(autoEmpty.status).toBe(422);
    expect(autoEmpty.body.error.code).toBe('AUTO_WITHOUT_SCHEDULE');

    const invalid = await request(app)
      .put(`/api/admin/canteens/${kg.id}/services/DAY/schedule`)
      .set(bearer(admin.token))
      .send({ schedules: [{ weekday: 1, opensAtMinutes: 600, closesAtMinutes: 600 }] });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('INVALID_SCHEDULE');

    await request(app)
      .put(`/api/admin/canteens/${kg.id}/services/NIGHT/schedule`)
      .set(bearer(admin.token))
      .send({ schedules: [] })
      .expect(200);

    await request(app)
      .put(`/api/admin/canteens/${kg.id}/services/DAY/schedule`)
      .set(bearer(admin.token))
      .send({ schedules: [dayWindow] })
      .expect(200);
  });

  it('warns when DAY and NIGHT overlap instead of rewriting either schedule', async () => {
    await request(app)
      .put(`/api/admin/canteens/${kg.id}/services`)
      .set(bearer(admin.token))
      .send({
        services: [
          { period: 'DAY', isEnabled: true, override: 'AUTO' },
          { period: 'NIGHT', isEnabled: true, override: 'AUTO' },
        ],
      })
      .expect(200);

    await request(app)
      .put(`/api/admin/canteens/${kg.id}/services/DAY/schedule`)
      .set(bearer(admin.token))
      .send({ schedules: [dayWindow] })
      .expect(200);
    const night = await request(app)
      .put(`/api/admin/canteens/${kg.id}/services/NIGHT/schedule`)
      .set(bearer(admin.token))
      .send({ schedules: [overlappingNight] })
      .expect(200);

    expect(night.body.data.configurationWarnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PERIOD_SCHEDULE_OVERLAP' })]),
    );
    expect(night.body.data.services.find((row: { period: string }) => row.period === 'DAY').schedules).toEqual([
      dayWindow,
    ]);
    expect(night.body.data.services.find((row: { period: string }) => row.period === 'NIGHT').schedules).toEqual([
      overlappingNight,
    ]);

    await request(app)
      .put(`/api/admin/canteens/${kg.id}/services/NIGHT/schedule`)
      .set(bearer(admin.token))
      .send({ schedules: [nightWindow] })
      .expect(200);
  });
});

describe('admin menu service pricing', () => {
  it('configures DAY and NIGHT independently and rejects invalid prices', async () => {
    const item = await itemByName(prisma, kg.id, 'Egg Roll');
    const nightBefore = await prisma.menuItemService.findUniqueOrThrow({
      where: { menuItemId_period: { menuItemId: item.id, period: 'NIGHT' } },
    });

    const dayOnly = await request(app)
      .put(`/api/admin/menu/items/${item.id}/services`)
      .set(bearer(admin.token))
      .send({
        services: [{ period: 'DAY', pricePaise: 5_500, isAvailable: true }],
      })
      .expect(200);

    expect(dayOnly.body.data.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ period: 'DAY', pricePaise: 5_500 }),
        expect.objectContaining({ period: 'NIGHT', pricePaise: nightBefore.pricePaise }),
      ]),
    );
    const nightAfterDay = await prisma.menuItemService.findUniqueOrThrow({
      where: { menuItemId_period: { menuItemId: item.id, period: 'NIGHT' } },
    });
    expect(nightAfterDay.pricePaise).toBe(nightBefore.pricePaise);

    const night = await request(app)
      .put(`/api/admin/menu/items/${item.id}/services`)
      .set(bearer(admin.token))
      .send({
        services: [{ period: 'NIGHT', pricePaise: 6_100, isAvailable: true }],
      })
      .expect(200);
    expect(night.body.data.services.find((row: { period: string }) => row.period === 'DAY').pricePaise).toBe(
      5_500,
    );
    expect(night.body.data.services.find((row: { period: string }) => row.period === 'NIGHT').pricePaise).toBe(
      6_100,
    );

    const invalid = await request(app)
      .put(`/api/admin/menu/items/${item.id}/services`)
      .set(bearer(admin.token))
      .send({ services: [{ period: 'DAY', pricePaise: 0, isAvailable: true }] });
    expect(invalid.status).toBe(422);

    const asStaff = await request(app)
      .put(`/api/admin/menu/items/${item.id}/services`)
      .set(bearer(staff.token))
      .send({ services: [{ period: 'DAY', pricePaise: 1_000, isAvailable: true }] });
    expect(asStaff.status).toBe(403);
  });
});

describe('admin UPI payment configuration', () => {
  it('creates and updates payment config, rejects bad VPA/URLs, and hides the route from staff and students', async () => {
    const missing = await request(app)
      .get(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .expect(200);
    expect(missing.body.data.mode).toBe('DEMO');
    expect(missing.body.data.upiVpa).toBeNull();
    expect(missing.body.data.demoQr.warning).toBe('DEMO ONLY — NOT PAYABLE');

    const created = await request(app)
      .put(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .send({
        upiVpa: 'kg-canteen@okicici',
        merchantName: 'KG Night Canteen',
        qrImageUrl: 'https://cdn.example.com/canteens/kg/qr.png',
        qrStorageKey: 'canteen-qr/kg.png',
        instructions: 'Pay and show the screenshot at the counter.',
        isActive: true,
      })
      .expect(200);
    expect(created.body.data).toMatchObject({
      canteenId: kg.id,
      upiVpa: 'kg-canteen@okicici',
      merchantName: 'KG Night Canteen',
      isActive: true,
    });

    const badVpa = await request(app)
      .put(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .send({ upiVpa: 'not-a-vpa' });
    expect(badVpa.status).toBe(422);

    const localAsset = await request(app)
      .put(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .send({ qrImageUrl: '/assets/qr.png' });
    expect(localAsset.status).toBe(422);

    const httpUrl = await request(app)
      .put(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .send({ qrImageUrl: 'http://cdn.example.com/qr.png' });
    expect(httpUrl.status).toBe(422);

    const extras = await request(app)
      .put(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .send({ ifsc: 'SBIN0001234', accountNumber: '123456', password: 'secret' });
    expect(extras.status).toBe(422);

    for (const actor of [staff, student]) {
      expect(
        (
          await request(app)
            .get(`/api/admin/canteens/${kg.id}/payment-config`)
            .set(bearer(actor.token))
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .put(`/api/admin/canteens/${kg.id}/payment-config`)
            .set(bearer(actor.token))
            .send({ isActive: false })
        ).status,
      ).toBe(403);
    }

    const publicCanteen = await request(app)
      .get(`/api/canteens/${kg.id}`)
      .set(bearer(student.token))
      .expect(200);
    expect(JSON.stringify(publicCanteen.body)).not.toContain('okicici');
    expect(publicCanteen.body.data.upiVpa).toBeUndefined();
  });
});

describe('admin configuration audit', () => {
  it('records sensitive admin changes without writing secrets', async () => {
    await request(app)
      .put(`/api/admin/canteens/${kg.id}/payment-config`)
      .set(bearer(admin.token))
      .send({
        upiVpa: 'secret-vpa@paytm',
        qrStorageKey: 'internal/object-key',
        isActive: false,
      })
      .expect(200);

    const audits = auditRecords(records);
    expect(audits.some((row) => row.action === 'admin.canteen.services.update')).toBe(true);
    expect(audits.some((row) => row.action === 'admin.canteen.schedule.update')).toBe(true);
    expect(audits.some((row) => row.action === 'admin.menu.item.services.update')).toBe(true);
    expect(audits.some((row) => row.action === 'admin.canteen.payment_config.update')).toBe(true);
    expect(audits.some((row) => row.action === 'admin.staff.assigned')).toBe(true);

    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain('secret-vpa@paytm');
    expect(serialized).not.toContain('internal/object-key');
    expect(serialized).not.toContain('ifsc');
    expect(serialized).not.toContain('SBIN0001234');
  });
});
