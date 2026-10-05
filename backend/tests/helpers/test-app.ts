import { loadEnv, parseEnv, type Env } from '../../src/config/env.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient, type PrismaClient } from '../../src/lib/prisma.js';
import { createApp } from '../../src/app.js';

/**
 * Real application wired to the real test database (backend/.env.test or the
 * CI environment). No HTTP or database layer is mocked.
 */
export function buildTestApp(overrides: Partial<Record<keyof Env, string>> = {}) {
  const base = loadEnv();
  if (base.NODE_ENV !== 'test') {
    throw new Error(`Refusing to run tests with NODE_ENV=${base.NODE_ENV}`);
  }
  const env: Env =
    Object.keys(overrides).length === 0 ? base : parseEnv({ ...stringify(base), ...overrides });
  const logger = createLogger(env);
  const prisma: PrismaClient = createPrismaClient(env.DATABASE_URL);
  const app = createApp({ env, logger, prisma });
  return { app, env, prisma };
}

function stringify(env: Env): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value === undefined ? undefined : Array.isArray(value) ? value.join(',') : String(value),
    ]),
  );
}
