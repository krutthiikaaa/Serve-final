import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { parseSetCookieHeader, setSessionCookie } from 'better-auth/cookies';
import { bearer } from 'better-auth/plugins';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import type { PrismaClient } from './prisma.js';
import {
  SRM_EMAIL_DOMAIN,
  SRM_REJECTION_MESSAGE,
  normalizeEmail,
  srmIdentityRejection,
} from '../modules/auth/srm-email.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SIGN_IN_METHOD_MESSAGE,
  isPasswordIdentityEmail,
  type AuthMethod,
} from '../modules/auth/sign-in-method.js';

/**
 * Better Auth: the single sign-in system for the student app, staff
 * dashboard and admin portal. Mounted on this Express server at /api/auth
 * (see app.ts). It proves identity only; Student / Staff / Admin rows in
 * PostgreSQL decide roles (modules/auth/principal.ts).
 *
 * Sign-in methods are role-specific (modules/auth/sign-in-method.ts):
 * - Students: Google OAuth (authorization-code flow with PKCE), restricted to
 *   verified @srmap.edu.in accounts.
 * - Staff and admins: email + password (scrypt hashes). Better Auth's public
 *   sign-up is disabled: password identities are created only by staff
 *   self-registration (POST /api/auth/staff/sign-up, always PENDING) and by
 *   admin provisioning scripts.
 * Every new session records its method (AuthSession.authMethod); the session
 * hook below refuses a method that does not match the account's role.
 * Sessions are database-backed: an HttpOnly cookie for the web apps, or the
 * same session token as a Bearer token for the native app.
 */

/** Session token prefix for cookies: `serve.session_token` (`__Secure-` in production). */
const COOKIE_PREFIX = 'serve';
/** Fixed secret for NODE_ENV=test only (env validation requires a real one elsewhere). */
const TEST_ONLY_SECRET = 'serve-test-only-secret-not-for-any-real-deployment';
/** `source.method` of the test-only sign-in endpoint (see testSignIn below). */
const TEST_SIGN_IN_METHOD = 'serve-test';

export const AUTH_BASE_PATH = '/api/auth';

/** Session lifetime: 7 days, renewed (sliding) at most once a day while in use. */
export const SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

/**
 * The only Better Auth HTTP endpoints SERVE exposes (paths under
 * AUTH_BASE_PATH). Everything else Better Auth ships — profile and email
 * changes, account linking and unlinking, provider access tokens, session
 * listing (which returns session tokens), password flows — answers 404, so
 * neither a page script nor a crafted request can reach it. Server-side
 * `auth.api` calls (native sign-in, session checks) are unaffected.
 */
export const EXPOSED_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/sign-in/social', // start Google sign-in (state + PKCE) — students
  '/callback/google', // Google redirects back here
  '/sign-in/email', // email + password — staff and admins
  '/change-password', // staff and admins (app.ts checks the session first)
  '/get-session', // web apps: who is signed in
  '/sign-out', // end this session
  '/revoke-other-sessions', // sign out other devices
  '/revoke-sessions', // sign out everywhere
  '/test/sign-in', // exists only with NODE_ENV=test + AUTH_TEST_SIGN_IN=true
]);

/**
 * Better Auth's session cookie value (`<token>.<signature>`) as received in a
 * request's Cookie header, or null. It is the credential the native app sends
 * as `Authorization: Bearer` (raw tokens are refused; see bearer() below).
 */
