/**
 * `npm run db:seed` / `npx prisma db seed` — idempotent, non-destructive seed
 * of the hostels, canteens and demo menus (existing rows are never changed).
 * Refuses to run in production, except in a DEMO_MODE=true deployment, which
 * needs the catalogue so students can register.
 */
import { loadEnv } from '../src/config/env.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { seedDatabase } from '../src/db/seed.js';

const env = loadEnv();
if (env.NODE_ENV === 'production' && !env.DEMO_MODE) {
  console.error(
    'Refusing to seed demo data with NODE_ENV=production (allowed only with DEMO_MODE=true).',
  );
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
