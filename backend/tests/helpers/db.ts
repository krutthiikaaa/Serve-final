import { loadEnv } from '../../src/config/env.js';
import { createPrismaClient, type PrismaClient } from '../../src/lib/prisma.js';

export function createTestPrisma(): PrismaClient {
  const env = loadEnv();
  if (env.NODE_ENV !== 'test') throw new Error('Test database helpers require NODE_ENV=test');
  return createPrismaClient(env.DATABASE_URL);
}

const TABLES = [
  'SsoAuthorizationCode',
  'Notification',
  'ProcessedPaymentEvent',
  'Payment',
  'OrderItem',
  'Order',
  'StaffAssignmentCapability',
  'StaffCanteenAssignment',
  'CanteenOperatingSchedule',
  'MenuItemService',
  'CanteenService',
  'CanteenPaymentConfig',
  'CanteenQrCode',
  'MenuItem',
  'MenuCategory',
  'CanteenChangeRequest',
  'Student',
  'Staff',
  'Admin',
  'Hostel',
  'Canteen',
  'ServiceArea',
];

/** Remove all application data from the test database (schema is kept). */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const list = TABLES.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}

const tag = () => Math.random().toString(36).slice(2, 10);

/**
 * Create a canteen directly in PostgreSQL. Without `serviceAreaId` it gets a
 * new service area of its own, so it never interacts with other canteens'
 * Day/Night exclusivity.
 */
export async function createCanteenRecord(
  prisma: PrismaClient,
  data: {
    name?: string;
    slug?: string;
    type?: 'DAY' | 'NIGHT';
    serviceAreaId?: string;
    isActive?: boolean;
    isAcceptingOrders?: boolean;
  } = {},
) {
  const name = data.name ?? `Canteen ${tag()}`;
  const serviceAreaId =
    data.serviceAreaId ??
    (await prisma.serviceArea.create({ data: { name: `Area ${tag()}`, slug: `area-${tag()}` } }))
      .id;
  return prisma.canteen.create({
    data: {
      name,
      slug: data.slug ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${tag()}`,
      type: data.type ?? 'NIGHT',
      serviceAreaId,
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.isAcceptingOrders !== undefined
        ? { isAcceptingOrders: data.isAcceptingOrders }
        : {}),
    },
  });
}

/** A hostel in the service area of `canteenId`. */
export async function createHostelRecord(
  prisma: PrismaClient,
  data: { name?: string; canteenId: string; isActive?: boolean },
) {
  const canteen = await prisma.canteen.findUniqueOrThrow({ where: { id: data.canteenId } });
  return prisma.hostel.create({
    data: {
      name: data.name ?? `Hostel ${tag()}`,
      serviceAreaId: canteen.serviceAreaId,
      canteenId: canteen.id,
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
}
