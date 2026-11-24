import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapAdmin } from '../../src/modules/auth/admin-bootstrap.js';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { createHostelRecord, truncateAll } from '../helpers/db.js';
import { canteenBySlug } from '../helpers/actors.js';
import { hashNewPassword, setAccountPassword } from '../../src/modules/auth/password-accounts.js';
import {
  TEST_PASSWORD,
  createTestUser,
  passwordSignIn,
  passwordSignInRequest,
  testSignIn,
  uniqueEmail,
  uniquePersonalEmail,
  storedToken,
} from '../helpers/identity.js';

/**
 * Better Auth sessions + PostgreSQL accounts. Student identities come from the
 * real Better Auth instance (test-only sign-in, same SRM gate as Google; the
 * Google redirect flow itself is covered in google-oauth.test.ts); staff and
 * admins use the real email + password sign-in. Role/method enforcement is
 * covered in depth in role-sign-in.test.ts.
 */
const { app, prisma } = buildTestApp();
const APP = 'http://localhost:5173';
let krishnaHostelId: string;
let krishnaCanteenId: string;

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  const hostel = await prisma.hostel.findUniqueOrThrow({ where: { name: 'Krishna' } });
  krishnaHostelId = hostel.id;
  krishnaCanteenId = (await canteenBySlug(prisma, 'krishna-godavari')).id;
});
afterAll(() => prisma.$disconnect());

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const registerStudent = (token: string, body: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/auth/student/register')
    .set(bearer(token))
    .send({ name: 'Test Student', hostelId: krishnaHostelId, ...body });

describe('SRM sign-in rule (same gate as Google)', () => {
  it('accepts a verified @srmap.edu.in address and stores it lower-cased', async () => {
    const email = uniqueEmail('Mixed.Case').toUpperCase();
    const user = await createTestUser(email);
    expect(user.email).toBe(email.toLowerCase());
    expect(await prisma.authUser.findUniqueOrThrow({ where: { id: user.uid } })).toMatchObject({
      email: email.toLowerCase(),
      emailVerified: true,
    });
  });

  it.each([
    'student@gmail.com',
    'student@yahoo.com',
    'student@srmap.edu.in.attacker.com',
    'student@fake-srmap.edu.in',
    'student@mail.srmap.edu.in',
    'student@srmap.edu',
    '"a@b"@srmap.edu.in',
    'stu dent@srmap.edu.in',
    'student@srmаp.edu.in', // Cyrillic "а"
  ])('rejects %s and creates no identity', async (email) => {
    const res = await testSignIn(email);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    expect(await prisma.authUser.count({ where: { email: email.toLowerCase() } })).toBe(0);
  });

  it('rejects an address the provider has not verified', async () => {
    const email = uniqueEmail('unverified');
    const res = await testSignIn(email, { emailVerified: false });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('EMAIL_NOT_VERIFIED');
    expect(await prisma.authUser.count({ where: { email } })).toBe(0);
  });

  it('the database itself refuses malformed or mixed-case identity addresses', async () => {
    for (const email of ['X@srmap.edu.in', 'not-an-email', 'a b@srmap.edu.in']) {
      await expect(
        prisma.authUser.create({
          data: { id: `direct-${email}`, name: 'X', email, emailVerified: false },
        }),
      ).rejects.toThrow();
    }
  });
});

describe('sessions', () => {
  it('rejects requests without a session', async () => {
    const res = await request(app).get('/api/auth/me').expect(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('rejects malformed, random and forged tokens', async () => {
    const user = await createTestUser();
    for (const token of [
      'not-a-token',
      'abc.def',
      `${user.token}x`,
      `${user.token}.forged-signature`,
    ]) {
      const res = await request(app).get('/api/auth/me').set(bearer(token)).expect(401);
      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    }
    await request(app).get('/api/auth/me').set('Authorization', 'Basic dXNlcjpwYXNz').expect(401);
    await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'serve.session_token=forged.value')
      .expect(401);
  });

  it('a session persists across requests and app restarts', async () => {
    const user = await createTestUser();
    await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    const restarted = buildTestApp();
    try {
      await request(restarted.app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    } finally {
      await restarted.prisma.$disconnect();
    }
  });

  it('the HttpOnly cookie from sign-in authenticates the web apps', async () => {
    const email = uniqueEmail('cookie');
    const agent = request.agent(app);
    const signIn = await agent.post('/api/auth/test/sign-in').set('Origin', APP).send({ email });
    expect(signIn.status).toBe(200);
    expect(String(signIn.headers['set-cookie'])).toMatch(/serve\.session_token=.*HttpOnly/i);
    const me = await agent.get('/api/auth/me').set('Origin', APP).expect(200);
    expect(me.body.data.email).toBe(email);
  });

  it('expired and deleted sessions are rejected', async () => {
    const expired = await createTestUser();
    await prisma.authSession.updateMany({
      where: { token: storedToken(expired) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app).get('/api/auth/me').set(bearer(expired.token)).expect(401);

    const revoked = await createTestUser();
    await request(app).get('/api/auth/me').set(bearer(revoked.token)).expect(200);
    await prisma.authSession.deleteMany({ where: { token: storedToken(revoked) } });
    await request(app).get('/api/auth/me').set(bearer(revoked.token)).expect(401);
  });

  it('sign-out ends the session (Bearer)', async () => {
    const user = await createTestUser();
    await request(app).post('/api/auth/sign-out').set(bearer(user.token)).send({}).expect(200);
    await request(app).get('/api/auth/me').set(bearer(user.token)).expect(401);
  });

  it('a session of an identity that no longer qualifies is refused', async () => {
    const user = await createTestUser();
    // Simulates a stored row that bypassed the gate (defence in depth).
    await prisma.authUser.update({ where: { id: user.uid }, data: { emailVerified: false } });
    await request(app).get('/api/auth/me').set(bearer(user.token)).expect(401);
  });

  it('reports an unregistered identity without inventing a role', async () => {
    const user = await createTestUser();
    const res = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    expect(res.body.data).toEqual({
      registered: false,
      role: null,
      authUserId: user.uid,
      email: user.email,
    });
  });
});

describe('CSRF protection for cookie sessions', () => {
  it('refuses a cookie-authenticated write from an unknown or missing origin', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/test/sign-in')
      .set('Origin', APP)
      .send({ email: uniqueEmail('csrf') });
    const body = { name: 'Csrf', hostelId: krishnaHostelId };
    const evil = await agent
      .post('/api/auth/student/register')
      .set('Origin', 'https://evil.example.com')
      .send(body)
      .expect(403);
    expect(evil.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    const none = await agent.post('/api/auth/student/register').send(body).expect(403);
    expect(none.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    // From a SERVE app it works.
    await agent.post('/api/auth/student/register').set('Origin', APP).send(body).expect(201);
  });

  it('CORS allows credentials only for SERVE app origins', async () => {
    const ok = await request(app)
      .options('/api/auth/me')
      .set('Origin', APP)
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(APP);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app)
      .options('/api/auth/me')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('student registration', () => {
  it('creates a Student linked to the signed-in identity and hostel', async () => {
    const user = await createTestUser();
    const res = await registerStudent(user.token, { name: 'Asha Rao' }).expect(201);
    expect(res.body.data).toMatchObject({
      registered: true,
      role: 'STUDENT',
      name: 'Asha Rao',
      email: user.email,
      authUserId: user.uid,
      hostel: { id: krishnaHostelId, name: 'Krishna' },
      defaultCanteen: { id: krishnaCanteenId, name: 'Krishna & Godavari Night Canteen' },
    });
    const row = await prisma.student.findUniqueOrThrow({ where: { authUserId: user.uid } });
    expect(row).toMatchObject({ hostelId: krishnaHostelId, email: user.email, firebaseUid: null });
    const me = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    expect(me.body.data.role).toBe('STUDENT');
  });

  it('takes the email from the session; a body may only repeat it', async () => {
    const user = await createTestUser();
    await registerStudent(user.token, { email: user.email.toUpperCase() }).expect(201);
    const other = await createTestUser();
    const res = await registerStudent(other.token, { email: uniqueEmail('someone-else') }).expect(
      422,
    );
    expect(res.body.error.code).toBe('EMAIL_MISMATCH');
  });

  it('rejects duplicate registration of the same identity', async () => {
    const user = await createTestUser();
    await registerStudent(user.token).expect(201);
    expect((await registerStudent(user.token).expect(409)).body.error.code).toBe(
      'ALREADY_REGISTERED',
    );
    // The old Google-based staff registration no longer exists…
    await request(app)
      .post('/api/auth/staff/register')
      .set(bearer(user.token))
      .send({ name: 'Dup' })
      .expect(404);
    // …and a student's address cannot also become a staff account.
    const asStaff = await request(app)
      .post('/api/auth/staff/sign-up')
      .send({ name: 'Dup', email: user.email, password: TEST_PASSWORD })
      .expect(409);
    expect(asStaff.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('rejects invalid, unknown and inactive hostels', async () => {
    const user = await createTestUser();
    const send = (hostelId: string) => registerStudent(user.token, { hostelId });
    expect((await send('not-a-uuid').expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await send('00000000-0000-4000-8000-000000000000').expect(422)).body.error.code).toBe(
      'INVALID_HOSTEL',
    );
    const inactive = await createHostelRecord(prisma, {
      name: 'Closed Tower',
      canteenId: krishnaCanteenId,
      isActive: false,
    });
    expect((await send(inactive.id).expect(422)).body.error.code).toBe('HOSTEL_INACTIVE');
    expect(await prisma.student.count({ where: { authUserId: user.uid } })).toBe(0);
  });

  it('rejects client attempts to choose a role or identity, creating nothing', async () => {
    const user = await createTestUser();
    for (const extra of [
      { role: 'ADMIN' },
      { status: 'APPROVED' },
      { canteenId: krishnaCanteenId },
      { authUserId: 'someone-else' },
      { firebaseUid: 'someone-else' },
      { studentId: '00000000-0000-4000-8000-000000000000' },
    ]) {
      const res = await registerStudent(user.token, extra).expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    for (const table of [prisma.admin, prisma.staff, prisma.student] as const) {
      expect(await (table as typeof prisma.admin).count({ where: { authUserId: user.uid } })).toBe(
        0,
      );
    }
    const res = await registerStudent(user.token).expect(201);
    expect(res.body.data.role).toBe('STUDENT');
    expect(await prisma.admin.count({ where: { authUserId: user.uid } })).toBe(0);
    expect(await prisma.staff.count({ where: { authUserId: user.uid } })).toBe(0);
  });

  it('rate-limits registration attempts per user', async () => {
    const limited = buildTestApp({ SENSITIVE_RATE_LIMIT_MAX: '2' });
    try {
      const user = await createTestUser();
      const attempt = () =>
        request(limited.app)
          .post('/api/auth/student/register')
          .set(bearer(user.token))
          .send({ name: 'Limit', hostelId: 'bad' });
      await attempt().expect(422);
      await attempt().expect(422);
      expect((await attempt().expect(429)).body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.prisma.$disconnect();
    }
  });
});

const staffSignUp = (body: Record<string, unknown>) =>
  request(app).post('/api/auth/staff/sign-up').send(body);

describe('staff registration (email + password)', () => {
  it('creates a PENDING staff account with no canteen (self-assignment rejected)', async () => {
    const email = uniquePersonalEmail('ravi');
    const sneaky = await staffSignUp({
      name: 'Ravi Staff',
      email,
      password: TEST_PASSWORD,
      canteenId: krishnaCanteenId,
      status: 'APPROVED',
    }).expect(422);
    expect(sneaky.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.staff.count({ where: { email } })).toBe(0);

    const res = await staffSignUp({ name: 'Ravi Staff', email, password: TEST_PASSWORD }).expect(
      201,
    );
    expect(res.body.data).toEqual({ email, status: 'PENDING' });
    const user = await passwordSignIn(email);
    const me = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    expect(me.body.data).toMatchObject({
      role: 'STAFF',
      status: 'PENDING',
      canteen: null,
      pendingChangeRequest: null,
    });
    expect(await prisma.staff.findUniqueOrThrow({ where: { email } })).toMatchObject({
      status: 'PENDING',
      canteenId: null,
      authUserId: user.uid,
    });
  });

  it('can request canteen access at registration, notifying admins', async () => {
    const adminEmail = uniqueEmail('notified-admin');
    const { adminId } = await bootstrapAdmin(
      { prisma },
      { email: adminEmail, name: 'Notified Admin' },
    );
    const email = uniquePersonalEmail('requesting');
    await staffSignUp({
      name: 'Requesting Staff',
      email,
      password: TEST_PASSWORD,
      requestedCanteenId: krishnaCanteenId,
    }).expect(201);
    const user = await passwordSignIn(email);
    const me = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    expect(me.body.data.pendingChangeRequest).toMatchObject({
      status: 'PENDING',
      requestedCanteen: { id: krishnaCanteenId },
    });
    const notes = await prisma.notification.findMany({ where: { adminId } });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type).toBe('STAFF_ACCESS_REQUESTED');
  });
});

describe('admin provisioning', () => {
  it('an admin exists only by provisioning, and signs in with its password', async () => {
    const email = uniqueEmail('admin');
    const result = await bootstrapAdmin({ prisma }, { email, name: 'Ada Admin' });
    expect(result).toMatchObject({ created: true, linked: false });
    // Provisioned but no password yet: nobody can sign in as this admin.
    expect((await passwordSignInRequest(email, TEST_PASSWORD)).status).toBe(401);
    await setAccountPassword(prisma, {
      role: 'ADMIN',
      email,
      passwordHash: await hashNewPassword(TEST_PASSWORD),
    });
    const user = await passwordSignIn(email);
    const me = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    expect(me.body.data).toMatchObject({
      role: 'ADMIN',
      email,
      isActive: true,
      authUserId: user.uid,
    });
    await request(app).get('/api/admin/dashboard').set(bearer(user.token)).expect(200);
    expect((await prisma.admin.findUniqueOrThrow({ where: { email } })).authUserId).toBe(user.uid);
  });

  it('an ordinary SRM Google user never becomes an admin', async () => {
    const user = await createTestUser();
    const me = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    expect(me.body.data.registered).toBe(false);
    const res = await request(app).get('/api/admin/dashboard').set(bearer(user.token)).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_REGISTERED');
    await request(app)
      .post('/api/auth/admin/register')
      .set(bearer(user.token))
      .send({ name: 'Wannabe' })
      .expect(404);
  });

  it('refuses non-SRM admin addresses and existing students', async () => {
    await expect(
      bootstrapAdmin({ prisma }, { email: 'boss@gmail.com', name: 'Boss' }),
    ).rejects.toThrow(/@srmap\.edu\.in/);
    const student = await createTestUser();
    await registerStudent(student.token).expect(201);
    await expect(bootstrapAdmin({ prisma }, { email: student.email, name: 'X' })).rejects.toThrow(
      /already registered as a student/,
    );
  });

  it('a deactivated admin loses access to admin APIs', async () => {
    const email = uniqueEmail('inactive-admin');
    const { adminId } = await bootstrapAdmin({ prisma }, { email, name: 'Soon Inactive' });
    await setAccountPassword(prisma, {
      role: 'ADMIN',
      email,
      passwordHash: await hashNewPassword(TEST_PASSWORD),
    });
    const user = await passwordSignIn(email);
    await request(app).get('/api/admin/dashboard').set(bearer(user.token)).expect(200);
    await prisma.admin.update({ where: { id: adminId }, data: { isActive: false } });
    const res = await request(app).get('/api/admin/dashboard').set(bearer(user.token)).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    await request(app).get('/api/notifications').set(bearer(user.token)).expect(403);
  });
});

describe('existing accounts', () => {
  it('an existing approved staff account moves to a password, keeping approval, canteen and capabilities', async () => {
    const email = uniqueEmail('legacy-staff');
    const canteen = await canteenBySlug(prisma, 'yamuna-narmada');
    // As created before Better Auth: a Firebase UID, no sign-in identity.
    const staff = await prisma.staff.create({
      data: {
        firebaseUid: `legacy-${email}`,
        email,
        name: 'Legacy Staff',
        status: 'APPROVED',
        canteenId: canteen.id,
      },
    });
    const assignment = await prisma.staffCanteenAssignment.create({
      data: {
        staffId: staff.id,
        canteenId: canteen.id,
        capabilities: { create: [{ capability: 'KITCHEN' }, { capability: 'CASHIER' }] },
      },
    });
    // Google can no longer sign this address in…
    const google = await testSignIn(email);
    expect(google.status).toBe(403);
    expect(((await google.json()) as { code?: string }).code).toBe('STAFF_ADMIN_USE_PASSWORD');
    // …an operator sets a password (scripts/set-password.ts) and it signs in with that.
    await setAccountPassword(prisma, {
      role: 'STAFF',
      email,
      passwordHash: await hashNewPassword(TEST_PASSWORD),
    });
    const user = await passwordSignIn(email);
    const me = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    expect(me.body.data).toMatchObject({
      role: 'STAFF',
      status: 'APPROVED',
      canteen: { id: canteen.id },
    });
    expect([...me.body.data.assignments[0].capabilities].sort()).toEqual(['CASHIER', 'KITCHEN']);
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(row).toMatchObject({
      authUserId: user.uid,
      firebaseUid: `legacy-${email}`,
      status: 'APPROVED',
      canteenId: canteen.id,
    });
    expect(
      await prisma.staffAssignmentCapability.count({ where: { assignmentId: assignment.id } }),
    ).toBe(2);
  });

  it('an existing student account is linked at its first Google sign-in', async () => {
    const email = uniqueEmail('legacy-student');
    const student = await prisma.student.create({
      data: { email, name: 'Legacy Student', hostelId: krishnaHostelId },
    });
    const user = await createTestUser(email);
    const me = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    expect(me.body.data).toMatchObject({ role: 'STUDENT', id: student.id });
  });

  it('a staff or admin address is never claimed by a Google sign-in', async () => {
    const email = uniqueEmail('unclaimed-admin');
    await prisma.admin.create({ data: { email, name: 'Unclaimed Admin' } });
    const res = await testSignIn(email);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe('STAFF_ADMIN_USE_PASSWORD');
    expect((await prisma.admin.findUniqueOrThrow({ where: { email } })).authUserId).toBeNull();
    expect(await prisma.authSession.count({ where: { user: { email } } })).toBe(0);
  });

  it('an account already linked to another identity is not taken over', async () => {
    const owner = await createTestUser();
    await registerStudent(owner.token).expect(201);
    // Simulate a mismatch (e.g. the owner's address changed elsewhere).
    const newEmail = uniqueEmail('taken');
    await prisma.student.update({ where: { authUserId: owner.uid }, data: { email: newEmail } });
    const other = await createTestUser(newEmail);
    const res = await request(app).get('/api/auth/me').set(bearer(other.token)).expect(409);
    expect(res.body.error.code).toBe('ACCOUNT_LINK_CONFLICT');
    expect(
      (await prisma.student.findUniqueOrThrow({ where: { email: newEmail } })).authUserId,
    ).toBe(owner.uid);
  });

  it('concurrent first requests link exactly once', async () => {
    const email = uniqueEmail('race');
    await prisma.student.create({ data: { email, name: 'Race', hostelId: krishnaHostelId } });
    const user = await createTestUser(email);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => request(app).get('/api/auth/me').set(bearer(user.token))),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
  });

  it('one identity can never hold two accounts (database trigger)', async () => {
    const user = await createTestUser();
    await registerStudent(user.token).expect(201);
    const staff = await prisma.staff.create({
      data: { email: uniqueEmail('other'), name: 'Other' },
    });
    await expect(
      prisma.staff.update({ where: { id: staff.id }, data: { authUserId: user.uid } }),
    ).rejects.toThrow(/AuthUser_single_role_account/);
  });
});
