import { randomUUID } from 'node:crypto';
import { createAuth, type ServeAuth } from '../../src/lib/auth.js';
import { createPrismaClient } from '../../src/lib/prisma.js';
import { createLogger } from '../../src/config/logger.js';
import { testEnv } from './test-app.js';

/**
 * Sign-in identities for tests. Goes through the REAL Better Auth instance
 * (same configuration as production) via its test-only sign-in endpoint,
 * which applies the same SRM gate, database hooks and session creation as a
 * Google sign-in. The returned token is a genuine Better Auth session token,
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
  /** Session token, for `Authorization: Bearer`. */
  token: string;
}

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
