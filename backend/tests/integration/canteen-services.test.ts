import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_CANTEENS, SEED_MENU, seedDatabase } from '../../src/db/seed.js';
import { createTestPrisma, truncateAll } from '../helpers/db.js';

/**
 * Phase 1 schema, backfill and seed guarantees. Hits the real PostgreSQL
 * test database (migrated by tests/global-setup.ts). Prisma is not mocked.
 */
const prisma = createTestPrisma();

afterAll(() => prisma.$disconnect());

async function makeCanteen(name = `Canteen ${randomUUID().slice(0, 8)}`) {
  return prisma.canteen.create({
    data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
  });
}

async function makeMenu(canteenId: string, pricePaise = 7_000, isAvailable = true) {
  const category = await prisma.menuCategory.create({
    data: { canteenId, name: `Cat ${randomUUID().slice(0, 6)}` },
  });
  const item = await prisma.menuItem.create({
    data: {
      canteenId,
      categoryId: category.id,
      name: `Item ${randomUUID().slice(0, 6)}`,
      pricePaise,
      isAvailable,
    },
  });
  return { category, item };
}

async function makeStudent(canteenId: string) {
  const hostel = await prisma.hostel.create({
    data: { name: `Hostel ${randomUUID().slice(0, 8)}`, canteenId },
  });
  const tag = randomUUID().slice(0, 8);
  return prisma.student.create({
    data: {
      firebaseUid: `uid-${tag}`,
      email: `s-${tag}@example.edu`,
      name: 'Student',
      hostelId: hostel.id,
    },
  });
}

async function makeApprovedStaff(canteenId: string) {
  const tag = randomUUID().slice(0, 8);
  return prisma.staff.create({
    data: {
      firebaseUid: `st-${tag}`,
      email: `st-${tag}@example.edu`,
      name: 'Staff',
      status: 'APPROVED',
      canteenId,
    },
  });
}

function loadBackfillSql(): string {
  const migrationsDir = path.resolve(import.meta.dirname, '../../prisma/migrations');
  const folder = readdirSync(migrationsDir).find((name) =>
    name.endsWith('_canteen_day_night_services'),
  );
  if (!folder) {
    throw new Error('Expected prisma/migrations/*_canteen_day_night_services');
  }
  const sql = readFileSync(path.join(migrationsDir, folder, 'migration.sql'), 'utf8');
  const match = sql.match(/-- BEGIN BACKFILL[\s\S]*-- END BACKFILL/);
  if (!match) {
    throw new Error('Migration is missing -- BEGIN BACKFILL / -- END BACKFILL markers');
  }
  return match[0]
    .replace('-- BEGIN BACKFILL', '')
    .replace('-- END BACKFILL', '')
    .trim();
}

async function runBackfill(): Promise<void> {
  const statements = loadBackfillSql()
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith('--'));
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

