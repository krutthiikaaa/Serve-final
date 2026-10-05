import { loadEnv, parseEnv, type Env } from '../../src/config/env.js';
import { createLogger } from '../../src/config/logger.js';
import { createPrismaClient, type PrismaClient } from '../../src/lib/prisma.js';
import { createFirebaseAuth, FirebaseIdentityVerifier } from '../../src/lib/firebase.js';
import { createPaymentProvider } from '../../src/modules/payments/index.js';
import { noopPublisher, type EventPublisher } from '../../src/realtime/events.js';
import type { AppContext } from '../../src/context.js';
import { createApp } from '../../src/app.js';

export function testEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const base = loadEnv();
  if (base.NODE_ENV !== 'test') {
    throw new Error(`Refusing to run tests with NODE_ENV=${base.NODE_ENV}`);
  }
  return Object.keys(overrides).length === 0
    ? base
    : parseEnv({ ...stringify(base), ...overrides });
}

/**
 * Real application wired to the real test database and the real Firebase Auth
 * Emulator. No HTTP, database or authentication layer is mocked.
 */
export function buildTestContext(
  options: {
    env?: Partial<Record<keyof Env, string>>;
    events?: EventPublisher;
    prisma?: PrismaClient;
  } = {},
): AppContext {
  const env = testEnv(options.env);
  return {
    env,
    logger: createLogger(env),
    prisma: options.prisma ?? createPrismaClient(env.DATABASE_URL),
    verifier: new FirebaseIdentityVerifier(createFirebaseAuth(env)),
    payments: createPaymentProvider(env),
    events: options.events ?? noopPublisher,
  };
}

export function buildTestApp(overrides: Partial<Record<keyof Env, string>> = {}) {
  const ctx = buildTestContext({ env: overrides });
  return { app: createApp(ctx), env: ctx.env, prisma: ctx.prisma, ctx };
}

function stringify(env: Env): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value === undefined ? undefined : Array.isArray(value) ? value.join(',') : String(value),
    ]),
  );
}
