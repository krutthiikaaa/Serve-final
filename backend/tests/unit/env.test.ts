import { describe, expect, it } from 'vitest';
import { EnvValidationError, envFileFor, parseEnv } from '../../src/config/env.js';

const SECRET = 'x'.repeat(32);

const validDev = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://serve:pw@localhost:5432/serve_dev',
  CORS_ORIGINS: 'http://localhost:5173, http://localhost:5174',
  PAYMENT_SECRET: SECRET,
};

const validProd = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://serve:pw@db.internal:5432/serve',
  CORS_ORIGINS: 'https://staff.serve.example,https://admin.serve.example',
  PAYMENT_MODE: 'mock',
  PAYMENT_SECRET: SECRET,
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

  it('requires DATABASE_URL, CORS_ORIGINS and PAYMENT_SECRET', () => {
    const issues = issuesOf({ NODE_ENV: 'development' });
    expect(issues.some((i) => i.startsWith('DATABASE_URL'))).toBe(true);
    expect(issues.some((i) => i.startsWith('CORS_ORIGINS'))).toBe(true);
    expect(issues.some((i) => i.startsWith('PAYMENT_SECRET'))).toBe(true);
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
