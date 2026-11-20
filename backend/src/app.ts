import type { ServerResponse } from 'node:http';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { AppContext } from './context.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { toNodeHandler } from 'better-auth/node';
import { createAuthRouter, SERVE_AUTH_PATHS } from './modules/auth/auth.routes.js';
import { createNativeAuthRouter } from './modules/auth/native-auth.routes.js';
import { AUTH_BASE_PATH, EXPOSED_AUTH_PATHS, trustedOriginsFor } from './lib/auth.js';
import { ForbiddenError } from './lib/errors.js';
import { createServices } from './services.js';
import {
  createCanteensRouter,
  createQrImageRouter,
  createServiceAreaDirectoryRouter,
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
  // Credentials: the web apps send Better Auth's HttpOnly session cookie.
  const allowedOrigins = new Set(env.CORS_ORIGINS);
  useForApi(
    cors({
      origin(origin, callback) {
        callback(null, origin === undefined || allowedOrigins.has(origin));
      },
      credentials: true,
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

  // Health probes are mounted before the rate limiter so load-balancer checks
  // never consume (or are blocked by) client quotas.
  app.use('/api/health', createHealthRouter({ prisma }));

  const apiLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_req, res, _next, options) {
      res.status(options.statusCode).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
      });
    },
  });
  app.use('/api', apiLimiter);

  // Better Auth (Google sign-in, callback, session, sign-out) reads the raw
  // request body, so it is mounted before express.json(). SERVE's own
  // /api/auth routes (me, registration) fall through to the router below.
  // Only the Better Auth endpoints SERVE uses are reachable (an allowlist, so
  // endpoints added by a future Better Auth version stay closed); the rest
  // fall through to the JSON 404.
  const betterAuth = toNodeHandler(ctx.auth);
  app.all(`${AUTH_BASE_PATH}/*splat`, (req, res, next) => {
    const path = req.path.slice(AUTH_BASE_PATH.length);
    if (SERVE_AUTH_PATHS.has(path) || !EXPOSED_AUTH_PATHS.has(path)) return next();
    withoutTokenHeader(res);
    void betterAuth(req, res);
  });

  app.use(express.json({ limit: '100kb' }));

  // CSRF defence for cookie sessions: a state-changing API request that
  // carries cookies (and no Bearer token) must come from a trusted origin.
  // Browsers always send Origin on such requests; native apps use Bearer.
  const trustedOrigins = new Set(trustedOriginsFor(env));
  app.use('/api', (req, _res, next) => {
    const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (safe || !req.headers.cookie || /^bearer /i.test(req.headers.authorization ?? '')) {
      return next();
    }
    const origin = req.headers.origin;
    if (!origin || !trustedOrigins.has(origin)) {
      throw new ForbiddenError('This request did not come from a SERVE app.', 'ORIGIN_NOT_ALLOWED');
    }
    next();
  });

  // Fallback landing page of a failed browser sign-in (apps pass their own).
  app.get('/api/auth-error', (req, res) => {
    const code =
      typeof req.query.error === 'string' ? req.query.error.slice(0, 64) : 'SIGN_IN_FAILED';
    res.status(403).json({ error: { code, message: 'Sign-in was not completed.' } });
  });

  app.use('/api/auth', createAuthRouter(ctx, services));
  app.use('/api/native-auth', createNativeAuthRouter(ctx));
  app.use('/api/hostels', createHostelsRouter(ctx));
  app.use('/api/service-areas', createServiceAreaDirectoryRouter(ctx));
  app.use('/api/canteens', createCanteensRouter(ctx, services));
  app.use('/api/qr-codes', createQrImageRouter(services));
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

/**
 * Better Auth's bearer plugin copies the signed session cookie into a
 * `set-auth-token` response header (and exposes it to CORS). A page script
 * can read response headers, so this would hand it the credential the
 * HttpOnly cookie protects. SERVE's web apps never need it and the native app
 * gets its token through the PKCE exchange, so the header is never sent.
 */
function withoutTokenHeader(res: ServerResponse): void {
  const setHeader = res.setHeader.bind(res);
  res.setHeader = (name: string, value: number | string | readonly string[]) => {
    const header = name.toLowerCase();
    if (header === 'set-auth-token') return res;
    if (header === 'access-control-expose-headers') {
      const kept = String(value)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry && entry.toLowerCase() !== 'set-auth-token');
      if (kept.length === 0) return res;
      return setHeader(name, kept.join(', '));
    }
    return setHeader(name, value);
  };
}