describe('canteen day/night schema', () => {
  beforeEach(() => truncateAll(prisma));

  it('stores DAY and NIGHT prices on one MenuItem without duplicating it', async () => {
    const canteen = await makeCanteen();
    const { item } = await makeMenu(canteen.id, 7_000);
    await prisma.menuItemService.create({
      data: { menuItemId: item.id, period: 'DAY', pricePaise: 7_000, isAvailable: true },
    });
    await prisma.menuItemService.create({
      data: { menuItemId: item.id, period: 'NIGHT', pricePaise: 9_000, isAvailable: true },
    });

    expect(await prisma.menuItem.count({ where: { canteenId: canteen.id, name: item.name } })).toBe(
      1,
    );
    const services = await prisma.menuItemService.findMany({
      where: { menuItemId: item.id },
      orderBy: { period: 'asc' },
    });
    expect(services.map((row) => [row.period, row.pricePaise])).toEqual([
      ['DAY', 7_000],
      ['NIGHT', 9_000],
    ]);
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: item.id } })).pricePaise).toBe(
      7_000,
    );
  });

  it('rejects a second service row for the same canteen period', async () => {
    const canteen = await makeCanteen();
    await prisma.canteenService.create({
      data: { canteenId: canteen.id, period: 'NIGHT', isEnabled: true, override: 'FORCE_OPEN' },
    });
    await expect(
      prisma.canteenService.create({
        data: { canteenId: canteen.id, period: 'NIGHT', isEnabled: true, override: 'FORCE_OPEN' },
      }),
    ).rejects.toThrow(/CanteenService_canteenId_period_key/);
  });

  it('rejects a second weekday row for the same service', async () => {
    const canteen = await makeCanteen();
    const service = await prisma.canteenService.create({
      data: { canteenId: canteen.id, period: 'NIGHT', override: 'AUTO' },
    });
    await prisma.canteenOperatingSchedule.create({
      data: {
        canteenServiceId: service.id,
        weekday: 1,
        opensAtMinutes: 21 * 60,
        closesAtMinutes: 3 * 60,
      },
    });
    await expect(
      prisma.canteenOperatingSchedule.create({
        data: {
          canteenServiceId: service.id,
          weekday: 1,
          opensAtMinutes: 20 * 60,
          closesAtMinutes: 2 * 60,
        },
      }),
    ).rejects.toThrow(/CanteenOperatingSchedule_canteenServiceId_weekday_key/);
  });

  it('enforces weekday 1–7 and minutes 0–1439, but allows zero-length windows at the DB', async () => {
    const canteen = await makeCanteen();
    const service = await prisma.canteenService.create({
      data: { canteenId: canteen.id, period: 'NIGHT', override: 'AUTO' },
    });
    await expect(
      prisma.canteenOperatingSchedule.create({
        data: {
          canteenServiceId: service.id,
          weekday: 0,
          opensAtMinutes: 0,
          closesAtMinutes: 60,
        },
      }),
    ).rejects.toThrow(/CanteenOperatingSchedule_weekday_check/);
    await expect(
      prisma.canteenOperatingSchedule.create({
        data: {
          canteenServiceId: service.id,
          weekday: 8,
          opensAtMinutes: 0,
          closesAtMinutes: 60,
        },
      }),
    ).rejects.toThrow(/CanteenOperatingSchedule_weekday_check/);
    await expect(
      prisma.canteenOperatingSchedule.create({
        data: {
          canteenServiceId: service.id,
          weekday: 1,
          opensAtMinutes: 1440,
          closesAtMinutes: 0,
        },
      }),
    ).rejects.toThrow(/CanteenOperatingSchedule_opensAtMinutes_check/);
    await expect(
      prisma.canteenOperatingSchedule.create({
        data: {
          canteenServiceId: service.id,
          weekday: 2,
          opensAtMinutes: 0,
          closesAtMinutes: 1440,
        },
      }),
    ).rejects.toThrow(/CanteenOperatingSchedule_closesAtMinutes_check/);

    await expect(
      prisma.canteenOperatingSchedule.create({
        data: {
          canteenServiceId: service.id,
          weekday: 3,
          opensAtMinutes: 600,
          closesAtMinutes: 600,
        },
      }),
    ).resolves.toMatchObject({ opensAtMinutes: 600, closesAtMinutes: 600 });
  });

  it('requires MenuItemService prices to be greater than zero', async () => {
    const canteen = await makeCanteen();
    const { item } = await makeMenu(canteen.id);
    await expect(
      prisma.menuItemService.create({
        data: { menuItemId: item.id, period: 'NIGHT', pricePaise: 0 },
      }),
    ).rejects.toThrow(/MenuItemService_price_positive_check/);
  });

  it('keeps Staff.canteenId required for APPROVED staff and unique assignments per canteen', async () => {
    const canteen = await makeCanteen();
    const pending = await prisma.staff.create({
      data: { firebaseUid: 'st-pending', email: 'st-pending@example.edu', name: 'P' },
    });
    await expect(
      prisma.staff.update({ where: { id: pending.id }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow(/Staff_approved_requires_canteen_check/);

    const staff = await makeApprovedStaff(canteen.id);
    const assignment = await prisma.staffCanteenAssignment.create({
      data: { staffId: staff.id, canteenId: canteen.id },
    });
    await expect(
      prisma.staffCanteenAssignment.create({
        data: { staffId: staff.id, canteenId: canteen.id },
      }),
    ).rejects.toThrow(/StaffCanteenAssignment_staffId_canteenId_key/);

    await prisma.staffAssignmentCapability.create({
      data: { assignmentId: assignment.id, capability: 'KITCHEN' },
    });
    await expect(
      prisma.staffAssignmentCapability.create({
        data: { assignmentId: assignment.id, capability: 'KITCHEN' },
      }),
    ).rejects.toThrow(/StaffAssignmentCapability_assignmentId_capability_key/);
  });

  it('allows kitchen and cashier on the same assignment and one payment config per canteen', async () => {
    const canteen = await makeCanteen();
    const staff = await makeApprovedStaff(canteen.id);
    const assignment = await prisma.staffCanteenAssignment.create({
      data: { staffId: staff.id, canteenId: canteen.id },
    });
    await prisma.staffAssignmentCapability.createMany({
      data: [
        { assignmentId: assignment.id, capability: 'KITCHEN' },
        { assignmentId: assignment.id, capability: 'CASHIER' },
      ],
    });
    expect(
      (
        await prisma.staffAssignmentCapability.findMany({
          where: { assignmentId: assignment.id },
        })
      )
        .map((row) => row.capability)
        .sort(),
    ).toEqual(['CASHIER', 'KITCHEN']);

    await prisma.canteenPaymentConfig.create({
      data: {
        canteenId: canteen.id,
        upiVpa: 'merchant@upi',
        merchantName: 'K&G',
        qrImageUrl: 'https://example.edu/qr.png',
        qrStorageKey: 'canteen-qr/example.png',
        instructions: 'Pay and show the screen',
        isActive: false,
      },
    });
    await expect(
      prisma.canteenPaymentConfig.create({ data: { canteenId: canteen.id } }),
    ).rejects.toThrow(/CanteenPaymentConfig_canteenId_key/);
  });

  it('leaves historical Order.servicePeriod null and does not rewrite OrderItem snapshots', async () => {
    const canteen = await makeCanteen();
    const student = await makeStudent(canteen.id);
    const { item } = await makeMenu(canteen.id, 9_900);
    const order = await prisma.order.create({
      data: {
        studentId: student.id,
        canteenId: canteen.id,
        totalPaise: 9_900,
        idempotencyKey: `key-${randomUUID()}`,
        requestHash: 'h',
        items: {
          create: [
            {
              menuItemId: item.id,
              itemName: item.name,
              unitPricePaise: 9_900,
              quantity: 1,
              lineTotalPaise: 9_900,
            },
          ],
        },
        payment: { create: { provider: 'MOCK', amountPaise: 9_900 } },
      },
      include: { items: true, payment: true },
    });

    expect(order.servicePeriod).toBeNull();
    await prisma.menuItem.update({ where: { id: item.id }, data: { pricePaise: 12_000 } });
    await prisma.menuItemService.create({
      data: { menuItemId: item.id, period: 'NIGHT', pricePaise: 12_000 },
    });

    const snapshot = await prisma.orderItem.findUniqueOrThrow({
      where: { id: order.items[0]!.id },
    });
    expect(snapshot).toMatchObject({
      itemName: item.name,
      unitPricePaise: 9_900,
      lineTotalPaise: 9_900,
    });
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).servicePeriod,
    ).toBeNull();
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: order.payment!.id } })).amountPaise,
    ).toBe(9_900);
  });
});

