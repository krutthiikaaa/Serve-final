import { describe, expect, it } from 'vitest';
import { EnvValidationError, envFileFor, parseEnv } from '../../src/config/env.js';

const SECRET = 'x'.repeat(32);

const validDev = {
  NODE_ENV: 'development',
  BETTER_AUTH_SECRET: SECRET,
  DATABASE_URL: 'postgresql://serve:pw@localhost:5432/serve_dev',
  CORS_ORIGINS: 'http://localhost:5173, http://localhost:5174',
  PAYMENT_SECRET: SECRET,
};

const validProd = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://serve:pw@db.internal:5432/serve',
  CORS_ORIGINS: 'https://staff.serve.example,https://admin.serve.example',
  PAYMENT_MODE: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_live_placeholder',
  RAZORPAY_KEY_SECRET: 'placeholder-secret',
  RAZORPAY_WEBHOOK_SECRET: 'placeholder-webhook-secret',
  BETTER_AUTH_URL: 'https://serve.example',
  BETTER_AUTH_SECRET: SECRET,
  GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'placeholder-google-secret',
  STUDENT_APP_URL: 'https://serve.example',
  STAFF_DASHBOARD_URL: 'https://staff.serve.example',
  ADMIN_PORTAL_URL: 'https://admin.serve.example',
};

const issuesOf = (raw: Record<string, string | undefined>): string[] => {
  try {
    parseEnv(raw);
  } catch (err) {
    if (err instanceof EnvValidationError) return err.issues;
    throw err;
  }
  return [];
};

