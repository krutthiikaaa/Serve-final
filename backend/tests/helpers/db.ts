import { loadEnv } from '../../src/config/env.js';
import { createPrismaClient, type PrismaClient } from '../../src/lib/prisma.js';

export function createTestPrisma(): PrismaClient {
  const env = loadEnv();
  if (env.NODE_ENV !== 'test') throw new Error('Test database helpers require NODE_ENV=test');
  return createPrismaClient(env.DATABASE_URL);
}

const TABLES = [
  'Notification',
  'ProcessedPaymentEvent',
  'Payment',
  'OrderItem',
  'Order',
  'MenuItem',
  'MenuCategory',
  'CanteenChangeRequest',
  'Student',
  'Staff',
  'Admin',
  'Hostel',
  'Canteen',
];

/** Remove all application data from the test database (schema is kept). */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const list = TABLES.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}
