import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_CANTEENS, SEED_MENU, seedDatabase } from '../../src/db/seed.js';
import { createTestPrisma, truncateAll } from '../helpers/db.js';

/**
 * Schema-level guarantees, verified against the real PostgreSQL test database
 * (migrated from scratch by tests/global-setup.ts). Prisma is not mocked.
 */
const prisma = createTestPrisma();

afterAll(() => prisma.$disconnect());

async function makeCanteen(name = `Canteen ${randomUUID().slice(0, 8)}`) {
  return prisma.canteen.create({
    data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
  });
}

async function makeMenu(canteenId: string, pricePaise = 9_900) {
  const category = await prisma.menuCategory.create({
    data: { canteenId, name: `Cat ${randomUUID().slice(0, 6)}` },
  });
  const item = await prisma.menuItem.create({
    data: {
      canteenId,
      categoryId: category.id,
      name: `Item ${randomUUID().slice(0, 6)}`,
      pricePaise,
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

async function makeOrder(
  studentId: string,
  canteenId: string,
  unitPricePaise: number,
  quantity: number,
) {
  return prisma.order.create({
    data: {
      studentId,
      canteenId,
      totalPaise: unitPricePaise * quantity,
      idempotencyKey: `key-${randomUUID()}`,
      requestHash: 'h',
      items: {
        create: [
          {
            itemName: 'Snapshot',
            unitPricePaise,
            quantity,
            lineTotalPaise: unitPricePaise * quantity,
          },
        ],
      },
      payment: { create: { provider: 'MOCK', amountPaise: unitPricePaise * quantity } },
    },
    include: { items: true, payment: true },
  });
}

describe('seed data', () => {
  beforeAll(() => truncateAll(prisma));

  it('creates the canteens, hostel mapping and menu', async () => {
    const first = await seedDatabase(prisma);
    expect(first.canteens).toBe(5);

    const hostels = await prisma.hostel.findMany({ include: { canteen: true } });
    const mapping = Object.fromEntries(hostels.map((h) => [h.name, h.canteen.name]));
    expect(mapping).toEqual({
      Krishna: 'Krishna & Godavari Night Canteen',
      Godavari: 'Krishna & Godavari Night Canteen',
      Yamuna: 'Yamuna & Narmada Night Canteen',
      Narmada: 'Yamuna & Narmada Night Canteen',
      'New Hostel': 'New Hostel Night Canteen',
      Vedavathi: 'Vedavathi Night Canteen',
      'Ganga A': 'Ganga A & Ganga B Night Canteen',
      'Ganga B': 'Ganga A & Ganga B Night Canteen',
    });

    const itemsPerCanteen = SEED_MENU.reduce((sum, section) => sum + section.items.length, 0);
    expect(await prisma.menuItem.count()).toBe(SEED_CANTEENS.length * itemsPerCanteen);
    expect(await prisma.menuCategory.count()).toBe(SEED_CANTEENS.length * SEED_MENU.length);

    const coffee = await prisma.menuItem.findFirstOrThrow({ where: { name: 'Coffee' } });
    expect(coffee.pricePaise).toBe(3_000);
  });

  it('is idempotent and never overwrites app-made changes', async () => {
    const before = {
      canteens: await prisma.canteen.count(),
      hostels: await prisma.hostel.count(),
      categories: await prisma.menuCategory.count(),
      items: await prisma.menuItem.count(),
    };
    const coffee = await prisma.menuItem.findFirstOrThrow({ where: { name: 'Coffee' } });
    await prisma.menuItem.update({ where: { id: coffee.id }, data: { pricePaise: 4_200 } });

    await seedDatabase(prisma);
    await seedDatabase(prisma);

    expect({
      canteens: await prisma.canteen.count(),
      hostels: await prisma.hostel.count(),
      categories: await prisma.menuCategory.count(),
      items: await prisma.menuItem.count(),
    }).toEqual(before);
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: coffee.id } })).pricePaise).toBe(
      4_200,
    );
  });
});

