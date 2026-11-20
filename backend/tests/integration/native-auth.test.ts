import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';

/**
 * Native (Android / iOS) Google sign-in: system browser → Better Auth Google
 * flow → app.serve.student://auth?code → PKCE-bound exchange → Bearer token.
 * Google's token endpoint is stubbed as in google-oauth.test.ts; everything
 * else is the real stack. Also: one sign-in serves all three web apps (the
 * shared session that replaced the SSO code handoff).
 */
const CLIENT_ID = 'serve-test-client.apps.googleusercontent.com';
const { app, prisma } = buildTestApp({
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'test-client-secret-not-real',
  GOOGLE_REQUIRE_HOSTED_DOMAIN: 'false',
  AUTH_TEST_SIGN_IN: 'false',
});

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
});
afterAll(() => prisma.$disconnect());
afterEach(() => vi.unstubAllGlobals());

let sub = 5000;
function stubGoogle(email: string, emailVerified = true) {
  const realFetch = globalThis.fetch;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const idToken = [
    encode({ alg: 'RS256', typ: 'JWT' }),
    encode({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      iat: now,
      exp: now + 3600,
      sub: String(++sub),
      email,
      email_verified: emailVerified,
      name: 'Native Student',
    }),
    'sig',
  ].join('.');
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return Response.json({
        access_token: 'a',
        expires_in: 3599,
        token_type: 'Bearer',
        id_token: idToken,
      });
    }
    return realFetch(input, init);
  });
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

/** The system browser's part; returns the app redirect (app.serve.student://auth?…). */
async function browserSignIn(email: string, challenge: string, emailVerified = true) {
  stubGoogle(email, emailVerified);
  const browser = request.agent(app);
  const start = await browser.get('/api/native-auth/start').query({ code_challenge: challenge });
  expect(start.status).toBe(302);
  const google = new URL(start.headers.location as string);
  expect(google.hostname).toBe('accounts.google.com');
  const callback = await browser
    .get('/api/auth/callback/google')
    .query({ code: 'test-code', state: google.searchParams.get('state') });
  expect(callback.status).toBe(302);
  const finishUrl = new URL(callback.headers.location as string);
  expect(finishUrl.pathname).toBe('/api/native-auth/finish');
  const finish = await browser.get(finishUrl.pathname + finishUrl.search);
  expect(finish.status).toBe(302);
  return new URL(finish.headers.location as string);
}

const exchange = (code: string | null, verifier: string) =>
  request(app).post('/api/native-auth/exchange').send({ code, code_verifier: verifier });

