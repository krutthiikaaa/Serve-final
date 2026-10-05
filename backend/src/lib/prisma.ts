import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type { PrismaClient };

/**
 * Create a Prisma client backed by the node-postgres driver adapter.
 * The connection string always comes from validated configuration.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    // Fail fast instead of hanging when PostgreSQL is unreachable.
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({ adapter });
}
