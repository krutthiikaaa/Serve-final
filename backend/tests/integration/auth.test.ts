import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapAdmin } from '../../src/modules/auth/admin-bootstrap.js';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { createHostelRecord, truncateAll } from '../helpers/db.js';
import { canteenBySlug } from '../helpers/actors.js';
import { createTestUser, testSignIn, uniqueEmail } from '../helpers/identity.js';

/**
 * Better Auth sessions + PostgreSQL accounts. Identities come from the real
 * Better Auth instance (test-only sign-in, same SRM gate as Google; the
 * Google redirect flow itself is covered in google-oauth.test.ts).
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

  it('the database itself refuses a non-SRM identity', async () => {
    await expect(
      prisma.authUser.create({
        data: { id: 'direct-insert', name: 'X', email: 'x@gmail.com', emailVerified: true },
      }),
    ).rejects.toThrow();
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
      where: { token: expired.token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app).get('/api/auth/me').set(bearer(expired.token)).expect(401);

    const revoked = await createTestUser();
    await request(app).get('/api/auth/me').set(bearer(revoked.token)).expect(200);
    await prisma.authSession.deleteMany({ where: { token: revoked.token } });
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
    const asStaff = await request(app)
      .post('/api/auth/staff/register')
      .set(bearer(user.token))
      .send({ name: 'Dup' })
      .expect(409);
    expect(asStaff.body.error.code).toBe('ALREADY_REGISTERED');
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

describe('staff registration', () => {
  it('creates a PENDING staff account with no canteen (self-assignment rejected)', async () => {
    const user = await createTestUser();
    const sneaky = await request(app)
      .post('/api/auth/staff/register')
      .set(bearer(user.token))
      .send({ name: 'Ravi Staff', canteenId: krishnaCanteenId, status: 'APPROVED' })
      .expect(422);
    expect(sneaky.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.staff.count({ where: { authUserId: user.uid } })).toBe(0);

    const res = await request(app)
      .post('/api/auth/staff/register')
      .set(bearer(user.token))
      .send({ name: 'Ravi Staff' })
      .expect(201);
    expect(res.body.data).toMatchObject({
      role: 'STAFF',
      status: 'PENDING',
      canteen: null,
      pendingChangeRequest: null,
    });
    expect(await prisma.staff.findUniqueOrThrow({ where: { authUserId: user.uid } })).toMatchObject(
      {
        status: 'PENDING',
        canteenId: null,
      },
    );
  });

  it('can request canteen access at registration, notifying admins', async () => {
    const adminEmail = uniqueEmail('notified-admin');
    const { adminId } = await bootstrapAdmin(
      { prisma },
      { email: adminEmail, name: 'Notified Admin' },
    );
    const user = await createTestUser();
    const res = await request(app)
      .post('/api/auth/staff/register')
      .set(bearer(user.token))
      .send({ name: 'Requesting Staff', requestedCanteenId: krishnaCanteenId })
      .expect(201);
    expect(res.body.data.pendingChangeRequest).toMatchObject({
      status: 'PENDING',
      requestedCanteen: { id: krishnaCanteenId },
    });
    const notes = await prisma.notification.findMany({ where: { adminId } });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type).toBe('STAFF_ACCESS_REQUESTED');
  });
});

describe('admin provisioning', () => {
  it('an admin exists only by provisioning, and becomes active at its first SRM sign-in', async () => {
    const email = uniqueEmail('admin');
    const result = await bootstrapAdmin({ prisma }, { email, name: 'Ada Admin' });
    expect(result).toMatchObject({ created: true, linked: false });
    const user = await createTestUser(email);
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
    const user = await createTestUser(email);
    await request(app).get('/api/admin/dashboard').set(bearer(user.token)).expect(200);
    await prisma.admin.update({ where: { id: adminId }, data: { isActive: false } });
    const res = await request(app).get('/api/admin/dashboard').set(bearer(user.token)).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    await request(app).get('/api/notifications').set(bearer(user.token)).expect(403);
  });
});

describe('linking existing accounts at the first sign-in', () => {
  it('an existing approved staff account keeps its approval, canteen and capabilities', async () => {
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
    const user = await createTestUser(email);
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

  it('an email shared by two accounts is never guessed: 409, nothing linked', async () => {
    const email = uniqueEmail('duplicate');
    await prisma.admin.create({ data: { email, name: 'Dup Admin' } });
    await prisma.student.create({
      data: { email, name: 'Dup Student', hostelId: krishnaHostelId },
    });
    const user = await createTestUser(email);
    const res = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(409);
    expect(res.body.error.code).toBe('ACCOUNT_LINK_CONFLICT');
    expect(await prisma.admin.count({ where: { authUserId: user.uid } })).toBe(0);
    expect(await prisma.student.count({ where: { authUserId: user.uid } })).toBe(0);
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
