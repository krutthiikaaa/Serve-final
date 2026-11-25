import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Every runtime setting is read from the environment and validated here.
 * Nothing else in the backend reads `process.env` directly.
 *
 * Env files (development/test convenience only — never committed):
 *   NODE_ENV=development (default) -> backend/.env
 *   NODE_ENV=test                  -> backend/.env.test
 *   NODE_ENV=production            -> no file; the platform supplies variables
 *
 * Variables already set in the process environment always take precedence.
 */

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

const isLocalOrigin = (origin: string): boolean => {
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
};

/** Databases created by `npm run db:setup:local`; never a production database. */
const LOCAL_DATABASES = new Set(['serve_dev', 'serve_test']);

const databaseName = (url: string): string | null => {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
};

/** Absolute http(s) app URL: origin, optional path, no query/hash/credentials. */
const appUrl = z
  .string()
  .trim()
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          url.username === '' &&
          url.password === '' &&
          url.search === '' &&
          url.hash === ''
        );
      } catch {
        return false;
      }
    },
    { error: 'Must be an absolute http(s) URL with no query, hash or credentials' },
  )
  .transform((value) => value.replace(/\/+$/, ''));

const isLocalAppUrl = (value: string): boolean => {
  try {
    return LOCAL_HOSTNAMES.has(new URL(value).hostname);
  } catch {
    return false;
  }
};

