import { describe, expect, it } from 'vitest';
import { EnvValidationError, envFileFor, parseEnv } from '../../src/config/env.js';

const SECRET = 'x'.repeat(32);

const validDev = {
  NODE_ENV: 'development',
  FIREBASE_PROJECT_ID: 'demo-serve',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
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
  FIREBASE_PROJECT_ID: 'serve-prod',
  FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@serve-prod.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
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
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
  });

  it('defaults NODE_ENV to development', () => {
    const { NODE_ENV: _omit, ...raw } = validDev;
    expect(parseEnv(raw).NODE_ENV).toBe('development');
  });

  it('requires DATABASE_URL, CORS_ORIGINS, FIREBASE_PROJECT_ID and PAYMENT_SECRET (mock)', () => {
    const issues = issuesOf({
      NODE_ENV: 'development',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    });
    for (const key of ['DATABASE_URL', 'CORS_ORIGINS', 'FIREBASE_PROJECT_ID']) {
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

  it('requires service-account credentials when the emulator is not configured', () => {
    const { FIREBASE_AUTH_EMULATOR_HOST: _omit, ...raw } = validDev;
    const issues = issuesOf(raw);
    expect(issues).toEqual([
      expect.stringContaining('FIREBASE_CLIENT_EMAIL'),
      expect.stringContaining('FIREBASE_PRIVATE_KEY'),
    ]);
  });

  it('treats empty values as unset and parses student email domains', () => {
    const env = parseEnv({
      ...validDev,
      FIREBASE_CLIENT_EMAIL: '',
      STUDENT_EMAIL_DOMAINS: ' @Uni.edu, college.ac.in ,',
    });
    expect(env.FIREBASE_CLIENT_EMAIL).toBeUndefined();
    expect(env.STUDENT_EMAIL_DOMAINS).toEqual(['uni.edu', 'college.ac.in']);
    expect(parseEnv(validDev).STUDENT_EMAIL_DOMAINS).toEqual([]);
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

  it('normalises escaped newlines in FIREBASE_PRIVATE_KEY', () => {
    const env = parseEnv(validProd);
    expect(env.FIREBASE_PRIVATE_KEY).toContain('\n');
    expect(env.FIREBASE_PRIVATE_KEY).not.toContain('\\n');
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

    it('rejects the Firebase Auth Emulator in production', () => {
      const issues = issuesOf({ ...validProd, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' });
      expect(issues).toEqual([expect.stringContaining('FIREBASE_AUTH_EMULATOR_HOST')]);
    });

    it('requires Firebase Admin credentials in production', () => {
      const { FIREBASE_PRIVATE_KEY: _omit, ...raw } = validProd;
      expect(issuesOf(raw)).toEqual([expect.stringContaining('FIREBASE_PRIVATE_KEY')]);
    });

    it('rejects demo- Firebase projects in production', () => {
      expect(issuesOf({ ...validProd, FIREBASE_PROJECT_ID: 'demo-serve' })).toEqual([
        expect.stringContaining('demo-'),
      ]);
    });

    it('rejects the mock payment provider in production', () => {
      const issues = issuesOf({ ...validProd, PAYMENT_MODE: 'mock', PAYMENT_SECRET: SECRET });
      expect(issues).toEqual([expect.stringContaining('mock payment provider')]);
    });
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
