/**
 * `npm run db:seed` / `npx prisma db seed` — idempotent development seed.
 * Refuses to run in production.
 */
import { loadEnv } from '../src/config/env.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { seedDatabase } from '../src/db/seed.js';

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('Refusing to seed development data with NODE_ENV=production.');
  process.exit(1);
}

const prisma = createPrismaClient(env.DATABASE_URL);
try {
  const result = await seedDatabase(prisma);
  console.error(
    `Seed complete (${env.NODE_ENV}): ${result.canteens} canteens, ${result.hostels} hostels, ` +
      `${result.categories} categories, ${result.items} menu items ensured.`,
  );
} finally {
  await prisma.$disconnect();
}
