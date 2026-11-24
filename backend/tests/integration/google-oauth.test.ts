import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';

/**
 * The real Better Auth Google sign-in, end to end: POST /sign-in/social →
 * redirect to Google → GET /callback/google → SRM gate → session cookie.
 *
 * Only the network call to Google's token endpoint is replaced (in-process
 * `fetch` stub) by one returning an ID token with the claims under test,
 * because a real Google account cannot sign in inside automated tests.
 * State, PKCE, cookies, user/account/session creation and every SERVE rule
 * run unchanged. The test-only sign-in endpoint is OFF here.
 */
const CLIENT_ID = 'serve-test-client.apps.googleusercontent.com';
const APP = 'http://localhost:5173';

function buildGoogleApp(extra: Record<string, string> = {}) {
  return buildTestApp({
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'test-client-secret-not-real',
    AUTH_TEST_SIGN_IN: 'false',
    ...extra,
  });
}
const strict = buildGoogleApp();
const noHd = buildGoogleApp({ GOOGLE_REQUIRE_HOSTED_DOMAIN: 'false' });

beforeAll(async () => {
  await truncateAll(strict.prisma);
  await seedDatabase(strict.prisma);
});
afterAll(async () => {
  await strict.prisma.$disconnect();
  await noHd.prisma.$disconnect();
});
afterEach(() => vi.unstubAllGlobals());

let sub = 1000;
interface Claims {
  email: string;
  email_verified?: boolean;
  hd?: string | undefined;
  sub?: string;
  name?: string;
}

/** Unsigned ID token: in the code flow it comes straight from Google over TLS and is not re-verified. */
function idToken(claims: Claims) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return [
    encode({ alg: 'RS256', typ: 'JWT', kid: 'test' }),
    encode({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      iat: now,
      exp: now + 3600,
      sub: claims.sub ?? String(++sub),
      email: claims.email,
      email_verified: claims.email_verified ?? true,
      name: claims.name ?? 'Test User',
      ...(claims.hd === undefined ? {} : { hd: claims.hd }),
    }),
    'signature',
  ].join('.');
}