describe('migration backfill of existing rows', () => {
  beforeEach(() => truncateAll(prisma));

  it('adds NIGHT services, copies prices, grants kitchen/menu/pause, and never grants CASHIER', async () => {
    const first = await makeCanteen('Existing One');
    const second = await makeCanteen('Existing Two');
    const { item: priced } = await makeMenu(first.id, 5_500, true);
    const { item: hidden } = await makeMenu(first.id, 8_000, false);
    await makeMenu(second.id, 3_000, true);
    const staff = await makeApprovedStaff(first.id);
    const pending = await prisma.staff.create({
      data: { firebaseUid: 'pending-1', email: 'pending-1@example.edu', name: 'Pending' },
    });
    const student = await makeStudent(first.id);
    const hostel = await prisma.hostel.findUniqueOrThrow({ where: { id: student.hostelId } });
    const order = await prisma.order.create({
      data: {
        studentId: student.id,
        canteenId: first.id,
        totalPaise: 5_500,
        idempotencyKey: `hist-${randomUUID()}`,
        requestHash: 'h',
        items: {
          create: [
            {
              menuItemId: priced.id,
              itemName: priced.name,
              unitPricePaise: 5_500,
              quantity: 1,
              lineTotalPaise: 5_500,
            },
          ],
        },
        payment: { create: { provider: 'MOCK', amountPaise: 5_500 } },
      },
      include: { items: true, payment: true },
    });

    const before = {
      canteenIds: [first.id, second.id].sort(),
      hostel: { id: hostel.id, canteenId: hostel.canteenId },
      itemPrices: Object.fromEntries(
        (await prisma.menuItem.findMany()).map((row) => [row.id, row.pricePaise]),
      ),
      staffCanteenId: staff.canteenId,
      order: {
        id: order.id,
        servicePeriod: order.servicePeriod,
        totalPaise: order.totalPaise,
      },
      snapshot: {
        id: order.items[0]!.id,
        itemName: order.items[0]!.itemName,
        unitPricePaise: order.items[0]!.unitPricePaise,
        lineTotalPaise: order.items[0]!.lineTotalPaise,
      },
      paymentAmount: order.payment!.amountPaise,
    };

    await runBackfill();
    await runBackfill();

    const nightServices = await prisma.canteenService.findMany({ orderBy: { canteenId: 'asc' } });
    expect(nightServices).toHaveLength(2);
    expect(new Set(nightServices.map((row) => row.period))).toEqual(new Set(['NIGHT']));
    expect(nightServices.every((row) => row.isEnabled && row.override === 'FORCE_OPEN')).toBe(true);
    expect(await prisma.canteenService.count({ where: { period: 'DAY' } })).toBe(0);
    expect(await prisma.canteenOperatingSchedule.count()).toBe(0);

    const pricedNight = await prisma.menuItemService.findUniqueOrThrow({
      where: { menuItemId_period: { menuItemId: priced.id, period: 'NIGHT' } },
    });
    const hiddenNight = await prisma.menuItemService.findUniqueOrThrow({
      where: { menuItemId_period: { menuItemId: hidden.id, period: 'NIGHT' } },
    });
    expect(pricedNight).toMatchObject({ pricePaise: 5_500, isAvailable: true });
    expect(hiddenNight).toMatchObject({ pricePaise: 8_000, isAvailable: false });
    expect(await prisma.menuItemService.count({ where: { period: 'DAY' } })).toBe(0);

    const assignment = await prisma.staffCanteenAssignment.findUniqueOrThrow({
      where: { staffId_canteenId: { staffId: staff.id, canteenId: first.id } },
      include: { capabilities: true },
    });
    expect(assignment.capabilities.map((row) => row.capability).sort()).toEqual([
      'KITCHEN',
      'MENU',
      'PAUSE',
    ]);
    expect(assignment.capabilities.some((row) => row.capability === 'CASHIER')).toBe(false);
    expect(
      await prisma.staffCanteenAssignment.count({ where: { staffId: pending.id } }),
    ).toBe(0);
    expect(
      await prisma.staffAssignmentCapability.count({ where: { capability: 'CASHIER' } }),
    ).toBe(0);

    expect(
      (await prisma.canteen.findMany({ select: { id: true } })).map((row) => row.id).sort(),
    ).toEqual(before.canteenIds);
    expect(
      await prisma.hostel.findUniqueOrThrow({ where: { id: before.hostel.id } }),
    ).toMatchObject({ canteenId: before.hostel.canteenId });
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).canteenId).toBe(
      before.staffCanteenId,
    );
    expect(await prisma.order.findUniqueOrThrow({ where: { id: before.order.id } })).toMatchObject(
      before.order,
    );
    expect(
      await prisma.orderItem.findUniqueOrThrow({ where: { id: before.snapshot.id } }),
    ).toMatchObject(before.snapshot);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { orderId: before.order.id } })).amountPaise,
    ).toBe(before.paymentAmount);
    expect(await prisma.menuItem.count()).toBe(3);
    for (const [id, pricePaise] of Object.entries(before.itemPrices)) {
      expect((await prisma.menuItem.findUniqueOrThrow({ where: { id } })).pricePaise).toBe(
        pricePaise,
      );
    }
  });
});

