import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import type { PrismaClient } from './lib/prisma.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './modules/health/health.routes.js';

export interface AppDeps {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
}

/**
 * Build the Express application. Dependencies are injected so tests can run
 * the real app against a real (test) database without starting a server.
 */
export function createApp({ env, logger, prisma }: AppDeps): Express {
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestLogger(logger));

  // Security headers. This is a JSON API, so the strictest CSP is appropriate.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // Strict CORS allowlist. Requests without an Origin header (native mobile
  // app, server-to-server, curl) are not subject to CORS and pass through;
  // authorization is enforced separately on every protected route.
  const allowedOrigins = new Set(env.CORS_ORIGINS);
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, origin === undefined || allowedOrigins.has(origin));
      },
      credentials: false, // Bearer tokens, not cookies.
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '100kb' }));

  // Health probes are mounted before the rate limiter so load-balancer checks
  // never consume (or are blocked by) client quotas.
  app.use('/api/health', createHealthRouter({ prisma }));

  app.use(
    '/api',
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler(_req, res, _next, options) {
        res.status(options.statusCode).json({
          error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
        });
      },
    }),
  );

  // Feature routers are mounted here in later phases.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