export async function signedSessionToken(
  auth: { $context: Promise<{ authCookies: { sessionToken: { name: string } } }> },
  cookieHeader: string | undefined,
): Promise<string | null> {
  const { name } = (await auth.$context).authCookies.sessionToken;
  for (const part of (cookieHeader ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    const value = rest.join('=');
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Origins whose pages may start a sign-in and receive the redirect back. */
export function trustedOriginsFor(env: Env): string[] {
  const local =
    env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5555'];
  const origins = [
    ...env.CORS_ORIGINS,
    authBaseUrl(env),
    ...[env.STUDENT_APP_URL, env.STAFF_DASHBOARD_URL, env.ADMIN_PORTAL_URL]
      .filter((url): url is string => Boolean(url))
      .map((url) => new URL(url).origin),
    ...local,
  ];
  return [...new Set(origins)];
}

export function authBaseUrl(env: Env): string {
  return env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`;
}

function reject(code: keyof typeof SRM_REJECTION_MESSAGE): never {
  throw new APIError('FORBIDDEN', { code, message: SRM_REJECTION_MESSAGE[code] });
}

/** Same answer as a wrong password: never reveal which accounts exist or their role. */
function invalidCredentials(): never {
  throw new APIError('UNAUTHORIZED', {
    code: 'INVALID_EMAIL_OR_PASSWORD',
    message: 'Invalid email or password',
  });
}

/**
 * The sign-in method of a session being created, from the Better Auth
 * endpoint creating it. Only these endpoints may create sessions.
 */
export function sessionMethodFor(path: string | undefined, testSignIn: boolean): AuthMethod | null {
  if (!path) return null;
  if (path.startsWith('/callback/')) return 'google';
  // Password sign-in, and the replacement session change-password issues
  // when it revokes the others (only password identities can change one).
  if (path === '/sign-in/email' || path === '/change-password') return 'password';
  // The test-only endpoint simulates a Google sign-in.
  if (testSignIn && path === '/test/sign-in') return 'google';
  return null;
}

/** Defence in depth for every stored identity: SRM address, verified by Google. */
function assertStoredIdentity(user: { email?: unknown; emailVerified?: unknown }) {
  const rejection = srmIdentityRejection({ email: user.email, emailVerified: user.emailVerified });
  if (rejection) reject(rejection);
}

/**
 * Test-only sign-in: creates (or reuses) an identity and a session without
 * Google, through the same SRM gate, so automated tests can sign in. Present
 * only when NODE_ENV=test AND AUTH_TEST_SIGN_IN=true; env validation refuses
 * to start otherwise, and this factory refuses again as a second guard.
 */
function testSignIn(env: Env) {
  if (env.NODE_ENV !== 'test' || !env.AUTH_TEST_SIGN_IN) {
    throw new Error('The test sign-in endpoint is only available with NODE_ENV=test');
  }
  const body = z.object({
    email: z.string().max(254),
    name: z.string().trim().min(1).max(120).optional(),
    /** Simulates Google's email_verified claim (default true). */
    emailVerified: z.boolean().optional(),
  });
  return {
    id: 'serve-test-sign-in',
    endpoints: {
      testSignIn: createAuthEndpoint('/test/sign-in', { method: 'POST', body }, async (c) => {
        const email = normalizeEmail(c.body.email) ?? '';
        const emailVerified = c.body.emailVerified ?? true;
        const existing = await c.context.internalAdapter.findUserByEmail(email);
        const user =
          existing?.user ??
          (await c.context.internalAdapter.createUser(
            { email, name: c.body.name ?? email.split('@')[0] ?? 'Student', emailVerified },
            { method: TEST_SIGN_IN_METHOD },
          ));
        // A returning test user is re-checked like a returning Google user.
        if (existing) {
          const rejection = srmIdentityRejection({ email, emailVerified });
          if (rejection) reject(rejection);
        }
        const session = await c.context.internalAdapter.createSession(user.id);
        await setSessionCookie(c, { session, user });
        // Hand back the signed cookie value, exactly what a native sign-in
        // returns; a raw session token is not a credential (requireSignature).
        const cookie = parseSetCookieHeader(c.responseHeaders.get('set-cookie') ?? '').get(
          c.context.authCookies.sessionToken.name,
        );
        const token = cookie?.value ? decodeURIComponent(cookie.value) : null;
        if (!token) throw new APIError('INTERNAL_SERVER_ERROR', { message: 'No session cookie' });
        return c.json({ token, user: { id: user.id, email: user.email } });
      }),
    },
  } as const;
}

export interface CreateAuthOptions {
  env: Env;
  prisma: PrismaClient;
  logger: Logger;
}

export function createAuth({ env, prisma, logger }: CreateAuthOptions) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          // Google also enforces the hosted domain on the account chooser and
          // in the id token's `hd` claim (rejected when missing or different).
          ...(env.GOOGLE_REQUIRE_HOSTED_DOMAIN ? { hd: SRM_EMAIL_DOMAIN } : {}),
          prompt: 'select_account' as const,
          // Sign-in only through the redirect flow (state + PKCE); raw ID
          // tokens posted by a client are not accepted.
          disableIdTokenSignIn: true,
          // Refresh name/picture/email from Google on every sign-in, so a
          // changed address is re-validated (user.validateUserInfo).
          overrideUserInfoOnSignIn: true,
        }
      : undefined;
  if (!google && env.NODE_ENV !== 'test') {
    logger.warn(
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set: Google sign-in is unavailable until they are configured in backend/.env',
    );
  }
  const testPlugins = env.NODE_ENV === 'test' && env.AUTH_TEST_SIGN_IN ? [testSignIn(env)] : [];

  const options = {
    appName: 'SERVE',
    baseURL: authBaseUrl(env),
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET ?? (env.NODE_ENV === 'test' ? TEST_ONLY_SECRET : undefined),
    trustedOrigins: trustedOriginsFor(env),
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    telemetry: { enabled: false },
    user: {
      modelName: 'AuthUser',
      /**
       * The SRM gate. Runs when an identity is created, when an account is
       * linked, and on EVERY returning Google sign-in with Google's fresh
       * email and email_verified (not the stored row).
       */
      validateUserInfo: ({ user, source }) => {
        const viaGoogle = source.method === 'oauth' && source.oauth?.providerId === 'google';
        const viaTest = source.method === TEST_SIGN_IN_METHOD && testPlugins.length > 0;
        if (!viaGoogle && !viaTest) {
          return { error: 'SIGN_IN_METHOD_NOT_ALLOWED', errorDescription: 'Sign in with Google.' };
        }
        if (viaGoogle) {
          const profile = source.oauth?.profile;
          // Google's own claim, when present, must agree.
          if (profile && 'email_verified' in profile && profile.email_verified !== true) {
            return {
              error: 'EMAIL_NOT_VERIFIED',
              errorDescription: SRM_REJECTION_MESSAGE.EMAIL_NOT_VERIFIED,
            };
          }
        }
        const rejection = srmIdentityRejection({
          email: user.email,
          emailVerified: user.emailVerified,
        });
        return rejection
          ? { error: rejection, errorDescription: SRM_REJECTION_MESSAGE[rejection] }
          : undefined;
      },
    },
    session: {
      modelName: 'AuthSession',
      // Explicit (these equal Better Auth's defaults), so a library upgrade
      // cannot silently change them: a session lasts 7 days and is renewed
      // at most once a day while in use; sign-out deletes it at once.
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      additionalFields: {
        // 'google' | 'password', set by the session create hook; never from input.
        authMethod: { type: 'string', required: false, input: false },
      },
    },
    account: {
      modelName: 'AuthAccount',
      // Never attach another sign-in method (or another Google account) to an
      // existing identity by email. Google cannot take over a password
      // identity with the same address, nor the reverse.
      accountLinking: { enabled: false },
    },
    verification: { modelName: 'AuthVerification' },
    emailAndPassword: {
      // Staff and admins only: the session hook refuses a password session
      // for any identity without a Staff or Admin account.
      enabled: true,
      // No public sign-up (/sign-up/email is also not exposed): password
      // identities are created by SERVE itself (staff sign-up, admin scripts).
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // SERVE sends no email, so it cannot verify addresses; it does not
      // pretend to (password identities keep emailVerified=false).
      requireEmailVerification: false,
      autoSignIn: false,
    },
    socialProviders: google ? { google } : {},
    databaseHooks: {
      user: {
        create: {
          before: (user) => {
            assertStoredIdentity(user);
            return Promise.resolve({
              data: { ...user, email: normalizeEmail(user.email) ?? user.email },
            });
          },
        },
        update: {
          before: (data) => {
            // Partial updates: check the values being written.
            if (
              data.email !== undefined &&
              srmIdentityRejection({ email: data.email, emailVerified: true })
            ) {
              reject('EMAIL_DOMAIN_NOT_ALLOWED');
            }
            if (data.emailVerified === false) reject('EMAIL_NOT_VERIFIED');
            return Promise.resolve(
              data.email === undefined
                ? undefined
                : { data: { ...data, email: normalizeEmail(data.email) ?? data.email } },
            );
          },
        },
      },
      session: {
        create: {
          // Every new session records how it was created and must match the
          // account's role, so no path can sign a student in with a password
          // or a staff member / admin in with Google:
          //   google   → verified @srmap.edu.in, and no Staff/Admin account
          //              (linked, or unlinked with the same address)
          //   password → a linked Staff or Admin account (any well-formed address)
          before: async (session, context) => {
            const method = sessionMethodFor(context?.path, testPlugins.length > 0);
            if (!method) {
              throw new APIError('FORBIDDEN', {
                code: 'SIGN_IN_METHOD_NOT_ALLOWED',
                message: 'This sign-in method is not available.',
              });
            }
            const user = await prisma.authUser.findUnique({
              where: { id: session.userId },
              select: {
                email: true,
                emailVerified: true,
                staff: { select: { id: true } },
                admin: { select: { id: true } },
              },
            });
            if (method === 'google') {
              if (!user) reject('EMAIL_DOMAIN_NOT_ALLOWED');
              // The role rule first: it gives a staff member or admin the
              // useful answer ("use your password"), whatever else is wrong.
              const [unlinkedStaff, unlinkedAdmins] = await Promise.all([
                prisma.staff.count({ where: { email: user.email, authUserId: null } }),
                prisma.admin.count({ where: { email: user.email, authUserId: null } }),
              ]);
              if (user.staff || user.admin || unlinkedStaff > 0 || unlinkedAdmins > 0) {
                throw new APIError('FORBIDDEN', {
                  code: 'STAFF_ADMIN_USE_PASSWORD',
                  message: SIGN_IN_METHOD_MESSAGE.password,
                });
              }
              assertStoredIdentity(user);
            } else {
              if (!user || (!user.staff && !user.admin)) invalidCredentials();
              if (!isPasswordIdentityEmail(user.email)) invalidCredentials();
            }
            return { data: { ...session, authMethod: method } };
          },
        },
      },
      account: {
        create: {
          before: (account) => {
            if (account.providerId !== 'google' && testPlugins.length === 0) {
              throw new APIError('FORBIDDEN', {
                code: 'SIGN_IN_METHOD_NOT_ALLOWED',
                message: 'Sign in with Google.',
              });
            }
            return Promise.resolve();
          },
        },
      },
    },
    advanced: {
      // Better Auth skips its origin / callbackURL check under NODE_ENV=test
      // by default. Keep it on everywhere so tests prove the production rule:
      // sign-in may only redirect back to a trusted SERVE app.
      disableOriginCheck: false,
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: env.NODE_ENV === 'production',
      // HttpOnly session cookie, sent on top-level navigations and same-site
      // requests only. The three apps reach the API same-site (one domain in
      // production; localhost ports locally).
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },
    plugins: [
      // Native app: `Authorization: Bearer <token>.<signature>` — the signed
      // session cookie value, obtained through the PKCE exchange. A raw
      // session token (as stored in AuthSession, or as returned in a
      // get-session body) is refused, so seeing one never grants access.
      // The plugin's `set-auth-token` response header is removed where Better
      // Auth is mounted (app.ts): page scripts must never see a credential.
      bearer({ requireSignature: true }),
      ...testPlugins,
    ],
    onAPIError: {
      // OAuth failures (e.g. a non-SRM account) land on a JSON-free page of
      // the app that started the sign-in via its errorCallbackURL; this is
      // only the fallback.
      errorURL: `${authBaseUrl(env)}/api/auth-error`,
    },
    logger: {
      level: env.NODE_ENV === 'test' ? 'error' : 'warn',
      log: (level, message, ...args) => {
        const fields = args.length > 0 ? { details: args } : {};
        if (level === 'error') logger.error(fields, `better-auth: ${message}`);
        else if (level === 'warn') logger.warn(fields, `better-auth: ${message}`);
        else logger.debug(fields, `better-auth: ${message}`);
      },
    },
  } satisfies BetterAuthOptions;

  return betterAuth(options);
}

export type ServeAuth = ReturnType<typeof createAuth>;
