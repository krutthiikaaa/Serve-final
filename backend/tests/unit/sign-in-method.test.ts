import { describe, expect, it } from 'vitest';
import { sessionMethodFor } from '../../src/lib/auth.js';
import {
  isAdminEmail,
  isPasswordIdentityEmail,
  isSignInMethodAllowed,
  parseAuthMethod,
  passwordSchema,
  requiredSignInMethod,
} from '../../src/modules/auth/sign-in-method.js';

describe('role → sign-in method', () => {
  it('students and unregistered identities use Google; staff and admins a password', () => {
    expect(requiredSignInMethod('STUDENT')).toBe('google');
    expect(requiredSignInMethod(null)).toBe('google');
    expect(requiredSignInMethod('STAFF')).toBe('password');
    expect(requiredSignInMethod('ADMIN')).toBe('password');
  });

  it.each([
    ['google', 'STUDENT', true],
    [null, 'STUDENT', true], // session from before role-specific sign-in (Google)
    ['password', 'STUDENT', false],
    ['google', null, true],
    [null, null, true],
    ['password', null, false],
    ['password', 'STAFF', true],
    ['google', 'STAFF', false],
    [null, 'STAFF', false],
    ['password', 'ADMIN', true],
    ['google', 'ADMIN', false],
    [null, 'ADMIN', false],
  ] as const)('method %s as %s → %s', (method, role, allowed) => {
    expect(isSignInMethodAllowed(method, role)).toBe(allowed);
  });

  it('parses only known methods', () => {
    expect(parseAuthMethod('google')).toBe('google');
    expect(parseAuthMethod('password')).toBe('password');
    expect(parseAuthMethod('GOOGLE')).toBeNull();
    expect(parseAuthMethod(undefined)).toBeNull();
    expect(parseAuthMethod(null)).toBeNull();
  });
});

describe('session creation path → method', () => {
  it('maps only the endpoints that may create sessions', () => {
    expect(sessionMethodFor('/callback/:id', false)).toBe('google');
    expect(sessionMethodFor('/callback/google', false)).toBe('google');
    expect(sessionMethodFor('/sign-in/email', false)).toBe('password');
    expect(sessionMethodFor('/change-password', false)).toBe('password');
    expect(sessionMethodFor('/test/sign-in', true)).toBe('google');
    expect(sessionMethodFor('/test/sign-in', false)).toBeNull();
    expect(sessionMethodFor('/sign-up/email', false)).toBeNull();
    expect(sessionMethodFor('/sign-in/social', false)).toBeNull();
    expect(sessionMethodFor(undefined, true)).toBeNull();
  });
});

describe('addresses and passwords', () => {
  it('password identities may use any well-formed address', () => {
    expect(isPasswordIdentityEmail('Someone@Gmail.com')).toBe(true);
    expect(isPasswordIdentityEmail('staff@srmap.edu.in')).toBe(true);
    expect(isPasswordIdentityEmail('not-an-email')).toBe(false);
    expect(isPasswordIdentityEmail('a b@gmail.com')).toBe(false);
    expect(isPasswordIdentityEmail(42)).toBe(false);
  });

  it('admins must use @srmap.edu.in', () => {
    expect(isAdminEmail('ada@srmap.edu.in')).toBe(true);
    expect(isAdminEmail('ada@gmail.com')).toBe(false);
    expect(isAdminEmail('ada@srmap.edu.in.evil.com')).toBe(false);
  });

  it('passwords are 10–128 characters', () => {
    expect(passwordSchema.safeParse('123456789').success).toBe(false);
    expect(passwordSchema.safeParse('1234567890').success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(128)).success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});
