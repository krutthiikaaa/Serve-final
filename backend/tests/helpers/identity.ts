import { randomUUID } from 'node:crypto';
import { createAuth, type ServeAuth } from '../../src/lib/auth.js';
import { createPrismaClient } from '../../src/lib/prisma.js';
import { createLogger } from '../../src/config/logger.js';
import { testEnv } from './test-app.js';

/**
 * Sign-in identities for tests, through the REAL Better Auth instance (same
 * configuration as production):
 * - students: the test-only sign-in endpoint, which stands in for Google and
 *   applies the same SRM gate, database hooks and session creation (the
 *   session is recorded as a Google session);
 * - staff and admins: the real email + password endpoint.
 * The returned token is a genuine signed Better Auth session credential,
 * accepted as `Authorization: Bearer` by any app instance on this database.
 */
const env = testEnv({ AUTH_TEST_SIGN_IN: 'true' });
let auth: ServeAuth | null = null;
const authInstance = () =>
  (auth ??= createAuth({
    env,
    prisma: createPrismaClient(env.DATABASE_URL),
    logger: createLogger(env),
  }));

export interface TestUser {
  /** AuthUser.id */
  uid: string;
  email: string;
  /** Signed session credential (`<token>.<signature>`), for `Authorization: Bearer`. */
  token: string;
}

/**
 * The raw session token stored in AuthSession.token (the part before the
 * signature). Only for locating the row in tests: it is not a credential.
 */
export const storedToken = (user: Pick<TestUser, 'token'>) => user.token.split('.')[0]!;

/** A unique, valid SRM address. */
export const uniqueEmail = (prefix = 'user') =>
  `${prefix}-${randomUUID().slice(0, 8)}@srmap.edu.in`;

/** Raw test sign-in; resolves with the Better Auth response (for rejection tests). */
export function testSignIn(
  email: string,
  options: { emailVerified?: boolean; name?: string } = {},
) {
  const base = env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`;
  return authInstance().handler(
    new Request(`${base}/api/auth/test/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email, ...options }),
    }),
  );
}

/** A unique personal (non-SRM) address, as staff may use. */
export const uniquePersonalEmail = (prefix = 'staff') =>
  `${prefix}-${randomUUID().slice(0, 8)}@example.com`;

/** A password that satisfies the policy (10–128 characters). */
export const TEST_PASSWORD = 'correct-horse-battery-staple';

/** Raw email + password sign-in (staff, admins) through the real Better Auth endpoint. */
export function passwordSignInRequest(email: string, password: string) {
  const base = env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`;
  return authInstance().handler(
    new Request(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email, password }),
    }),
  );
}

/**
 * Email + password sign-in; resolves with the signed session credential (the
 * session cookie's value, exactly what a browser holds), for `Authorization: Bearer`.
 */
export async function passwordSignIn(email: string, password = TEST_PASSWORD): Promise<TestUser> {
  const res = await passwordSignInRequest(email, password);
  const body = (await res.json()) as { user?: { id: string; email: string } };
  const name = (await authInstance().$context).authCookies.sessionToken.name;
  const cookie = res.headers
    .getSetCookie()
    .map((value) => value.split(';')[0]!)
    .find((value) => value.startsWith(`${name}=`));
  if (!res.ok || !body.user || !cookie) {
    throw new Error(`password sign-in failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return {
    uid: body.user.id,
    email: body.user.email,
    token: decodeURIComponent(cookie.slice(name.length + 1)),
  };
}

export async function createTestUser(
  email = uniqueEmail(),
  options: { name?: string } = {},
): Promise<TestUser> {
  const res = await testSignIn(email, options);
  const body = (await res.json()) as { token?: string; user?: { id: string; email: string } };
  if (!res.ok || !body.token || !body.user) {
    throw new Error(`test sign-in failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return { uid: body.user.id, email: body.user.email, token: body.token };
}
