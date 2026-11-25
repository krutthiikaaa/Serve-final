import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { SESSION_EXPIRES_IN_SECONDS } from '../../src/lib/auth.js';
import { hashNewPassword, setAccountPassword } from '../../src/modules/auth/password-accounts.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  newAdmin,
  newApprovedStaff,
  newPendingStaff,
  newStudent,
} from '../helpers/actors.js';
import {
  TEST_PASSWORD,
  createTestUser,
  passwordSignIn,
  passwordSignInRequest,
  storedToken,
  uniqueEmail,
  uniquePersonalEmail,
} from '../helpers/identity.js';
import { startTestServer, type TestServer } from '../helpers/realtime.js';

/**
 * Role-specific sign-in methods, enforced by the backend:
 *   students → Google only; staff and admins → email + password only.
 * Checked when a session is created, on every REST request and on every
 * Socket.IO handshake. Students sign in through the Google stand-in
 * (test-only endpoint, recorded as a Google session); the real Google
 * redirect flow is in google-oauth.test.ts.
 */
const { app, prisma } = buildTestApp();
const APP = 'http://localhost:5173';
let server: TestServer;
let kgId: string;

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kgId = (await canteenBySlug(prisma, 'krishna-godavari')).id;
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

const signUp = (body: Record<string, unknown>) =>
  request(app).post('/api/auth/staff/sign-up').send(body);
const signIn = (email: string, password: string) =>
  request(app).post('/api/auth/sign-in/email').set('Origin', APP).send({ email, password });
const sessionOf = (token: string) =>
  prisma.authSession.findUniqueOrThrow({ where: { token: storedToken({ token }) } });