describe('native app sign-in', () => {
  it('signs in with Google and gets a Bearer session token', async () => {
    const { verifier, challenge } = pkce();
    const redirect = await browserSignIn('native@srmap.edu.in', challenge);
    expect(`${redirect.protocol}//${redirect.host}`).toBe('app.serve.student://auth');
    const code = redirect.searchParams.get('code');
    expect(code).toBeTruthy();

    const res = await exchange(code, verifier).expect(200);
    const token = res.body.data.token as string;
    // The signed session credential, never the raw token stored in the database.
    const stored = await prisma.authSession.findFirstOrThrow({
      where: { user: { email: 'native@srmap.edu.in' } },
      select: { token: true },
    });
    expect(token.startsWith(`${stored.token}.`)).toBe(true);
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${stored.token}`)
      .expect(401);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.data).toMatchObject({ registered: false, email: 'native@srmap.edu.in' });
    // Native requests carry no cookie or Origin: the CSRF origin check does not apply.
    const hostel = await prisma.hostel.findUniqueOrThrow({ where: { name: 'Krishna' } });
    await request(app)
      .post('/api/auth/student/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Native Student', hostelId: hostel.id })
      .expect(201);
  });

  it('a non-SRM or unverified account is refused back to the app', async () => {
    for (const [email, verified, code] of [
      ['someone@gmail.com', true, 'EMAIL_DOMAIN_NOT_ALLOWED'],
      ['someone@srmap.edu.in.attacker.com', true, 'EMAIL_DOMAIN_NOT_ALLOWED'],
      ['unverified.native@srmap.edu.in', false, 'EMAIL_NOT_VERIFIED'],
    ] as const) {
      const { challenge } = pkce();
      const redirect = await browserSignIn(email, challenge, verified);
      expect(redirect.searchParams.get('code')).toBeNull();
      expect(redirect.searchParams.get('error')).toBe(code);
      expect(await prisma.authUser.count({ where: { email } })).toBe(0);
    }
  });

  it('the code is useless without the verifier, and is then burnt', async () => {
    const { verifier, challenge } = pkce();
    const code = (await browserSignIn('pkce@srmap.edu.in', challenge)).searchParams.get('code');
    const wrong = await exchange(code, pkce().verifier).expect(401);
    expect(wrong.body.error.code).toBe('NATIVE_CODE_INVALID');
    await exchange(code, verifier).expect(401);
  });

  it('a code works once, and only one of concurrent exchanges wins', async () => {
    const { verifier, challenge } = pkce();
    const code = (await browserSignIn('once@srmap.edu.in', challenge)).searchParams.get('code');
    const results = await Promise.all(Array.from({ length: 5 }, () => exchange(code, verifier)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(4);
    await exchange(code, verifier).expect(401);
  });

  it('an expired code is refused', async () => {
    const { verifier, challenge } = pkce();
    const code = (await browserSignIn('late@srmap.edu.in', challenge)).searchParams.get('code');
    await prisma.authVerification.updateMany({
      where: { identifier: { startsWith: 'serve-native-sign-in:' } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await exchange(code, verifier).expect(401);
  });

  it('codes that were never redeemed are purged once expired', async () => {
    const { challenge } = pkce();
    await browserSignIn('abandoned@srmap.edu.in', challenge);
    const native = { identifier: { startsWith: 'serve-native-sign-in:' } };
    await prisma.authVerification.updateMany({
      where: native,
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const stale = await prisma.authVerification.count({ where: native });
    expect(stale).toBeGreaterThan(0);
    // The next sign-in clears every expired native code and stores its own.
    await browserSignIn('next@srmap.edu.in', pkce().challenge);
    expect(await prisma.authVerification.count({ where: native })).toBe(1);
  });

  it('a session signed out before the exchange cannot be redeemed', async () => {
    const { verifier, challenge } = pkce();
    const code = (await browserSignIn('gone@srmap.edu.in', challenge)).searchParams.get('code');
    await prisma.authSession.deleteMany({ where: { user: { email: 'gone@srmap.edu.in' } } });
    await exchange(code, verifier).expect(401);
  });

  it('rejects a start without a valid PKCE challenge, and bad exchange bodies', async () => {
    await request(app).get('/api/native-auth/start').expect(422);
    await request(app).get('/api/native-auth/start').query({ code_challenge: 'short' }).expect(422);
    await request(app).post('/api/native-auth/exchange').send({ code: 'x' }).expect(422);
    await request(app)
      .post('/api/native-auth/exchange')
      .send({ code: 'a'.repeat(43), code_verifier: 'b'.repeat(43), extra: true })
      .expect(422);
  });

  it('a finish without a sign-in in progress sends the app an error, never a code', async () => {
    const res = await request(app).get('/api/native-auth/finish').expect(302);
    const redirect = new URL(res.headers.location as string);
    expect(redirect.searchParams.get('error')).toBe('SIGN_IN_FAILED');
  });
});

describe('one sign-in for all three web apps (replaces the SSO code handoff)', () => {
  it('the same session cookie works from the student app, staff dashboard and admin portal', async () => {
    stubGoogle('shared@srmap.edu.in');
    const browser = request.agent(app);
    const start = await browser
      .post('/api/auth/sign-in/social')
      .set('Origin', 'http://localhost:5555')
      .send({ provider: 'google', callbackURL: 'http://localhost:5555/' })
      .expect(200);
    const state = new URL(start.body.url as string).searchParams.get('state');
    await browser.get('/api/auth/callback/google').query({ code: 'c', state }).expect(302);
    for (const origin of [
      'http://localhost:5555',
      'http://localhost:5173',
      'http://localhost:5174',
    ]) {
      const me = await browser.get('/api/auth/me').set('Origin', origin).expect(200);
      expect(me.body.data.email).toBe('shared@srmap.edu.in');
    }
    // Signing out once signs out everywhere.
    await browser
      .post('/api/auth/sign-out')
      .set('Origin', 'http://localhost:5173')
      .send({})
      .expect(200);
    await browser.get('/api/auth/me').set('Origin', 'http://localhost:5174').expect(401);
  });

  it('the old SSO endpoints are gone', async () => {
    await request(app).post('/api/auth/sso/initiate').send({ audience: 'STAFF' }).expect(404);
    await request(app)
      .post('/api/auth/sso/exchange')
      .send({ code: 'x'.repeat(20), audience: 'STAFF' })
      .expect(404);
  });
});
