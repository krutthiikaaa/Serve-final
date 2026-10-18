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

    // --- Firebase -------------------------------------------------------------
    /** Firebase project id. Use a "demo-" id (e.g. demo-serve) with the emulator. */
    FIREBASE_PROJECT_ID: z.string({ error: 'FIREBASE_PROJECT_ID is required' }).min(1),
    FIREBASE_CLIENT_EMAIL: optional(z.email()),
    /** PEM private key; literal "\n" sequences are converted to newlines. */
    FIREBASE_PRIVATE_KEY: optional(z.string().transform((key) => key.replace(/\\n/g, '\n'))),
    /** host:port of the Firebase Auth Emulator (development/test only). */
    FIREBASE_AUTH_EMULATOR_HOST: optional(
      z.string().regex(/^[\w.-]+:\d+$/, { error: 'Expected host:port, e.g. 127.0.0.1:9099' }),
    ),

    /**
     * Optional comma-separated list of email domains allowed to register as
     * students (e.g. "university.edu"). Empty/unset = no restriction.
     */
    STUDENT_EMAIL_DOMAINS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '')
          .split(',')
          .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
          .filter((domain) => domain.length > 0),
      ),

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
    RAZORPAY_KEY_ID: optional(z.string()),
    RAZORPAY_KEY_SECRET: optional(z.string()),
    RAZORPAY_WEBHOOK_SECRET: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    // Firebase: either the emulator, or full service-account credentials.
    if (!env.FIREBASE_AUTH_EMULATOR_HOST) {
      for (const key of ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'] as const) {
        if (!env[key]) {
          issue(key, `${key} is required unless FIREBASE_AUTH_EMULATOR_HOST is set`);
        }
      }
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
    if (env.FIREBASE_AUTH_EMULATOR_HOST) {
      issue(
        'FIREBASE_AUTH_EMULATOR_HOST',
        'The Firebase Auth Emulator must not be used in production',
      );
    }
    if (env.FIREBASE_PROJECT_ID.startsWith('demo-')) {
      issue(
        'FIREBASE_PROJECT_ID',
        'demo- projects are emulator-only and not allowed in production',
      );
    }
    // No simulated payment success in production, except in a deployment
    // explicitly declared a demo.
    if (env.PAYMENT_MODE === 'mock' && !env.DEMO_MODE) {
      issue(
        'PAYMENT_MODE',
        'The mock payment provider is not allowed in production (DEMO_MODE=true declares a public demo that takes no real money)',
      );
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