describe('parseEnv', () => {
  it('accepts a valid development environment and applies defaults', () => {
    const env = parseEnv(validDev);
    expect(env.PORT).toBe(5001);
    expect(env.PAYMENT_MODE).toBe('mock');
    expect(env.TRUST_PROXY).toBe(0);
    expect(env.GOOGLE_REQUIRE_HOSTED_DOMAIN).toBe(true);
    expect(env.AUTH_TEST_SIGN_IN).toBe(false);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
  });

  it('defaults NODE_ENV to development', () => {
    const { NODE_ENV: _omit, ...raw } = validDev;
    expect(parseEnv(raw).NODE_ENV).toBe('development');
  });

  it('requires DATABASE_URL and CORS_ORIGINS (secrets: see the dedicated tests)', () => {
    const issues = issuesOf({ NODE_ENV: 'development' });
    for (const key of ['DATABASE_URL', 'CORS_ORIGINS']) {
      expect(issues.some((i) => i.startsWith(key))).toBe(true);
    }
  });

  it('requires PAYMENT_SECRET in mock mode and Razorpay keys in razorpay mode', () => {
    const { PAYMENT_SECRET: _omit, ...noSecret } = validDev;
    expect(issuesOf(noSecret)).toEqual([expect.stringContaining('PAYMENT_SECRET')]);
    const issues = issuesOf({ ...validDev, PAYMENT_MODE: 'razorpay' });
    expect(issues).toHaveLength(3);
    expect(issues.join(' ')).toMatch(
      /RAZORPAY_KEY_ID.*RAZORPAY_KEY_SECRET.*RAZORPAY_WEBHOOK_SECRET/,
    );
  });

  it('requires a long BETTER_AUTH_SECRET outside tests, and Google credentials in pairs', () => {
    const { BETTER_AUTH_SECRET: _omit, ...raw } = validDev;
    expect(issuesOf(raw)).toEqual([expect.stringContaining('BETTER_AUTH_SECRET')]);
    expect(parseEnv({ ...raw, NODE_ENV: 'test' }).BETTER_AUTH_SECRET).toBeUndefined();
    expect(issuesOf({ ...validDev, BETTER_AUTH_SECRET: 'short' })).toEqual([
      expect.stringContaining('BETTER_AUTH_SECRET'),
    ]);
    expect(issuesOf({ ...validDev, GOOGLE_CLIENT_ID: '1-a.apps.googleusercontent.com' })).toEqual([
      expect.stringContaining('GOOGLE_CLIENT_SECRET'),
    ]);
    expect(
      issuesOf({ ...validDev, GOOGLE_CLIENT_ID: 'not-a-client-id', GOOGLE_CLIENT_SECRET: 'x' }),
    ).toEqual([expect.stringContaining('GOOGLE_CLIENT_ID')]);
  });

  it('allows the test-only sign-in endpoint under NODE_ENV=test only', () => {
    expect(
      parseEnv({ ...validDev, NODE_ENV: 'test', AUTH_TEST_SIGN_IN: 'true' }).AUTH_TEST_SIGN_IN,
    ).toBe(true);
    expect(issuesOf({ ...validDev, AUTH_TEST_SIGN_IN: 'true' })).toEqual([
      expect.stringContaining('AUTH_TEST_SIGN_IN is only allowed with NODE_ENV=test'),
    ]);
    expect(issuesOf({ ...validProd, AUTH_TEST_SIGN_IN: 'true' })).toEqual([
      expect.stringContaining('AUTH_TEST_SIGN_IN is only allowed with NODE_ENV=test'),
    ]);
    expect(issuesOf({ ...validDev, AUTH_TEST_SIGN_IN: 'yes' }).length).toBeGreaterThan(0);
  });

  it('treats empty values as unset', () => {
    const env = parseEnv({ ...validDev, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(issuesOf({ ...validDev, DATABASE_URL: 'mysql://x@y/z' })).toEqual([
      expect.stringContaining('DATABASE_URL'),
    ]);
  });

  it('rejects port 5000 (macOS AirPlay conflict)', () => {
    expect(issuesOf({ ...validDev, PORT: '5000' })).toEqual([expect.stringContaining('5001')]);
  });

  it('rejects malformed CORS origins (paths, trailing slashes, non-http)', () => {
    for (const bad of [
      'http://localhost:5173/',
      'https://a.com/path',
      'ftp://a.com',
      'not a url',
    ]) {
      expect(issuesOf({ ...validDev, CORS_ORIGINS: bad }).length).toBeGreaterThan(0);
    }
  });

  it('rejects short payment secrets', () => {
    expect(issuesOf({ ...validDev, PAYMENT_SECRET: 'short' })).toEqual([
      expect.stringContaining('PAYMENT_SECRET'),
    ]);
  });

  it('never echoes secret values in validation errors', () => {
    const issues = issuesOf({ ...validDev, PAYMENT_SECRET: 'super-secret-short' });
    expect(issues.join(' ')).not.toContain('super-secret-short');
  });

  describe('production safety', () => {
    it('accepts a complete production environment', () => {
      expect(() => parseEnv(validProd)).not.toThrow();
    });

    it('rejects localhost CORS origins in production', () => {
      const issues = issuesOf({ ...validProd, CORS_ORIGINS: 'https://localhost:5173' });
      expect(issues).toEqual([expect.stringContaining('Local origins are not allowed')]);
    });

    it('rejects plain-http CORS origins in production', () => {
      const issues = issuesOf({ ...validProd, CORS_ORIGINS: 'http://staff.serve.example' });
      expect(issues).toEqual([expect.stringContaining('https')]);
    });

    it('rejects the local development and test databases in production', () => {
      for (const database of ['serve_dev', 'serve_test']) {
        const issues = issuesOf({
          ...validProd,
          DATABASE_URL: `postgresql://serve:pw@db.internal:5432/${database}?schema=public`,
        });
        expect(issues).toEqual([expect.stringContaining(`local ${database} database`)]);
      }
      // A same-host production database is a supported setup (PostgreSQL on the VPS).
      expect(
        issuesOf({ ...validProd, DATABASE_URL: 'postgresql://serve:pw@localhost:5432/serve' }),
      ).toEqual([]);
    });

    it('requires Google credentials and an https, public BETTER_AUTH_URL in production', () => {
      for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BETTER_AUTH_URL'] as const) {
        const { [key]: _omit, ...raw } = validProd;
        expect(issuesOf(raw).some((issue) => issue.startsWith(key))).toBe(true);
      }
      expect(issuesOf({ ...validProd, BETTER_AUTH_URL: 'http://serve.example' })).toEqual([
        expect.stringContaining('BETTER_AUTH_URL must use https'),
      ]);
      expect(issuesOf({ ...validProd, BETTER_AUTH_URL: 'https://localhost:5001' })).toEqual([
        expect.stringContaining('BETTER_AUTH_URL must not be localhost'),
      ]);
    });

    it('rejects the mock payment provider in production', () => {
      const issues = issuesOf({ ...validProd, PAYMENT_MODE: 'mock', PAYMENT_SECRET: SECRET });
      expect(issues).toEqual([expect.stringContaining('mock payment provider')]);
    });

    it('requires https dashboard URLs in production', () => {
      const { STAFF_DASHBOARD_URL: _omit, ...raw } = validProd;
      expect(issuesOf(raw)).toEqual([expect.stringContaining('STAFF_DASHBOARD_URL')]);
      expect(issuesOf({ ...validProd, ADMIN_PORTAL_URL: 'http://admin.serve.example' })).toEqual([
        expect.stringContaining('ADMIN_PORTAL_URL'),
      ]);
      expect(issuesOf({ ...validProd, STUDENT_APP_URL: 'https://localhost:5555' })).toEqual([
        expect.stringContaining('STUDENT_APP_URL'),
      ]);
    });
  });

  describe('demo deployments (DEMO_MODE)', () => {
    const {
      RAZORPAY_KEY_ID: _k,
      RAZORPAY_KEY_SECRET: _s,
      RAZORPAY_WEBHOOK_SECRET: _w,
      ...baseProd
    } = validProd;
    const demoProd = {
      ...baseProd,
      CORS_ORIGINS: 'https://serve.example',
      PAYMENT_MODE: 'mock',
      PAYMENT_SECRET: SECRET,
      DEMO_MODE: 'true',
    };

    it('defaults to off', () => {
      expect(parseEnv(validDev).DEMO_MODE).toBe(false);
      expect(parseEnv({ ...validDev, DEMO_MODE: '' }).DEMO_MODE).toBe(false);
    });

    it('allows the mock provider in production only when declared', () => {
      const env = parseEnv(demoProd);
      expect(env).toMatchObject({ NODE_ENV: 'production', PAYMENT_MODE: 'mock', DEMO_MODE: true });
      expect(issuesOf({ ...demoProd, DEMO_MODE: 'false' })).toEqual([
        expect.stringContaining('mock payment provider'),
      ]);
    });

    it('keeps every other production rule', () => {
      expect(issuesOf({ ...demoProd, AUTH_TEST_SIGN_IN: 'true' })).toEqual([
        expect.stringContaining('AUTH_TEST_SIGN_IN'),
      ]);
      expect(issuesOf({ ...demoProd, CORS_ORIGINS: 'http://serve.example' })).toEqual([
        expect.stringContaining('https'),
      ]);
      expect(issuesOf({ ...demoProd, CORS_ORIGINS: 'https://localhost' })).toEqual([
        expect.stringContaining('Local origins'),
      ]);
      const { GOOGLE_CLIENT_SECRET: _g, GOOGLE_CLIENT_ID: _c, ...noGoogle } = demoProd;
      expect(issuesOf(noGoogle).join(' ')).toMatch(/GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET/);
      const { PAYMENT_SECRET: _secret, ...noSecret } = demoProd;
      expect(issuesOf(noSecret)).toEqual([expect.stringContaining('PAYMENT_SECRET')]);
    });

    it('cannot be combined with a real payment provider', () => {
      expect(issuesOf({ ...validProd, DEMO_MODE: 'true' })).toEqual([
        expect.stringContaining('DEMO_MODE=true requires PAYMENT_MODE=mock'),
      ]);
    });

    it('only accepts "true" or "false"', () => {
      for (const value of ['1', 'yes', 'TRUE']) {
        expect(issuesOf({ ...demoProd, DEMO_MODE: value })).toEqual([
          expect.stringContaining('DEMO_MODE'),
        ]);
      }
    });
  });

  it('treats WEB_ROOT as optional', () => {
    expect(parseEnv(validDev).WEB_ROOT).toBeUndefined();
    expect(parseEnv({ ...validDev, WEB_ROOT: '' }).WEB_ROOT).toBeUndefined();
    expect(parseEnv({ ...validDev, WEB_ROOT: '/srv/serve/web' }).WEB_ROOT).toBe('/srv/serve/web');
  });
});

describe('envFileFor', () => {
  it('maps NODE_ENV to env files and loads none in production', () => {
    expect(envFileFor('development')).toMatch(/backend[/\\]\.env$/);
    expect(envFileFor(undefined)).toMatch(/backend[/\\]\.env$/);
    expect(envFileFor('test')).toMatch(/backend[/\\]\.env\.test$/);
    expect(envFileFor('production')).toBeNull();
  });
});

describe('UNPAID_ORDER_EXPIRY_MINUTES', () => {
  it('defaults to a 20-minute payment window, checked every minute', () => {
    expect(parseEnv(validDev).UNPAID_ORDER_EXPIRY_MINUTES).toBe(20);
    expect(parseEnv(validDev).UNPAID_ORDER_EXPIRY_CHECK_SECONDS).toBe(60);
    expect(issuesOf({ ...validDev, UNPAID_ORDER_EXPIRY_CHECK_SECONDS: '0' }).join(' ')).toMatch(
      /UNPAID_ORDER_EXPIRY_CHECK_SECONDS/,
    );
  });

  it('accepts whole minutes from 1 to 1440 and refuses anything else', () => {
    expect(
      parseEnv({ ...validDev, UNPAID_ORDER_EXPIRY_MINUTES: '45' }).UNPAID_ORDER_EXPIRY_MINUTES,
    ).toBe(45);
    for (const bad of ['0', '-5', '1.5', '1441', 'soon']) {
      expect(issuesOf({ ...validDev, UNPAID_ORDER_EXPIRY_MINUTES: bad }).join(' ')).toMatch(
        /UNPAID_ORDER_EXPIRY_MINUTES/,
      );
    }
  });
});
