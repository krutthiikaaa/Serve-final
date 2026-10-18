import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { AppContext } from './context.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createServices } from './services.js';
import {
  createCanteensRouter,
  createHostelsRouter,
  createMenuRouter,
} from './modules/canteens/canteens.routes.js';
import { createCartRouter, createOrdersRouter } from './modules/orders/orders.routes.js';
import {
  createPaymentWebhookRouter,
  createPaymentsRouter,
} from './modules/payments/payments.routes.js';
import { createStaffRouter } from './modules/staff/staff.routes.js';
import { createAdminRouter } from './modules/admin/admin.routes.js';
import { createNotificationsRouter } from './modules/notifications/notifications.routes.js';
import { createStudentsRouter } from './modules/students/students.routes.js';
import { createWebAppsRouter, resolveWebRoot } from './web/web-apps.js';

/**
 * Build the Express application. Dependencies are injected so tests can run
 * the real app against a real (test) database without starting a server.
 */
export function createApp(ctx: AppContext): Express {
  const { env, logger, prisma } = ctx;
  const app = express();
  // Single-domain deployment: this process also serves the web apps.
  const webRoot = env.WEB_ROOT ? resolveWebRoot(env.WEB_ROOT, env.NODE_ENV) : null;
  // With the web apps mounted, API-only middleware is scoped to /api.
  const useForApi = (handler: express.RequestHandler) =>
    webRoot ? app.use('/api', handler) : app.use(handler);

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestLogger(logger));

  // Security headers. This is a JSON API, so the strictest CSP is appropriate.
  useForApi(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // Strict CORS allowlist. Requests without an Origin header (native mobile
  // app, server-to-server, curl) are not subject to CORS and pass through;
  // authorization is enforced separately on every protected route.
  // On the single domain the apps call /api same-origin, so CORS does not
  // apply to them; the allowlist matters only for apps on other origins.
  const allowedOrigins = new Set(env.CORS_ORIGINS);
  useForApi(
    cors({
      origin(origin, callback) {
        callback(null, origin === undefined || allowedOrigins.has(origin));
      },
      credentials: false, // Bearer tokens, not cookies.
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: [
        'X-Request-Id',
        'Idempotent-Replayed',
        'RateLimit',
        'RateLimit-Policy',
        'Retry-After',
      ],
      maxAge: 600,
    }),
  );

  const services = createServices(ctx);

  // Webhooks need the raw body for signature verification: mount before JSON parsing.
  app.use('/api/payments/webhooks', createPaymentWebhookRouter(ctx, services));

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

  app.use('/api/auth', createAuthRouter(ctx, services));
  app.use('/api/hostels', createHostelsRouter(ctx));
  app.use('/api/canteens', createCanteensRouter(ctx, services));
  app.use('/api/menu', createMenuRouter(ctx, services));
  app.use('/api/cart', createCartRouter(ctx, services));
  app.use('/api/orders', createOrdersRouter(ctx, services));
  app.use('/api/payments', createPaymentsRouter(ctx, services));
  app.use('/api/students', createStudentsRouter(ctx, services));
  app.use('/api/staff', createStaffRouter(ctx, services));
  app.use('/api/admin', createAdminRouter(ctx, services));
  app.use('/api/notifications', createNotificationsRouter(ctx, services));

  // Unknown API routes are JSON 404s, never an HTML page.
  app.use('/api', notFoundHandler);
  if (webRoot) app.use(createWebAppsRouter(env, webRoot));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