/** Comma-separated list of exact origins, e.g. "https://staff.serve.app,https://admin.serve.app". */
const corsOrigins = z
  .string({ error: 'CORS_ORIGINS is required (comma-separated list of allowed origins)' })
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(
    z
      .array(
        z.string().refine(
          (origin) => {
            try {
              const url = new URL(origin);
              return (
                (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin
              );
            } catch {
              return false;
            }
          },
          {
            error:
              'Each CORS origin must be an exact origin like https://staff.example.com (no path or trailing slash)',
          },
        ),
      )
      .min(1, { error: 'CORS_ORIGINS must contain at least one origin' }),
  );

/** Treat empty strings (e.g. `KEY=` copied from .env.example) as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),

    PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      // Port 5000 is taken by macOS AirPlay Receiver; SERVE standardises on 5001.
      .refine((port) => port !== 5000, {
        error: 'PORT 5000 conflicts with macOS AirPlay Receiver — use 5001',
      })
      .default(5001),

    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required' })
      .refine((url) => /^postgres(ql)?:\/\//.test(url), {
        error: 'DATABASE_URL must be a postgresql:// connection string',
      }),

    CORS_ORIGINS: corsOrigins,

    /** Number of reverse-proxy hops to trust for client IPs (0 = none, e.g. 1 behind an ALB). */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),

    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

    /**
     * Directory holding the built web apps (`student/`, `staff/`, `admin/`; see
     * `npm run build:web`). When set, this process serves them so one origin
     * carries `/`, `/staff/`, `/admin/`, `/api` and `/socket.io`. Unset = API
     * only (local development and tests).
     */
    WEB_ROOT: optional(z.string().min(1)),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

    /** Stricter per-user limit for registration, order creation, payments and webhooks. */
    SENSITIVE_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    SENSITIVE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

    // --- Authentication (Better Auth + Google) ----------------------------------
    /**
     * Public base URL of this backend, as browsers reach it. Google redirects
     * to `${BETTER_AUTH_URL}/api/auth/callback/google`, so it must match the
     * redirect URI registered on the Google OAuth client exactly.
     * Development/test default: http://localhost:<PORT>.
     */
    BETTER_AUTH_URL: optional(appUrl),
    /**
     * Signs session cookies and OAuth state. At least 32 characters:
     * openssl rand -base64 32. Required except under NODE_ENV=test.
     */
    BETTER_AUTH_SECRET: optional(
      z.string().min(32, { error: 'BETTER_AUTH_SECRET must be at least 32 characters' }),
    ),
    /** Google OAuth client (server-side only; never sent to an app). */
    GOOGLE_CLIENT_ID: optional(
      z.string().regex(/^[\w.-]+\.apps\.googleusercontent\.com$/, {
        error: 'GOOGLE_CLIENT_ID must look like <id>.apps.googleusercontent.com',
      }),
    ),
    GOOGLE_CLIENT_SECRET: optional(z.string().min(1)),
    /**
     * Also require Google's hosted-domain (`hd`) claim to be srmap.edu.in
     * (SRM Google Workspace accounts). The verified-email domain check is
     * enforced regardless. "true" (default) or "false".
     */
    GOOGLE_REQUIRE_HOSTED_DOMAIN: optional(z.enum(['true', 'false'])).transform(
      (value) => value !== 'false',
    ),
    /**
     * Test-only sign-in endpoint for automated tests (POST /api/auth/test/sign-in).
     * Refused unless NODE_ENV=test. Exactly "true" or "false".
     */
    AUTH_TEST_SIGN_IN: optional(z.enum(['true', 'false'])).transform((value) => value === 'true'),

    /**
     * Public origin (+ optional path) of the student app, staff dashboard and
     * admin portal. Trusted as sign-in redirect targets. No trailing slash.
     * Development defaults to the local Vite / Flutter ports when unset.
     */
    STUDENT_APP_URL: optional(appUrl),
    STAFF_DASHBOARD_URL: optional(appUrl),
    ADMIN_PORTAL_URL: optional(appUrl),

    // --- Payments -------------------------------------------------------------
    /** mock = development provider; razorpay = production provider (adapter pending). */
    PAYMENT_MODE: z.enum(['mock', 'razorpay']).default('mock'),
    /**
     * Public demo deployment: the one way to run the mock payment provider with
     * NODE_ENV=production. No real money moves; every other production rule
     * still applies. Exactly "true" or "false".
     */
    DEMO_MODE: optional(
      z.enum(['true', 'false'], { error: 'DEMO_MODE must be "true" or "false"' }),
    ).transform((value) => value === 'true'),
    /** HMAC secret for the mock provider's payment signatures (mock mode only). */
    PAYMENT_SECRET: optional(
      z.string().min(32, { error: 'PAYMENT_SECRET must be at least 32 characters' }),
    ),
    /**
     * Minutes a student has to pay for an app order before an unpaid order
     * that was never claimed ("I've paid") expires. Claimed orders never
     * expire automatically: the cashier always decides those.
     */
    UNPAID_ORDER_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(1440).default(20),
    /** How often (seconds) the server looks for unpaid orders to expire. */
    UNPAID_ORDER_EXPIRY_CHECK_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
    RAZORPAY_KEY_ID: optional(z.string()),
    RAZORPAY_KEY_SECRET: optional(z.string()),
    RAZORPAY_WEBHOOK_SECRET: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    // Authentication
    if (env.NODE_ENV !== 'test' && !env.BETTER_AUTH_SECRET) {
      issue('BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET is required (openssl rand -base64 32)');
    }
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      issue(
        'GOOGLE_CLIENT_SECRET',
        'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
      );
    }
    // The test sign-in endpoint creates sessions without Google: never outside tests.
    if (env.AUTH_TEST_SIGN_IN && env.NODE_ENV !== 'test') {
      issue('AUTH_TEST_SIGN_IN', 'AUTH_TEST_SIGN_IN is only allowed with NODE_ENV=test');
    }

    // Payments
    if (env.PAYMENT_MODE === 'mock' && !env.PAYMENT_SECRET) {
      issue(
        'PAYMENT_SECRET',
        'PAYMENT_SECRET is required when PAYMENT_MODE=mock (openssl rand -hex 32)',
      );
    }
    if (env.PAYMENT_MODE === 'razorpay') {
      for (const key of [
        'RAZORPAY_KEY_ID',
        'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
      ] as const) {
        if (!env[key]) issue(key, `${key} is required when PAYMENT_MODE=razorpay`);
      }
    }
    if (env.DEMO_MODE && env.PAYMENT_MODE !== 'mock') {
      issue(
        'DEMO_MODE',
        'DEMO_MODE=true requires PAYMENT_MODE=mock (a demo never takes real money)',
      );
    }

    if (env.NODE_ENV !== 'production') return;

    // Production must never fall back to local development endpoints.
    const localOrigins = env.CORS_ORIGINS.filter(isLocalOrigin);
    if (localOrigins.length > 0) {
      issue(
        'CORS_ORIGINS',
        `Local origins are not allowed in production: ${localOrigins.join(', ')}`,
      );
    }
    const insecureOrigins = env.CORS_ORIGINS.filter((origin) => origin.startsWith('http://'));
    if (insecureOrigins.length > 0) {
      issue(
        'CORS_ORIGINS',
        `Production CORS origins must use https: ${insecureOrigins.join(', ')}`,
      );
    }
    const database = databaseName(env.DATABASE_URL);
    if (database && LOCAL_DATABASES.has(database)) {
      issue(
        'DATABASE_URL',
        `The local ${database} database must not be used in production; create a dedicated production database`,
      );
    }
    for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BETTER_AUTH_URL'] as const) {
      if (!env[key]) issue(key, `${key} is required in production`);
    }
    if (env.BETTER_AUTH_URL?.startsWith('http://')) {
      issue('BETTER_AUTH_URL', 'BETTER_AUTH_URL must use https in production');
    }
    if (env.BETTER_AUTH_URL && isLocalAppUrl(env.BETTER_AUTH_URL)) {
      issue('BETTER_AUTH_URL', 'BETTER_AUTH_URL must not be localhost in production');
    }
    // No simulated payment success in production, except in a deployment
    // explicitly declared a demo.
    if (env.PAYMENT_MODE === 'mock' && !env.DEMO_MODE) {
      issue(
        'PAYMENT_MODE',
        'The mock payment provider is not allowed in production (DEMO_MODE=true declares a public demo that takes no real money)',
      );
    }

    for (const key of ['STAFF_DASHBOARD_URL', 'ADMIN_PORTAL_URL', 'STUDENT_APP_URL'] as const) {
      const value = env[key];
      if (!value) {
        issue(key, `${key} is required in production`);
        continue;
      }
      if (value.startsWith('http://')) {
        issue(key, `${key} must use https in production`);
      }
      if (isLocalAppUrl(value)) {
        issue(key, `${key} must not be localhost in production`);
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/** Validate a raw environment object. Pure — used directly by tests. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    // Report variable names and rule messages only — never echo values (they may be secrets).
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvValidationError(issues);
  }
  return result.data;
}

/** Path of the env file for a given NODE_ENV, or null when none should be loaded. */
export function envFileFor(nodeEnv: string | undefined): string | null {
  const backendRoot = path.resolve(import.meta.dirname, '..', '..');
  switch (nodeEnv ?? 'development') {
    case 'production':
      return null;
    case 'test':
      return path.join(backendRoot, '.env.test');
    default:
      return path.join(backendRoot, '.env');
  }
}

let cachedEnv: Env | undefined;

/** Load env file (non-production only), validate, and cache. */
export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const file = envFileFor(process.env.NODE_ENV);
  if (file) loadDotenv({ path: file, quiet: true });
  cachedEnv = parseEnv(process.env);
  return cachedEnv;
}