describe('staff sign-up (email + password, always PENDING)', () => {
  it('accepts a personal address, stores only a hash and never marks the address verified', async () => {
    const email = uniquePersonalEmail('gmail-staff').replace('@example.com', '@gmail.com');
    const res = await signUp({ name: 'Gmail Staff', email, password: TEST_PASSWORD }).expect(201);
    expect(res.body.data).toEqual({ email, status: 'PENDING' });
    // No session is created by sign-up.
    expect(res.headers['set-cookie']).toBeUndefined();

    const identity = await prisma.authUser.findUniqueOrThrow({
      where: { email },
      include: { accounts: true, staff: true, sessions: true },
    });
    expect(identity.emailVerified).toBe(false);
    expect(identity.sessions).toHaveLength(0);
    expect(identity.staff).toMatchObject({ status: 'PENDING', canteenId: null, email });
    expect(identity.accounts).toHaveLength(1);
    const [account] = identity.accounts;
    expect(account).toMatchObject({ providerId: 'credential', accountId: identity.id });
    expect(account!.password).not.toContain(TEST_PASSWORD);
    expect(account!.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/); // scrypt salt:key
  });

  it('normalises the address and refuses duplicates of any account', async () => {
    const email = uniquePersonalEmail('dup');
    await signUp({ name: 'First', email: email.toUpperCase(), password: TEST_PASSWORD }).expect(
      201,
    );
    expect(await prisma.staff.count({ where: { email } })).toBe(1);
    const again = await signUp({ name: 'Second', email, password: TEST_PASSWORD }).expect(409);
    expect(again.body.error.code).toBe('EMAIL_IN_USE');

    const student = await newStudent(app, prisma);
    const taken = await signUp({
      name: 'Student Too',
      email: student.email,
      password: TEST_PASSWORD,
    }).expect(409);
    expect(taken.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('validates the password, the address and the requested canteen', async () => {
    const email = uniquePersonalEmail('weak');
    const weak = await signUp({ name: 'Weak', email, password: 'short' }).expect(422);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    await signUp({ name: 'Long', email, password: 'x'.repeat(129) }).expect(422);
    await signUp({ name: 'Bad', email: 'not-an-email', password: TEST_PASSWORD }).expect(422);
    await signUp({
      name: 'Nowhere',
      email,
      password: TEST_PASSWORD,
      requestedCanteenId: '00000000-0000-4000-8000-000000000000',
    }).expect(404);
    expect(await prisma.authUser.count({ where: { email } })).toBe(0);
  });

  it('cannot choose a role, status or canteen', async () => {
    const email = uniquePersonalEmail('sneaky');
    for (const extra of [{ role: 'ADMIN' }, { status: 'APPROVED' }, { canteenId: kgId }]) {
      await signUp({ name: 'Sneaky', email, password: TEST_PASSWORD, ...extra }).expect(422);
    }
    expect(await prisma.authUser.count({ where: { email } })).toBe(0);
  });

  it('is rate-limited per client', async () => {
    const limited = buildTestApp({ SENSITIVE_RATE_LIMIT_MAX: '2' });
    try {
      const attempt = () =>
        request(limited.app)
          .post('/api/auth/staff/sign-up')
          .send({ name: 'Limit', email: 'bad', password: TEST_PASSWORD });
      await attempt().expect(422);
      await attempt().expect(422);
      expect((await attempt().expect(429)).body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.prisma.$disconnect();
    }
  });
});

describe('staff and admin password sign-in', () => {
  it('a pending staff member signs in with a password session and sees the pending status', async () => {
    const email = uniquePersonalEmail('pending');
    await signUp({ name: 'Pending', email, password: TEST_PASSWORD, requestedCanteenId: kgId });
    const res = await signIn(email, TEST_PASSWORD).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('serve.session_token='),
    );
    expect(cookie).toMatch(/HttpOnly/i);
    // The credential is never handed to page scripts in a header.
    expect(res.headers['set-auth-token']).toBeUndefined();

    const user = await passwordSignIn(email);
    expect((await sessionOf(user.token)).authMethod).toBe('password');
    const me = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    expect(me.body.data).toMatchObject({ role: 'STAFF', status: 'PENDING', canteen: null });
    const blocked = await request(app).get('/api/staff/orders').set(bearer(user.token)).expect(403);
    expect(blocked.body.error.code).toBe('STAFF_NOT_APPROVED');
  });

  it('a wrong password and an unknown address get the same answer', async () => {
    const email = uniquePersonalEmail('wrong');
    await signUp({ name: 'Wrong', email, password: TEST_PASSWORD }).expect(201);
    const wrong = await signIn(email, 'not-the-password').expect(401);
    const unknown = await signIn(uniquePersonalEmail('ghost'), TEST_PASSWORD).expect(401);
    expect(wrong.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    expect(unknown.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('approval keeps working, with the canteen and capabilities the admin assigned', async () => {
    const admin = await newAdmin(prisma);
    const staff = await newApprovedStaff(app, admin, kgId);
    const me = await request(app).get('/api/auth/me').set(bearer(staff.token)).expect(200);
    expect(me.body.data).toMatchObject({
      role: 'STAFF',
      status: 'APPROVED',
      canteen: { id: kgId },
    });
    await request(app).get('/api/staff/dashboard').set(bearer(staff.token)).expect(200);
    // Staff cannot use admin or student routes.
    await request(app).get('/api/admin/dashboard').set(bearer(staff.token)).expect(403);
    await request(app).get('/api/orders').set(bearer(staff.token)).expect(403);
  });

  it('admins sign in with a password; students cannot use the password sign-in', async () => {
    const admin = await newAdmin(prisma);
    expect((await sessionOf(admin.token)).authMethod).toBe('password');
    await request(app).get('/api/admin/dashboard').set(bearer(admin.token)).expect(200);
    // Google (the test stand-in) refuses the admin's address with the useful reason.
    await expect(createTestUser(admin.email)).rejects.toThrow(/STAFF_ADMIN_USE_PASSWORD/);

    const student = await newStudent(app, prisma);
    expect((await sessionOf(student.token)).authMethod).toBe('google');
    const res = await signIn(student.email, TEST_PASSWORD).expect(401);
    expect(res.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });

  it('admins may use any address (e.g. a personal one), still password-only', async () => {
    const email = uniquePersonalEmail('admin');
    await prisma.admin.create({ data: { email, name: 'Personal Admin' } });
    // No password yet: nobody can sign in as this admin.
    expect((await passwordSignInRequest(email, TEST_PASSWORD)).status).toBe(401);
    await setAccountPassword(prisma, {
      role: 'ADMIN',
      email,
      passwordHash: await hashNewPassword(TEST_PASSWORD),
    });
    const admin = await passwordSignIn(email);
    expect((await sessionOf(admin.token)).authMethod).toBe('password');
    const me = await request(app).get('/api/auth/me').set(bearer(admin.token)).expect(200);
    expect(me.body.data).toMatchObject({ role: 'ADMIN', email });
    await request(app).get('/api/admin/dashboard').set(bearer(admin.token)).expect(200);
    // A wrong password is still refused.
    const wrong = await signIn(email, 'not-the-admin-password').expect(401);
    expect(wrong.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    // The admin API stays closed to staff, whatever their address.
    const staff = await newPendingStaff(app);
    await request(app).get('/api/admin/dashboard').set(bearer(staff.token)).expect(403);
  });

  it('password sign-in is rate-limited per client', async () => {
    const limited = buildTestApp({ SENSITIVE_RATE_LIMIT_MAX: '2' });
    try {
      const attempt = () =>
        request(limited.app)
          .post('/api/auth/sign-in/email')
          .set('Origin', APP)
          .send({ email: uniquePersonalEmail('guess'), password: 'guess-guess-guess' });
      await attempt().expect(401);
      await attempt().expect(401);
      expect((await attempt().expect(429)).body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.prisma.$disconnect();
    }
  });
});

describe('the backend enforces the method on every request', () => {
  it('a student session from before role-specific sign-in (no method) keeps working', async () => {
    const student = await newStudent(app, prisma);
    await prisma.authSession.update({
      where: { token: storedToken(student) },
      data: { authMethod: null },
    });
    await request(app).get('/api/auth/me').set(bearer(student.token)).expect(200);
    await request(app).get('/api/orders').set(bearer(student.token)).expect(200);
    await server.connect(student.token);
  });

  it('an old session (no method) of a staff member is refused and revoked on the socket', async () => {
    // As before this change: a staff account signed in with Google.
    const google = await createTestUser(uniqueEmail('old-google-staff'));
    await prisma.staff.create({
      data: { authUserId: google.uid, email: google.email, name: 'Old Google Staff' },
    });
    await prisma.authSession.update({
      where: { token: storedToken(google) },
      data: { authMethod: null },
    });
    // A new Google session is refused outright for a staff address…
    await expect(createTestUser(google.email)).rejects.toThrow(/STAFF_ADMIN_USE_PASSWORD/);
    // …and the existing one is refused on use, then deleted.
    expect(await server.rejectedConnect(google.token)).toBe('SIGN_IN_METHOD_NOT_ALLOWED');
    expect(await prisma.authSession.count({ where: { token: storedToken(google) } })).toBe(0);
  });

  it('REST refuses a staff session that was not created with a password, and deletes it', async () => {
    const google = await createTestUser(uniqueEmail('rest-google-staff'));
    await prisma.staff.create({
      data: { authUserId: google.uid, email: google.email, name: 'REST Google Staff' },
    });
    const res = await request(app).get('/api/auth/me').set(bearer(google.token)).expect(401);
    expect(res.body.error.code).toBe('SIGN_IN_METHOD_NOT_ALLOWED');
    expect(res.body.error.message).toMatch(/email and password/);
    expect(await prisma.authSession.count({ where: { token: storedToken(google) } })).toBe(0);
  });

  it('a password-method session can never act as a student', async () => {
    const student = await newStudent(app, prisma);
    await prisma.authSession.update({
      where: { token: storedToken(student) },
      data: { authMethod: 'password' },
    });
    const res = await request(app).get('/api/orders').set(bearer(student.token)).expect(401);
    expect(res.body.error.code).toBe('SIGN_IN_METHOD_NOT_ALLOWED');
  });

  it('a Google-method session can never act as an admin', async () => {
    const admin = await newAdmin(prisma);
    await prisma.authSession.update({
      where: { token: storedToken(admin) },
      data: { authMethod: 'google' },
    });
    // Refused before the role check even runs: a password identity's address
    // was never verified by Google, so it does not qualify as a Google session.
    const res = await request(app).get('/api/admin/dashboard').set(bearer(admin.token)).expect(401);
    expect(['AUTH_REQUIRED', 'SIGN_IN_METHOD_NOT_ALLOWED']).toContain(res.body.error.code);
    await server.rejectedConnect(admin.token);
  });

  it('a Google-verified admin identity with an old or Google session is refused and revoked', async () => {
    // An admin that used to sign in with Google: its identity is Google-verified.
    const google = await createTestUser(uniqueEmail('old-google-admin'));
    await prisma.admin.create({
      data: { authUserId: google.uid, email: google.email, name: 'Old Google Admin' },
    });
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set(bearer(google.token))
      .expect(401);
    expect(res.body.error.code).toBe('SIGN_IN_METHOD_NOT_ALLOWED');
    expect(await prisma.authSession.count({ where: { token: storedToken(google) } })).toBe(0);
  });

  it('sockets accept password sessions of staff and admins', async () => {
    const admin = await newAdmin(prisma);
    const staff = await newApprovedStaff(
      app,
      admin,
      (await canteenBySlug(prisma, 'yamuna-narmada')).id,
    );
    await server.connect(admin.token);
    await server.connect(staff.token);
  });
});

describe('moving existing staff and admins to passwords', () => {
  it('keeps the account and its Google-era identity, ends old sessions, then signs in with the password', async () => {
    const google = await createTestUser(uniqueEmail('migrating'));
    const canteen = await canteenBySlug(prisma, 'yamuna-narmada');
    await prisma.staff.updateMany({
      where: { canteenId: canteen.id, status: 'APPROVED' },
      data: { status: 'DEACTIVATED', canteenId: null },
    });
    const staff = await prisma.staff.create({
      data: {
        authUserId: google.uid,
        email: google.email,
        name: 'Migrating Staff',
        status: 'APPROVED',
        canteenId: canteen.id,
        assignments: {
          create: { canteenId: canteen.id, capabilities: { create: [{ capability: 'KITCHEN' }] } },
        },
      },
    });
    const result = await setAccountPassword(prisma, {
      role: 'STAFF',
      email: google.email,
      passwordHash: await hashNewPassword(TEST_PASSWORD),
    });
    expect(result).toMatchObject({
      accountId: staff.id,
      authUserId: google.uid,
      createdIdentity: false,
    });
    expect(await prisma.authSession.count({ where: { userId: google.uid } })).toBe(0);

    const user = await passwordSignIn(google.email);
    expect(user.uid).toBe(google.uid);
    const me = await request(app).get('/api/auth/me').set(bearer(user.token)).expect(200);
    expect(me.body.data).toMatchObject({
      id: staff.id,
      status: 'APPROVED',
      canteen: { id: canteen.id },
    });
    expect(me.body.data.assignments[0].capabilities).toEqual(['KITCHEN']);
  });

  it('refuses an address that belongs to a student', async () => {
    const student = await newStudent(app, prisma);
    await expect(
      setAccountPassword(prisma, {
        role: 'STAFF',
        email: student.email,
        passwordHash: await hashNewPassword(TEST_PASSWORD),
      }),
    ).rejects.toThrow(/No staff account/);
  });
});

describe('password sessions', () => {
  it('last 7 days, and sign-out ends them everywhere they are used', async () => {
    const admin = await newAdmin(prisma);
    const session = await sessionOf(admin.token);
    const lifetime = session.expiresAt.getTime() - session.createdAt.getTime();
    expect(Math.abs(lifetime - SESSION_EXPIRES_IN_SECONDS * 1000)).toBeLessThan(60_000);

    const socket = await server.connect(admin.token);
    await request(app)
      .post('/api/auth/sign-out')
      .set('Origin', APP)
      .set(bearer(admin.token))
      .send({})
      .expect(200);
    expect(await prisma.authSession.count({ where: { id: session.id } })).toBe(0);
    await request(app).get('/api/admin/dashboard').set(bearer(admin.token)).expect(401);
    // The open socket is told and disconnected within the re-check interval.
    await new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
  });

  it('an expired password session is refused', async () => {
    const admin = await newAdmin(prisma);
    await prisma.authSession.update({
      where: { token: storedToken(admin) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app).get('/api/admin/dashboard').set(bearer(admin.token)).expect(401);
    expect(await server.rejectedConnect(admin.token)).toBe('AUTH_REQUIRED');
  });
});

describe('password changes (staff and admins)', () => {
  const change = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/auth/change-password').set('Origin', APP).set(bearer(token)).send(body);

  it('requires the current password and replaces it', async () => {
    const email = uniquePersonalEmail('changer');
    await signUp({ name: 'Changer', email, password: TEST_PASSWORD }).expect(201);
    const user = await passwordSignIn(email);
    const other = await passwordSignIn(email);

    const wrong = await change(user.token, {
      currentPassword: 'not-the-password',
      newPassword: 'a-brand-new-password',
    });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const short = await change(user.token, {
      currentPassword: TEST_PASSWORD,
      newPassword: 'short',
    });
    expect(short.status).toBe(400);

    await change(user.token, {
      currentPassword: TEST_PASSWORD,
      newPassword: 'a-brand-new-password',
      revokeOtherSessions: true,
    }).expect(200);
    expect((await passwordSignInRequest(email, TEST_PASSWORD)).status).toBe(401);
    await passwordSignIn(email, 'a-brand-new-password');
    // Other devices are signed out.
    await request(app).get('/api/auth/me').set(bearer(other.token)).expect(401);
  });

  it('is refused for students, and for signed-out callers', async () => {
    const student = await newStudent(app, prisma);
    const res = await change(student.token, {
      currentPassword: TEST_PASSWORD,
      newPassword: 'a-brand-new-password',
    }).expect(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_NOT_ALLOWED');
    await request(app)
      .post('/api/auth/change-password')
      .set('Origin', APP)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-password' })
      .expect(401);
  });

  it('admins can change their password', async () => {
    const admin = await newAdmin(prisma);
    await change(admin.token, {
      currentPassword: TEST_PASSWORD,
      newPassword: 'an-admin-password-2',
    }).expect(200);
    await passwordSignIn(admin.email, 'an-admin-password-2');
  });
});