describe('seed compatibility with day/night services', () => {
  beforeAll(() => truncateAll(prisma));

  it('seeds NIGHT services and prices without DAY rows, hours, or CASHIER', async () => {
    const first = await seedDatabase(prisma);
    const second = await seedDatabase(prisma);
    expect(first).toEqual(second);
    expect(first.canteens).toBe(SEED_CANTEENS.length);

    const canteens = await prisma.canteen.findMany({ include: { services: true } });
    expect(canteens).toHaveLength(SEED_CANTEENS.length);
    for (const canteen of canteens) {
      expect(canteen.openingHours).toBe('9:00 PM – 3:00 AM');
      expect(canteen.services).toHaveLength(1);
      expect(canteen.services[0]).toMatchObject({
        period: 'NIGHT',
        isEnabled: true,
        override: 'FORCE_OPEN',
      });
    }
    expect(await prisma.canteenService.count({ where: { period: 'DAY' } })).toBe(0);
    expect(await prisma.canteenOperatingSchedule.count()).toBe(0);
    expect(await prisma.canteenPaymentConfig.count()).toBe(SEED_CANTEENS.length);
    const paymentConfigs = await prisma.canteenPaymentConfig.findMany();
    expect(paymentConfigs.every((row) => row.mode === 'DEMO' && row.upiVpa === null)).toBe(true);

    const items = await prisma.menuItem.findMany({ include: { services: true } });
    const itemsPerCanteen = SEED_MENU.reduce((sum, section) => sum + section.items.length, 0);
    expect(items).toHaveLength(SEED_CANTEENS.length * itemsPerCanteen);
    for (const item of items) {
      expect(item.services).toHaveLength(1);
      expect(item.services[0]).toMatchObject({
        period: 'NIGHT',
        pricePaise: item.pricePaise,
        isAvailable: item.isAvailable,
      });
    }

    const coffee = await prisma.menuItem.findFirstOrThrow({
      where: { name: 'Coffee' },
      include: { services: true },
    });
    expect(coffee.pricePaise).toBe(3_000);
    expect(coffee.services[0]?.pricePaise).toBe(3_000);

    await prisma.menuItemService.update({
      where: { id: coffee.services[0]!.id },
      data: { pricePaise: 4_200 },
    });
    await seedDatabase(prisma);
    expect(
      (
        await prisma.menuItemService.findUniqueOrThrow({
          where: { menuItemId_period: { menuItemId: coffee.id, period: 'NIGHT' } },
        })
      ).pricePaise,
    ).toBe(4_200);

    expect(await prisma.staffAssignmentCapability.count({ where: { capability: 'CASHIER' } })).toBe(
      0,
    );
  });
});
