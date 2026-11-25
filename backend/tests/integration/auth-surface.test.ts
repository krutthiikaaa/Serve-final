import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { EXPOSED_AUTH_PATHS } from '../../src/lib/auth.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import { createTestUser, storedToken } from '../helpers/identity.js';

/**
 * The Better Auth HTTP surface SERVE exposes, and how session credentials
 * travel. A page script (or any client) must not be able to rewrite the
 * identity, read session credentials, or use a leaked raw session token.
 */
const APP = 'http://localhost:5173';
const { app, prisma, ctx } = buildTestApp();

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, Origin: APP });

/** Every endpoint the configured Better Auth instance defines, as concrete request paths. */
function betterAuthPaths(): { path: string; methods: string[] }[] {
  const seen = new Map<string, Set<string>>();
  for (const endpoint of Object.values(ctx.auth.api) as {
    path?: string;
    options?: { method?: string | string[]; metadata?: { SERVER_ONLY?: boolean } };
  }[]) {
    if (!endpoint.path || endpoint.options?.metadata?.SERVER_ONLY) continue;
    const path = endpoint.path.replace(/:id\b/, 'google').replace(/:[a-z]+/gi, 'x');
    const methods = [endpoint.options?.method ?? 'GET'].flat().filter((m) => m !== '*');
    seen.set(path, new Set([...(seen.get(path) ?? []), ...(methods.length ? methods : ['GET'])]));
  }
  return [...seen].map(([path, methods]) => ({ path, methods: [...methods] }));
}

describe('Better Auth endpoint surface', () => {
  it('exposes only the sign-in, callback, password change, session and sign-out endpoints', async () => {
    const user = await createTestUser();
    const closed = betterAuthPaths().filter(({ path }) => !EXPOSED_AUTH_PATHS.has(path));
    // Sanity: the enumeration really covers Better Auth's extra endpoints.
    expect(closed.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        '/list-sessions',
        '/update-user',
        '/link-social',
        '/unlink-account',
        '/get-access-token',
        // No public password sign-up or email-based reset: staff sign up
        // through SERVE (always PENDING), admins are provisioned.
        '/sign-up/email',
        '/request-password-reset',
        '/reset-password',
      ]),
    );
    for (const { path, methods } of closed) {
      for (const method of methods) {
        const url = '/api/auth' + path;
        const res =
          method === 'GET'
            ? await request(app).get(url).set(bearer(user.token))
            : await request(app).post(url).set(bearer(user.token)).send({});
        // SERVE's own JSON 404: the request never reached Better Auth.
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.body.error?.code, `${method} ${path}`).toBe('ROUTE_NOT_FOUND');
      }
    }
    // Another provider's callback is not a route either.
    const github = await request(app).get('/api/auth/callback/github').expect(404);
    expect(github.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('a signed-in user cannot rewrite their identity (name, image, email)', async () => {
    const user = await createTestUser(undefined, { name: 'Real Name' });
    await request(app)
      .post('/api/auth/update-user')
      .set(bearer(user.token))
      .send({ name: 'Someone Else', image: 'https://evil.example/pixel.png' })
      .expect(404);
    const row = await prisma.authUser.findUniqueOrThrow({ where: { id: user.uid } });
    expect(row).toMatchObject({ name: 'Real Name', image: null, email: user.email });
  });

  it('the endpoints the apps use still work', async () => {
    const user = await createTestUser();
    const session = await request(app).get('/api/auth/get-session').set(bearer(user.token));
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe(user.email);
    await request(app)
      .post('/api/auth/sign-in/social')
      .set('Origin', APP)
      .send({ provider: 'google', callbackURL: APP })
      // No Google client in this app: Better Auth itself answers (the route
      // exists); it is not SERVE's route-not-found.
      .expect((res) => expect(res.body.error?.code).not.toBe('ROUTE_NOT_FOUND'));
    await request(app).post('/api/auth/sign-out').set(bearer(user.token)).send({}).expect(200);
    await request(app).get('/api/auth/me').set(bearer(user.token)).expect(401);
  });
});

describe('session credentials', () => {
  it('a raw session token (as stored, or seen in a response body) is not a credential', async () => {
    const user = await createTestUser();
    const raw = storedToken(user);
    expect(raw).not.toBe(user.token);
    await request(app).get('/api/auth/me').set(bearer(raw)).expect(401);
    await request(app)
      .get('/api/auth/me')
      .set('Cookie', `serve.session_token=${encodeURIComponent(raw)}`)
      .expect(401);
    // The signed credential works.
    await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
  });

  it('a forged signature is refused', async () => {
    const user = await createTestUser();
    const forged = `${storedToken(user)}.${'A'.repeat(43)}`;
    await request(app).get('/api/auth/me').set(bearer(forged)).expect(401);
  });

  it('no response ever carries the session credential in a readable header', async () => {
    const agent = request.agent(app);
    const signIn = await agent
      .post('/api/auth/test/sign-in')
      .set('Origin', APP)
      .send({ email: `surface-${Date.now()}@srmap.edu.in` });
    expect(signIn.status).toBe(200);
    expect(signIn.headers['set-auth-token']).toBeUndefined();
    const token = signIn.body.token as string;
    // Make the session due for renewal, so get-session re-issues the cookie
    // (the case in which Better Auth's bearer plugin adds set-auth-token).
    await prisma.authSession.updateMany({
      where: { token: token.split('.')[0]! },
      data: { expiresAt: new Date(Date.now() + 2 * 24 * 3600 * 1000) },
    });
    const renewed = await agent.get('/api/auth/get-session').set('Origin', APP).expect(200);
    expect(String(renewed.headers['set-cookie'])).toMatch(/serve\.session_token=.*HttpOnly/i);
    expect(renewed.headers['set-auth-token']).toBeUndefined();
    expect(String(renewed.headers['access-control-expose-headers'] ?? '')).not.toMatch(
      /set-auth-token/i,
    );
  });
});