/** Google's token endpoint answers with this ID token; everything else is the real network stack. */
function stubGoogleToken(claims: Claims) {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      calls.push(url);
      return new Response(
        JSON.stringify({
          access_token: 'test-access-token',
          expires_in: 3599,
          token_type: 'Bearer',
          scope: 'openid email profile',
          id_token: idToken(claims),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return realFetch(input, init);
  });
  return calls;
}

/** Runs the whole browser flow; returns the callback redirect and the agent (cookie jar). */
async function googleSignIn(app: typeof strict.app, claims: Claims) {
  const calls = stubGoogleToken(claims);
  const agent = request.agent(app);
  const start = await agent
    .post('/api/auth/sign-in/social')
    .set('Origin', APP)
    .send({ provider: 'google', callbackURL: `${APP}/`, errorCallbackURL: `${APP}/sign-in` })
    .expect(200);
  const google = new URL(start.body.url as string);
  const callback = await agent
    .get('/api/auth/callback/google')
    .query({ code: 'test-authorization-code', state: google.searchParams.get('state') });
  return { start, google, callback, agent, calls };
}

const errorOf = (location: string | undefined) =>
  location ? new URL(location).searchParams.get('error') : null;

describe('Google sign-in (real Better Auth flow)', () => {
  it('redirects to Google with PKCE, state and the SRM hosted domain', async () => {
    const { google } = await googleSignIn(strict.app, {
      email: 'redirect@srmap.edu.in',
      hd: 'srmap.edu.in',
    });
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(google.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(google.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5101/api/auth/callback/google',
    );
    expect(google.searchParams.get('hd')).toBe('srmap.edu.in');
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    expect(google.searchParams.get('code_challenge')).toBeTruthy();
    expect(google.searchParams.get('state')).toBeTruthy();
    expect(google.searchParams.get('scope')).toContain('email');
  });

  it('a verified @srmap.edu.in account registers, gets a session and stays signed in', async () => {
    const { callback, agent, calls } = await googleSignIn(strict.app, {
      email: 'Asha.Rao@SRMAP.edu.in',
      hd: 'srmap.edu.in',
      sub: 'google-sub-asha',
    });
    expect(calls).toHaveLength(1);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(`${APP}/`);
    const cookies = String(callback.headers['set-cookie']);
    expect(cookies).toMatch(/serve\.session_token=/);
    expect(cookies).toMatch(/HttpOnly/i);
    expect(cookies).toMatch(/SameSite=Lax/i);

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.data).toMatchObject({
      registered: false,
      role: null,
      email: 'asha.rao@srmap.edu.in',
    });
    const user = await strict.prisma.authUser.findUniqueOrThrow({
      where: { email: 'asha.rao@srmap.edu.in' },
      include: { accounts: true },
    });
    expect(user.emailVerified).toBe(true);
    expect(user.accounts).toMatchObject([{ providerId: 'google', accountId: 'google-sub-asha' }]);

    // Signing in again with the same Google account reuses the identity.
    const again = await googleSignIn(strict.app, {
      email: 'asha.rao@srmap.edu.in',
      hd: 'srmap.edu.in',
      sub: 'google-sub-asha',
    });
    expect(again.callback.headers.location).toBe(`${APP}/`);
    expect(await strict.prisma.authUser.count({ where: { email: 'asha.rao@srmap.edu.in' } })).toBe(
      1,
    );
    // Both sessions are valid until signed out.
    await again.agent.get('/api/auth/me').expect(200);
    await agent.get('/api/auth/me').expect(200);
  });

  it('logout ends the session', async () => {
    const { agent } = await googleSignIn(strict.app, {
      email: 'logout@srmap.edu.in',
      hd: 'srmap.edu.in',
    });
    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/sign-out').set('Origin', APP).send({}).expect(200);
    const after = await agent.get('/api/auth/me').expect(401);
    expect(after.body.error.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    ['personal Gmail', 'student@gmail.com', 'gmail.com'],
    ['Yahoo', 'student@yahoo.com', undefined],
    ['look-alike suffix', 'student@srmap.edu.in.attacker.com', 'srmap.edu.in.attacker.com'],
    ['look-alike prefix', 'student@fake-srmap.edu.in', 'fake-srmap.edu.in'],
    ['subdomain', 'student@mail.srmap.edu.in', 'mail.srmap.edu.in'],
  ])('rejects %s, creating no identity or session', async (_label, email, hd) => {
    // Without the hosted-domain option, so SERVE's own email rule is what rejects.
    const { callback, agent } = await googleSignIn(noHd.app, { email, hd });
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toMatch(new RegExp(`^${APP}/sign-in\\?`));
    expect(errorOf(callback.headers.location)).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    expect(String(callback.headers['set-cookie'] ?? '')).not.toMatch(/serve\.session_token=[^;]/);
    expect(await noHd.prisma.authUser.count({ where: { email: email.toLowerCase() } })).toBe(0);
    await agent.get('/api/auth/me').expect(401);
  });

  it('rejects an @srmap.edu.in address that Google has not verified', async () => {
    const email = 'unverified@srmap.edu.in';
    const { callback, agent } = await googleSignIn(noHd.app, {
      email,
      email_verified: false,
      hd: 'srmap.edu.in',
    });
    expect(errorOf(callback.headers.location)).toBe('EMAIL_NOT_VERIFIED');
    expect(await noHd.prisma.authUser.count({ where: { email } })).toBe(0);
    await agent.get('/api/auth/me').expect(401);
  });

  it('with the hosted-domain check on, rejects a token without the SRM hd claim', async () => {
    const email = 'nohd@srmap.edu.in';
    const { callback } = await googleSignIn(strict.app, { email, hd: undefined });
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toMatch(new RegExp(`^${APP}/sign-in\\?`));
    expect(errorOf(callback.headers.location)).toBeTruthy();
    expect(await strict.prisma.authUser.count({ where: { email } })).toBe(0);
  });

  it('re-checks a returning user: a Google account that moved out of SRM is refused', async () => {
    const sub = 'google-sub-mover';
    const first = await googleSignIn(noHd.app, { email: 'mover@srmap.edu.in', sub });
    expect(first.callback.headers.location).toBe(`${APP}/`);
    const moved = await googleSignIn(noHd.app, { email: 'mover@gmail.com', sub });
    expect(errorOf(moved.callback.headers.location)).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    await moved.agent.get('/api/auth/me').expect(401);
    // The stored identity is unchanged.
    const user = await noHd.prisma.authUser.findFirstOrThrow({
      where: { accounts: { some: { accountId: sub } } },
    });
    expect(user.email).toBe('mover@srmap.edu.in');
  });

  it('re-checks a returning user whose Google email is no longer verified', async () => {
    const sub = 'google-sub-unverify';
    await googleSignIn(noHd.app, { email: 'later@srmap.edu.in', sub });
    const next = await googleSignIn(noHd.app, {
      email: 'later@srmap.edu.in',
      sub,
      email_verified: false,
    });
    expect(errorOf(next.callback.headers.location)).toBe('EMAIL_NOT_VERIFIED');
    await next.agent.get('/api/auth/me').expect(401);
  });

  it('never links a second Google account to an existing identity by email', async () => {
    const email = 'linked@srmap.edu.in';
    await googleSignIn(noHd.app, { email, sub: 'google-sub-original' });
    const other = await googleSignIn(noHd.app, { email, sub: 'google-sub-impostor' });
    expect(errorOf(other.callback.headers.location)).toBe('account_not_linked');
    await other.agent.get('/api/auth/me').expect(401);
    const accounts = await noHd.prisma.authAccount.findMany({ where: { user: { email } } });
    expect(accounts.map((a) => a.accountId)).toEqual(['google-sub-original']);
  });

  it('refuses a sign-in that redirects to an untrusted site', async () => {
    const res = await request(strict.app)
      .post('/api/auth/sign-in/social')
      .set('Origin', APP)
      .send({ provider: 'google', callbackURL: 'https://evil.example.com/' });
    expect(res.status).toBe(403);
  });

  it('refuses a forged callback (no matching state)', async () => {
    stubGoogleToken({ email: 'forged@srmap.edu.in' });
    const res = await request(strict.app)
      .get('/api/auth/callback/google')
      .query({ code: 'x', state: 'not-a-real-state' });
    expect(res.status).toBe(302);
    expect(res.headers.location).not.toBe(`${APP}/`);
    expect(await strict.prisma.authUser.count({ where: { email: 'forged@srmap.edu.in' } })).toBe(0);
  });

  it('there is no public email/password sign-up, and a student has no password', async () => {
    const body = { email: 'pw@srmap.edu.in', password: 'Password-12345', name: 'Pw' };
    const signUp = await request(strict.app)
      .post('/api/auth/sign-up/email')
      .set('Origin', APP)
      .send(body);
    expect(signUp.status).toBe(404);
    const signIn = await request(strict.app)
      .post('/api/auth/sign-in/email')
      .set('Origin', APP)
      .send(body);
    expect(signIn.status).toBe(401);
    expect(signIn.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    expect(await strict.prisma.authUser.count({ where: { email: body.email } })).toBe(0);

    // A real Google student cannot use the password sign-in either.
    const { callback } = await googleSignIn(strict.app, {
      email: 'google-only@srmap.edu.in',
      hd: 'srmap.edu.in',
    });
    expect(callback.headers.location).toBe(`${APP}/`);
    const student = await request(strict.app)
      .post('/api/auth/sign-in/email')
      .set('Origin', APP)
      .send({ email: 'google-only@srmap.edu.in', password: 'Password-12345' });
    expect(student.status).toBe(401);
    expect(student.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });

  it('Google never signs in a staff member or admin', async () => {
    // A provisioned admin (not yet linked) and a staff account with a password.
    await strict.prisma.admin.create({
      data: { email: 'google-admin@srmap.edu.in', name: 'Admin' },
    });
    const admin = await googleSignIn(strict.app, {
      email: 'google-admin@srmap.edu.in',
      hd: 'srmap.edu.in',
    });
    expect(errorOf(admin.callback.headers.location)).toBe('STAFF_ADMIN_USE_PASSWORD');
    expect(
      (
        await strict.prisma.admin.findUniqueOrThrow({
          where: { email: 'google-admin@srmap.edu.in' },
        })
      ).authUserId,
    ).toBeNull();

    await request(strict.app)
      .post('/api/auth/staff/sign-up')
      .send({ name: 'Staff', email: 'google-staff@srmap.edu.in', password: 'Password-12345' })
      .expect(201);
    const staff = await googleSignIn(strict.app, {
      email: 'google-staff@srmap.edu.in',
      hd: 'srmap.edu.in',
    });
    // The address belongs to a password identity: Google cannot attach to it.
    expect(staff.callback.headers.location).not.toBe(`${APP}/`);
    expect(errorOf(staff.callback.headers.location)).toBeTruthy();
    expect(
      await strict.prisma.authSession.count({
        where: {
          user: { email: { in: ['google-admin@srmap.edu.in', 'google-staff@srmap.edu.in'] } },
        },
      }),
    ).toBe(0);
  });

  it('the test-only sign-in endpoint does not exist unless explicitly enabled', async () => {
    const res = await request(strict.app)
      .post('/api/auth/test/sign-in')
      .set('Origin', APP)
      .send({ email: 'sneaky@srmap.edu.in' });
    expect(res.status).toBe(404);
    expect(await strict.prisma.authUser.count({ where: { email: 'sneaky@srmap.edu.in' } })).toBe(0);
  });
});
