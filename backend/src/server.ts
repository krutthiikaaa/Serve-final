import { createServer } from 'node:http';
import { EnvValidationError, loadEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { createFirebaseAuth, FirebaseIdentityVerifier } from './lib/firebase.js';
import { createPaymentProvider } from './modules/payments/index.js';
import { createRealtimeServer, RealtimeBridge } from './realtime/socket-server.js';
import { createApp } from './app.js';

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
  const verifier = new FirebaseIdentityVerifier(createFirebaseAuth(env));
  const payments = createPaymentProvider(env);
  const events = new RealtimeBridge();
  const app = createApp({ env, logger, prisma, verifier, payments, events });
  const server = createServer(app);
  const realtime = createRealtimeServer(server, { env, logger, prisma, verifier });
  events.attach(realtime.publisher);

  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.fatal(
      { err },
      err.code === 'EADDRINUSE' ? `Port ${env.PORT} is already in use` : 'HTTP server error',
    );
    process.exit(1);
  });

  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `SERVE backend listening on port ${env.PORT}`,
    );
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