describe('canteens and hostels', () => {
  beforeEach(() => truncateAll(prisma));

  it('enforces unique canteen names and slugs', async () => {
    await prisma.canteen.create({ data: { name: 'A Canteen', slug: 'a' } });
    await expect(prisma.canteen.create({ data: { name: 'A Canteen', slug: 'b' } })).rejects.toThrow(
      /Canteen_name_key/,
    );
    await expect(prisma.canteen.create({ data: { name: 'B Canteen', slug: 'a' } })).rejects.toThrow(
      /Canteen_slug_key/,
    );
  });

  it('enforces unique hostel names and a valid canteen', async () => {
    const canteen = await makeCanteen();
    await prisma.hostel.create({ data: { name: 'Tower', canteenId: canteen.id } });
    await expect(
      prisma.hostel.create({ data: { name: 'Tower', canteenId: canteen.id } }),
    ).rejects.toThrow(/Hostel_name_key/);
    await expect(
      prisma.hostel.create({ data: { name: 'Orphan', canteenId: randomUUID() } }),
    ).rejects.toThrow(/Hostel_canteenId_fkey/);
  });

  it('prevents deleting a canteen that hostels depend on', async () => {
    const canteen = await makeCanteen();
    await prisma.hostel.create({ data: { name: 'Dependent', canteenId: canteen.id } });
    await expect(prisma.canteen.delete({ where: { id: canteen.id } })).rejects.toThrow(
      /Hostel_canteenId_fkey|Foreign key/,
    );
  });
});

