import { z } from 'zod';
import { normalizeEmail } from './srm-email.js';

/**
 * Role-specific sign-in methods — the rule every layer enforces (session
 * creation in lib/auth.ts, every REST request in middleware/auth.ts, every
 * Socket.IO handshake):
 *
 *   STUDENT            Google (verified @srmap.edu.in)
 *   STAFF, ADMIN       email + password (any well-formed address; admins are
 *                      provisioned only by `npm run admin:create`)
 *   not registered     Google (the student registration path)
 *
 * The method is recorded on the session when it is created
 * (AuthSession.authMethod). Sessions created before this rule existed have
 * none; they were all Google sessions, so they stay valid for students only.
 */
export const AUTH_METHODS = ['google', 'password'] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

type Role = 'STUDENT' | 'STAFF' | 'ADMIN';

export function parseAuthMethod(value: unknown): AuthMethod | null {
  return value === 'google' || value === 'password' ? value : null;
}

/** The only sign-in method an account of `role` may use. */
export function requiredSignInMethod(role: Role | null): AuthMethod {
  return role === 'STAFF' || role === 'ADMIN' ? 'password' : 'google';
}

/** True when a session created with `method` may act as an account of `role`. */
export function isSignInMethodAllowed(method: AuthMethod | null, role: Role | null): boolean {
  const required = requiredSignInMethod(role);
  // A session without a recorded method predates this rule: it came from Google.
  return (method ?? 'google') === required;
}

export const SIGN_IN_METHOD_MESSAGE: Record<AuthMethod, string> = {
  google: 'Students sign in with their SRM University-AP Google account.',
  password: 'Staff and admins sign in with their email and password.',
};

/** Password rules for staff and admin accounts (also set on Better Auth). */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string({ error: 'Password is required' })
  .min(PASSWORD_MIN_LENGTH, { error: `Must be at least ${PASSWORD_MIN_LENGTH} characters` })
  .max(PASSWORD_MAX_LENGTH, { error: `Must be at most ${PASSWORD_MAX_LENGTH} characters` });

/**
 * Address of a password identity (staff and admins): any well-formed address,
 * lower-cased. A personal address (e.g. Gmail) is fine. It is NOT verified: SERVE
 * sends no verification email, so these identities keep emailVerified=false.
 */
export function isPasswordIdentityEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  return email !== null && z.email().safeParse(email).success;
}
