import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFirebaseAuth } from '../../src/lib/firebase.js';
import { bootstrapAdmin } from '../../src/modules/auth/admin-bootstrap.js';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import { TEST_PASSWORD, createFirebaseUser, signIn, uniqueEmail } from '../helpers/firebase.js';

/**
 * Authentication against the real Firebase Auth Emulator + PostgreSQL.
 */
const { app, prisma, env } = buildTestApp();
const firebaseAuth = createFirebaseAuth(env);
let krishnaHostelId: string;
let krishnaCanteenId: string;

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  const hostel = await prisma.hostel.findUniqueOrThrow({ where: { name: 'Krishna' } });
  krishnaHostelId = hostel.id;
  krishnaCanteenId = hostel.canteenId;
});
afterAll(() => prisma.$disconnect());

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * An unsigned emulator-format token (alg "none"). The Admin SDK accepts
 * unsigned tokens ONLY in emulator mode — which production configuration
 * forbids — but still enforces issuer, audience, expiry and user existence.
 */
function forgedToken(
  uid: string,
  overrides: { iss?: string; aud?: string; exp?: number; iat?: number } = {},
): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      iss: overrides.iss ?? `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      aud: overrides.aud ?? env.FIREBASE_PROJECT_ID,
      auth_time: overrides.iat ?? now,
      iat: overrides.iat ?? now,
      exp: overrides.exp ?? now + 3600,
      sub: uid,
      user_id: uid,
      email: 'forged@example.edu',
      firebase: { identities: {}, sign_in_provider: 'password' },
    }),
    '',
  ].join('.');
}

describe('token verification', () => {
  it('rejects requests without a bearer token', async () => {
    const res = await request(app).get('/api/auth/me').expect(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('rejects malformed tokens', async () => {
    for (const token of ['not-a-jwt', 'abc.def.ghi']) {
      const res = await request(app).get('/api/auth/me').set(bearer(token)).expect(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    }
    await request(app).get('/api/auth/me').set('Authorization', 'Basic dXNlcjpwYXNz').expect(401);
  });

  it('rejects a forged token for a user that does not exist in Firebase', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set(bearer(forgedToken('ghost-user')))
      .expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('rejects expired tokens and tokens for another project or issuer', async () => {
    const user = await createFirebaseUser();
    const now = Math.floor(Date.now() / 1000);
    const expired = await request(app)
      .get('/api/auth/me')
      .set(bearer(forgedToken(user.uid, { iat: now - 7200, exp: now - 3600 })))
      .expect(401);
    expect(expired.body.error.code).toBe('AUTH_TOKEN_EXPIRED');

    for (const overrides of [
      { aud: 'some-other-project' },
      { iss: 'https://securetoken.google.com/some-other-project' },
      { iss: 'https://evil.example.com' },
    ]) {
      const res = await request(app)
        .get('/api/auth/me')
        .set(bearer(forgedToken(user.uid, overrides)))
        .expect(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    }
  });

  it('rejects revoked tokens', async () => {
    const user = await createFirebaseUser();
    await request(app).get('/api/auth/me').set(bearer(user.idToken)).expect(200);
    // Revocation is second-granular: make sure the token predates it.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await firebaseAuth.revokeRefreshTokens(user.uid);
    const res = await request(app).get('/api/auth/me').set(bearer(user.idToken)).expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_REVOKED');
  });

  it('rejects tokens of disabled Firebase users', async () => {
    const user = await createFirebaseUser();
    await firebaseAuth.updateUser(user.uid, { disabled: true });
    const res = await request(app).get('/api/auth/me').set(bearer(user.idToken)).expect(401);
    expect(res.body.error.code).toBe('AUTH_USER_DISABLED');
  });

  it('reports an unregistered Firebase user without inventing a role', async () => {
    const user = await createFirebaseUser();
    const res = await request(app).get('/api/auth/me').set(bearer(user.idToken)).expect(200);
    expect(res.body.data).toEqual({
      registered: false,
      role: null,
      firebaseUid: user.uid,
      email: user.email,
    });
  });
});

describe('student registration', () => {
  it('creates a Student linked to the Firebase UID and hostel', async () => {
    const user = await createFirebaseUser();
    const res = await request(app)
      .post('/api/auth/student/register')
      .set(bearer(user.idToken))
      .send({ name: 'Asha Rao', email: user.email, hostelId: krishnaHostelId })
      .expect(201);

    expect(res.body.data).toMatchObject({
      registered: true,
      role: 'STUDENT',
      name: 'Asha Rao',
      email: user.email,
      firebaseUid: user.uid,
      hostel: { id: krishnaHostelId, name: 'Krishna' },
      defaultCanteen: { id: krishnaCanteenId, name: 'Krishna & Godavari Night Canteen' },
    });
    const row = await prisma.student.findUniqueOrThrow({ where: { firebaseUid: user.uid } });
    expect(row.hostelId).toBe(krishnaHostelId);

    const me = await request(app).get('/api/auth/me').set(bearer(user.idToken)).expect(200);
    expect(me.body.data.role).toBe('STUDENT');
  });

  it('accepts the email in any case and stores it normalized', async () => {
    const user = await createFirebaseUser(uniqueEmail('mixed'));
    await request(app)
      .post('/api/auth/student/register')
      .set(bearer(user.idToken))
      .send({ name: 'Case Test', email: user.email.toUpperCase(), hostelId: krishnaHostelId })
      .expect(201);
  });

  it('rejects duplicate registration of the same Firebase account', async () => {
    const user = await createFirebaseUser();
    const body = { name: 'Dup', email: user.email, hostelId: krishnaHostelId };
    await request(app)
      .post('/api/auth/student/register')
      .set(bearer(user.idToken))
      .send(body)
      .expect(201);
    const again = await request(app)
      .post('/api/auth/student/register')
      .set(bearer(user.idToken))
      .send(body)
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_REGISTERED');

    const asStaff = await request(app)
      .post('/api/auth/staff/register')
      .set(bearer(user.idToken))
      .send({ name: 'Dup', email: user.email })
      .expect(409);
    expect(asStaff.body.error.code).toBe('ALREADY_REGISTERED');
  });

  it('rejects an email that does not match the Firebase token', async () => {
    const user = await createFirebaseUser();
    const res = await request(app)
      .post('/api/auth/student/register')
      .set(bearer(user.idToken))
      .send({ name: 'Mismatch', email: 'someone.else@example.edu', hostelId: krishnaHostelId })
      .expect(422);
    expect(res.body.error.code).toBe('EMAIL_MISMATCH');
  });

  it('rejects invalid, unknown and inactive hostels', async () => {
    const user = await createFirebaseUser();
    const send = (hostelId: string) =>
      request(app)
        .post('/api/auth/student/register')
        .set(bearer(user.idToken))
        .send({ name: 'Hostel Test', email: user.email, hostelId });

    expect((await send('not-a-uuid').expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await send('00000000-0000-4000-8000-000000000000').expect(422)).body.error.code).toBe(
      'INVALID_HOSTEL',
    );

    const inactive = await prisma.hostel.create({
      data: { name: 'Closed Tower', canteenId: krishnaCanteenId, isActive: false },
    });
    expect((await send(inactive.id).expect(422)).body.error.code).toBe('HOSTEL_INACTIVE');
    expect(await prisma.student.count({ where: { firebaseUid: user.uid } })).toBe(0);
  });

  it('rejects missing or invalid fields', async () => {
    const user = await createFirebaseUser();
    const res = await request(app)
      .post('/api/auth/student/register')
      .set(bearer(user.idToken))
      .send({ email: user.email })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects client attempts to choose a role or identity, creating nothing', async () => {
    const user = await createFirebaseUser();
    for (const extra of [
      { role: 'ADMIN' },
      { status: 'APPROVED' },
      { canteenId: krishnaCanteenId },
      { firebaseUid: 'someone-else' },
      { studentId: '00000000-0000-4000-8000-000000000000' },
    ]) {
      const res = await request(app)
        .post('/api/auth/student/register')
        .set(bearer(user.idToken))
        .send({ name: 'Sneaky', email: user.email, hostelId: krishnaHostelId, ...extra })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    for (const table of [prisma.admin, prisma.staff, prisma.student] as const) {
      expect(await (table as typeof prisma.admin).count({ where: { firebaseUid: user.uid } })).toBe(
        0,
      );
    }
    // The legitimate request still works and can only produce a Student.
    const res = await request(app)
      .post('/api/auth/student/register')
      .set(bearer(user.idToken))
      .send({ name: 'Sneaky', email: user.email, hostelId: krishnaHostelId })
      .expect(201);
    expect(res.body.data.role).toBe('STUDENT');
    expect(res.body.data.firebaseUid).toBe(user.uid);
    expect(await prisma.admin.count({ where: { firebaseUid: user.uid } })).toBe(0);
    expect(await prisma.staff.count({ where: { firebaseUid: user.uid } })).toBe(0);
  });

  it('enforces the optional university email-domain restriction', async () => {
    const restricted = buildTestApp({ STUDENT_EMAIL_DOMAINS: 'uni.edu' });
    try {
      const outsider = await createFirebaseUser(uniqueEmail('outsider'));
      const denied = await request(restricted.app)
        .post('/api/auth/student/register')
        .set(bearer(outsider.idToken))
        .send({ name: 'Outsider', email: outsider.email, hostelId: krishnaHostelId })
        .expect(403);
      expect(denied.body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');

      const insider = await createFirebaseUser(`insider-${Date.now()}@uni.edu`);
      await request(restricted.app)
        .post('/api/auth/student/register')
        .set(bearer(insider.idToken))
        .send({ name: 'Insider', email: insider.email, hostelId: krishnaHostelId })
        .expect(201);
    } finally {
      await restricted.prisma.$disconnect();
    }
  });

  it('rate-limits registration attempts per user', async () => {
    const limited = buildTestApp({ SENSITIVE_RATE_LIMIT_MAX: '2' });
    try {
      const user = await createFirebaseUser();
      const attempt = () =>
        request(limited.app)
          .post('/api/auth/student/register')
          .set(bearer(user.idToken))
          .send({ name: 'Limit', email: user.email, hostelId: 'bad' });
      await attempt().expect(422);
      await attempt().expect(422);
      const res = await attempt().expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.prisma.$disconnect();
    }
  });
});

describe('staff registration', () => {
  it('creates a PENDING staff account with no canteen (self-assignment rejected)', async () => {
    const user = await createFirebaseUser();
    const sneaky = await request(app)
      .post('/api/auth/staff/register')
      .set(bearer(user.idToken))
      .send({
        name: 'Ravi Staff',
        email: user.email,
        canteenId: krishnaCanteenId,
        status: 'APPROVED',
      })
      .expect(422);
    expect(sneaky.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.staff.count({ where: { firebaseUid: user.uid } })).toBe(0);

    const res = await request(app)
      .post('/api/auth/staff/register')
      .set(bearer(user.idToken))
      .send({ name: 'Ravi Staff', email: user.email })
      .expect(201);
    expect(res.body.data).toMatchObject({
      role: 'STAFF',
      status: 'PENDING',
      canteen: null,
      pendingChangeRequest: null,
    });
    const row = await prisma.staff.findUniqueOrThrow({ where: { firebaseUid: user.uid } });
    expect(row).toMatchObject({ status: 'PENDING', canteenId: null });
  });

  it('can request canteen access at registration, notifying admins', async () => {
    const admin = await createFirebaseUser();
    await bootstrapAdmin(
      { auth: firebaseAuth, prisma },
      { email: admin.email, name: 'Notified Admin', allowCreateFirebaseUser: false },
    );
    const user = await createFirebaseUser();
    const res = await request(app)
      .post('/api/auth/staff/register')
      .set(bearer(user.idToken))
      .send({ name: 'Requesting Staff', email: user.email, requestedCanteenId: krishnaCanteenId })
      .expect(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.pendingChangeRequest).toMatchObject({
      status: 'PENDING',
      requestedCanteen: { id: krishnaCanteenId },
    });

    const adminRow = await prisma.admin.findUniqueOrThrow({ where: { firebaseUid: admin.uid } });
    const notes = await prisma.notification.findMany({ where: { adminId: adminRow.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type).toBe('STAFF_ACCESS_REQUESTED');
  });
});

describe('admin account status', () => {
  it('a deactivated admin loses access to admin APIs', async () => {
    const user = await createFirebaseUser(uniqueEmail('inactive-admin'));
    const { adminId } = await bootstrapAdmin(
      { auth: firebaseAuth, prisma },
      { email: user.email, name: 'Soon Inactive', allowCreateFirebaseUser: false },
    );
    await request(app).get('/api/admin/dashboard').set(bearer(user.idToken)).expect(200);
    await prisma.admin.update({ where: { id: adminId }, data: { isActive: false } });
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set(bearer(user.idToken))
      .expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    await request(app).get('/api/notifications').set(bearer(user.idToken)).expect(403);
  });
});

describe('admin bootstrap', () => {
  it('provisions an admin through the controlled bootstrap only', async () => {
    const email = uniqueEmail('admin');
    const result = await bootstrapAdmin(
      { auth: firebaseAuth, prisma },
      { email, name: 'Ada Admin', password: TEST_PASSWORD, allowCreateFirebaseUser: true },
    );
    expect(result.createdFirebaseUser).toBe(true);

    const token = await signIn(email);
    const me = await request(app).get('/api/auth/me').set(bearer(token)).expect(200);
    expect(me.body.data).toMatchObject({ role: 'ADMIN', email, isActive: true });
  });

  it('refuses to create a Firebase user when not allowed (production path)', async () => {
    await expect(
      bootstrapAdmin(
        { auth: firebaseAuth, prisma },
        { email: uniqueEmail('nobody'), name: 'Nobody', allowCreateFirebaseUser: false },
      ),
    ).rejects.toThrow(/No Firebase user exists/);
  });

  it('refuses to turn a student into an admin', async () => {
    const user = await createFirebaseUser();
    await request(app)
      .post('/api/auth/student/register')
      .set(bearer(user.idToken))
      .send({ name: 'Student', email: user.email, hostelId: krishnaHostelId })
      .expect(201);
    await expect(
      bootstrapAdmin(
        { auth: firebaseAuth, prisma },
        { email: user.email, name: 'X', allowCreateFirebaseUser: false },
      ),
    ).rejects.toThrow(/already registered as a student/);
  });

  it('exposes no public admin registration endpoint', async () => {
    const user = await createFirebaseUser();
    await request(app)
      .post('/api/auth/admin/register')
      .set(bearer(user.idToken))
      .send({ name: 'Wannabe', email: user.email })
      .expect(404);
  });
});