describe('accounts', () => {
  beforeEach(() => truncateAll(prisma));

  it('requires a valid hostel and unique firebaseUid/email for students', async () => {
    const canteen = await makeCanteen();
    const student = await makeStudent(canteen.id);
    await expect(
      prisma.student.create({
        data: {
          firebaseUid: student.firebaseUid,
          email: 'other@example.edu',
          name: 'X',
          hostelId: student.hostelId,
        },
      }),
    ).rejects.toThrow(/Student_firebaseUid_key/);
    await expect(
      prisma.student.create({
        data: {
          firebaseUid: 'another',
          email: student.email,
          name: 'X',
          hostelId: student.hostelId,
        },
      }),
    ).rejects.toThrow(/Student_email_key/);
    await expect(
      prisma.student.create({
        data: {
          firebaseUid: 'nohostel',
          email: 'nh@example.edu',
          name: 'X',
          hostelId: randomUUID(),
        },
      }),
    ).rejects.toThrow(/Student_hostelId_fkey/);
  });

  it('stores emails normalized (lower-case)', async () => {
    await expect(
      prisma.admin.create({ data: { firebaseUid: 'a1', email: 'Admin@Example.edu', name: 'A' } }),
    ).rejects.toThrow(/Admin_email_normalized_check/);
    await expect(
      prisma.admin.create({ data: { firebaseUid: 'a1', email: 'admin@example.edu', name: 'A' } }),
    ).resolves.toBeDefined();
  });

  it('allows pending staff without a canteen but requires one when approved', async () => {
    const canteen = await makeCanteen();
    const pending = await prisma.staff.create({
      data: { firebaseUid: 'st1', email: 'st1@example.edu', name: 'S' },
    });
    expect(pending.status).toBe('PENDING');
    expect(pending.canteenId).toBeNull();

    await expect(
      prisma.staff.update({ where: { id: pending.id }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow(/Staff_approved_requires_canteen_check/);
    const approved = await prisma.staff.update({
      where: { id: pending.id },
      data: { status: 'APPROVED', canteenId: canteen.id },
    });
    expect(approved.canteenId).toBe(canteen.id);
  });
});

describe('canteen change requests', () => {
  beforeEach(() => truncateAll(prisma));

  it('allows only one pending request per staff member', async () => {
    const [a, b] = [await makeCanteen(), await makeCanteen()];
    const staff = await prisma.staff.create({
      data: { firebaseUid: 'cr1', email: 'cr1@example.edu', name: 'S' },
    });
    const admin = await prisma.admin.create({
      data: { firebaseUid: 'ad1', email: 'ad1@example.edu', name: 'A' },
    });

    const first = await prisma.canteenChangeRequest.create({
      data: { staffId: staff.id, requestedCanteenId: a.id },
    });
    await expect(
      prisma.canteenChangeRequest.create({ data: { staffId: staff.id, requestedCanteenId: b.id } }),
    ).rejects.toThrow(/CanteenChangeRequest_one_pending_per_staff/);

    // Once reviewed, a new pending request is allowed.
    await prisma.canteenChangeRequest.update({
      where: { id: first.id },
      data: { status: 'REJECTED', reviewedAt: new Date(), reviewedByAdminId: admin.id },
    });
    await expect(
      prisma.canteenChangeRequest.create({ data: { staffId: staff.id, requestedCanteenId: b.id } }),
    ).resolves.toBeDefined();
  });

  it('requires review timestamps to match status and canteens to differ', async () => {
    const a = await makeCanteen();
    const staff = await prisma.staff.create({
      data: { firebaseUid: 'cr2', email: 'cr2@example.edu', name: 'S' },
    });
    await expect(
      prisma.canteenChangeRequest.create({
        data: { staffId: staff.id, requestedCanteenId: a.id, status: 'APPROVED' },
      }),
    ).rejects.toThrow(/CanteenChangeRequest_review_consistency_check/);
    await expect(
      prisma.canteenChangeRequest.create({
        data: { staffId: staff.id, requestedCanteenId: a.id, fromCanteenId: a.id },
      }),
    ).rejects.toThrow(/CanteenChangeRequest_distinct_canteens_check/);
  });
});

describe('menu', () => {
  beforeEach(() => truncateAll(prisma));

  it('enforces unique category and item names per canteen, but not across canteens', async () => {
    const [a, b] = [await makeCanteen(), await makeCanteen()];
    const catA = await prisma.menuCategory.create({ data: { canteenId: a.id, name: 'Snacks' } });
    await expect(
      prisma.menuCategory.create({ data: { canteenId: a.id, name: 'Snacks' } }),
    ).rejects.toThrow(/MenuCategory_canteenId_name_key/);
    const catB = await prisma.menuCategory.create({ data: { canteenId: b.id, name: 'Snacks' } });

    await prisma.menuItem.create({
      data: { canteenId: a.id, categoryId: catA.id, name: 'Tea', pricePaise: 2_500 },
    });
    await expect(
      prisma.menuItem.create({
        data: { canteenId: a.id, categoryId: catA.id, name: 'Tea', pricePaise: 2_500 },
      }),
    ).rejects.toThrow(/MenuItem_canteenId_name_key/);
    await expect(
      prisma.menuItem.create({
        data: { canteenId: b.id, categoryId: catB.id, name: 'Tea', pricePaise: 2_500 },
      }),
    ).resolves.toBeDefined();
  });

  it('rejects an item whose category belongs to another canteen', async () => {
    const [a, b] = [await makeCanteen(), await makeCanteen()];
    const catB = await prisma.menuCategory.create({ data: { canteenId: b.id, name: 'Other' } });
    await expect(
      prisma.menuItem.create({
        data: { canteenId: a.id, categoryId: catB.id, name: 'Mismatch', pricePaise: 100 },
      }),
    ).rejects.toThrow(/MenuItem_categoryId_canteenId_fkey/);
  });

  it('requires positive prices', async () => {
    const a = await makeCanteen();
    const cat = await prisma.menuCategory.create({ data: { canteenId: a.id, name: 'Prices' } });
    for (const pricePaise of [0, -100]) {
      await expect(
        prisma.menuItem.create({
          data: { canteenId: a.id, categoryId: cat.id, name: `P${pricePaise}`, pricePaise },
        }),
      ).rejects.toThrow(/MenuItem_price_positive_check/);
    }
  });
});

describe('orders, items and payments', () => {
  beforeEach(() => truncateAll(prisma));

  it('generates unique public order numbers independent of the UUID', async () => {
    const canteen = await makeCanteen();
    const student = await makeStudent(canteen.id);
    const first = await makeOrder(student.id, canteen.id, 12_000, 2);
    const second = await makeOrder(student.id, canteen.id, 5_000, 1);
    expect(first.orderNumber).toMatch(/^SV\d{4,}$/);
    expect(second.orderNumber).not.toBe(first.orderNumber);
    expect(first.orderNumber).not.toContain(first.id);
    expect(first.items[0]?.lineTotalPaise).toBe(24_000);
    expect(first.payment?.status).toBe('PENDING');
  });

  it('keeps historical snapshots when the menu item changes, and blocks snapshot edits', async () => {
    const canteen = await makeCanteen();
    const student = await makeStudent(canteen.id);
    const { item } = await makeMenu(canteen.id, 9_900);
    const order = await prisma.order.create({
      data: {
        studentId: student.id,
        canteenId: canteen.id,
        totalPaise: 9_900,
        idempotencyKey: 'snapshot-key-1',
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
      },
      include: { items: true },
    });

    await prisma.menuItem.update({
      where: { id: item.id },
      data: { name: 'Renamed', pricePaise: 12_000 },
    });
    const snapshot = await prisma.orderItem.findUniqueOrThrow({
      where: { id: order.items[0]!.id },
    });
    expect(snapshot.itemName).toBe(item.name);
    expect(snapshot.unitPricePaise).toBe(9_900);

    await expect(
      prisma.orderItem.update({ where: { id: snapshot.id }, data: { unitPricePaise: 1 } }),
    ).rejects.toThrow(/immutable/);
  });

  it('lets a menu item be hard-deleted while its order snapshots survive unchanged', async () => {
    const canteen = await makeCanteen();
    const student = await makeStudent(canteen.id);
    const { item } = await makeMenu(canteen.id, 4_500);
    const order = await prisma.order.create({
      data: {
        studentId: student.id,
        canteenId: canteen.id,
        totalPaise: 4_500,
        idempotencyKey: 'hard-delete-key',
        requestHash: 'h',
        items: {
          create: [
            {
              menuItemId: item.id,
              itemName: item.name,
              unitPricePaise: 4_500,
              quantity: 1,
              lineTotalPaise: 4_500,
            },
          ],
        },
      },
      include: { items: true },
    });
    await prisma.menuItem.delete({ where: { id: item.id } });
    const snapshot = await prisma.orderItem.findUniqueOrThrow({
      where: { id: order.items[0]!.id },
    });
    expect(snapshot).toMatchObject({
      menuItemId: null,
      itemName: item.name,
      unitPricePaise: 4_500,
      quantity: 1,
    });
  });

  it('rejects an order item that references another canteen’s menu item', async () => {
    const [a, b] = [await makeCanteen(), await makeCanteen()];
    const student = await makeStudent(a.id);
    const { item: foreign } = await makeMenu(b.id, 1_000);
    await expect(
      prisma.order.create({
        data: {
          studentId: student.id,
          canteenId: a.id,
          totalPaise: 1_000,
          idempotencyKey: 'cross-canteen-key',
          requestHash: 'h',
          items: {
            create: [
              {
                menuItemId: foreign.id,
                itemName: 'X',
                unitPricePaise: 1_000,
                quantity: 1,
                lineTotalPaise: 1_000,
              },
            ],
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('caps order totals at ₹10,00,000', async () => {
    const canteen = await makeCanteen();
    const student = await makeStudent(canteen.id);
    await expect(
      prisma.order.create({
        data: {
          studentId: student.id,
          canteenId: canteen.id,
          totalPaise: 100_000_001,
          idempotencyKey: 'too-big-key-1',
          requestHash: 'h',
        },
      }),
    ).rejects.toThrow(/Order_total_max_check/);
  });

  it('enforces quantity range and line-total arithmetic', async () => {
    const canteen = await makeCanteen();
    const student = await makeStudent(canteen.id);
    const base = { studentId: student.id, canteenId: canteen.id, requestHash: 'h' };
    const bad = [
      { unitPricePaise: 100, quantity: 21, lineTotalPaise: 2_100 },
      { unitPricePaise: 100, quantity: 0, lineTotalPaise: 0 },
      { unitPricePaise: 100, quantity: 2, lineTotalPaise: 150 },
    ];
    for (const [index, line] of bad.entries()) {
      await expect(
        prisma.order.create({
          data: {
            ...base,
            idempotencyKey: `bad-line-${index}-key`,
            totalPaise: 100,
            items: { create: [{ itemName: 'X', ...line }] },
          },
        }),
      ).rejects.toThrow(/OrderItem_(quantity_range|line_total)_check/);
    }
  });

  it('enforces one payment per order and unique idempotency keys per student', async () => {
    const canteen = await makeCanteen();
    const student = await makeStudent(canteen.id);
    const order = await makeOrder(student.id, canteen.id, 1_000, 1);
    await expect(
      prisma.payment.create({ data: { orderId: order.id, provider: 'MOCK', amountPaise: 1_000 } }),
    ).rejects.toThrow(/Payment_orderId_key/);
    await expect(
      prisma.order.create({
        data: {
          studentId: student.id,
          canteenId: canteen.id,
          totalPaise: 1_000,
          idempotencyKey: order.idempotencyKey,
          requestHash: 'h',
        },
      }),
    ).rejects.toThrow(/Order_studentId_idempotencyKey_key/);
  });

  it('rejects malformed idempotency keys', async () => {
    const canteen = await makeCanteen();
    const student = await makeStudent(canteen.id);
    await expect(
      prisma.order.create({
        data: {
          studentId: student.id,
          canteenId: canteen.id,
          totalPaise: 100,
          idempotencyKey: 'bad key!',
          requestHash: 'h',
        },
      }),
    ).rejects.toThrow(/Order_idempotency_key_format_check/);
  });

  it('records processed payment events at most once per provider', async () => {
    await prisma.processedPaymentEvent.create({ data: { provider: 'MOCK', eventId: 'evt_1' } });
    await expect(
      prisma.processedPaymentEvent.create({ data: { provider: 'MOCK', eventId: 'evt_1' } }),
    ).rejects.toThrow(/ProcessedPaymentEvent_provider_eventId_key/);
    await expect(
      prisma.processedPaymentEvent.create({ data: { provider: 'RAZORPAY', eventId: 'evt_1' } }),
    ).resolves.toBeDefined();
  });
});

describe('notifications', () => {
  beforeEach(() => truncateAll(prisma));

  it('requires exactly one recipient', async () => {
    const canteen = await makeCanteen();
    const student = await makeStudent(canteen.id);
    const admin = await prisma.admin.create({
      data: { firebaseUid: 'n-a', email: 'n-a@example.edu', name: 'A' },
    });
    const base = { type: 'CANTEEN_UPDATE' as const, title: 'T', message: 'M' };

    await expect(prisma.notification.create({ data: base })).rejects.toThrow(
      /Notification_single_recipient_check/,
    );
    await expect(
      prisma.notification.create({ data: { ...base, studentId: student.id, adminId: admin.id } }),
    ).rejects.toThrow(/Notification_single_recipient_check/);
    await expect(
      prisma.notification.create({ data: { ...base, studentId: student.id } }),
    ).resolves.toBeDefined();
  });
});
