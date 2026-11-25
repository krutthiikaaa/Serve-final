import { createServer } from 'node:http';
import { EnvValidationError, loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { createAuth } from './lib/auth.js';
import { createSessionVerifier } from './lib/session.js';
import { createPaymentProvider } from './modules/payments/index.js';
import { createRealtimeServer, RealtimeBridge } from './realtime/socket-server.js';
import { createApp } from './app.js';
import { createAreaScheduler } from './modules/admin/area-scheduler.js';
import { publishOrderTaking } from './modules/canteens/order-taking-events.js';
import { createUnpaidOrderExpiry } from './modules/payments/unpaid-order-expiry.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(): void {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      // Logger is not available yet; message contains variable names only.
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger(env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const auth = createAuth({ env, prisma, logger });
  const sessions = createSessionVerifier(auth);
  const payments = createPaymentProvider(env);
  const events = new RealtimeBridge();
  const app = createApp({ env, logger, prisma, auth, sessions, payments, events });
  const server = createServer(app);
  const realtime = createRealtimeServer(server, { env, logger, prisma, sessions });
  events.attach(realtime.publisher);
  // Day/Night switching runs here, on the server clock: on start-up (which
  // restores the right state after a restart) and every 30 seconds.
  const scheduler = createAreaScheduler({
    prisma,
    logger,
    publish: (canteenIds) => publishOrderTaking(prisma, events, canteenIds),
    clock: () => new Date(),
  });
  let stopScheduler: (() => void) | null = null;
  // Abandoned app orders (unpaid, never claimed) expire after
  // UNPAID_ORDER_EXPIRY_MINUTES; checked on start-up and every
  // UNPAID_ORDER_EXPIRY_CHECK_SECONDS.
  const unpaidExpiry = createUnpaidOrderExpiry({ prisma, events, logger, env });
  let stopUnpaidExpiry: (() => void) | null = null;

  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.fatal(
      { err },
      err.code === 'EADDRINUSE' ? `Port ${env.PORT} is already in use` : 'HTTP server error',
    );
    process.exit(1);
  });

  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, webApps: env.WEB_ROOT !== undefined },
      `SERVE backend listening on port ${env.PORT}`,
    );
    stopScheduler = scheduler.start();
    stopUnpaidExpiry = unpaidExpiry.start(env.UNPAID_ORDER_EXPIRY_CHECK_SECONDS * 1000);
    if (env.DEMO_MODE) {
      logger.warn('DEMO_MODE: payments are simulated by the mock provider; no real money is taken');
    }
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    const force = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();

    stopScheduler?.();
    stopUnpaidExpiry?.();
    void realtime.close();
    server.close((closeErr) => {
      prisma
        .$disconnect()
        .catch((err: unknown) => logger.error({ err }, 'Error disconnecting Prisma'))
        .finally(() => {
          if (closeErr) logger.error({ err: closeErr }, 'Error closing HTTP server');
          process.exit(closeErr ? 1 : 0);
        });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
}

try {
  main();
} catch (err) {
  console.error('Fatal startup error', err);
  process.exit(1);
}
