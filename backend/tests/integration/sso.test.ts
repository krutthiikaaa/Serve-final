import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import {
  expectShape,
  ssoExchangeResultSchema,
  ssoInitiateResultSchema,
} from '../helpers/contract.js';
import { truncateAll } from '../helpers/db.js';
import { createFirebaseAuth } from '../../src/lib/firebase.js';
import { createFirebaseUser, signInWithCustomToken } from '../helpers/firebase.js';
import { buildTestApp } from '../helpers/test-app.js';
import {
  bearer,
  canteenBySlug,
  newAdmin,
  newApprovedStaff,
  newPendingStaff,
  newStudent,
  type Actor,
} from '../helpers/actors.js';

const { app, prisma, env } = buildTestApp();

let admin: Actor;
let staff: Actor;
let pendingStaff: Actor;
let student: Actor;
let canteenId: string;

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  const kg = await canteenBySlug(prisma, 'krishna-godavari');
  canteenId = kg.id;
  admin = await newAdmin(prisma, env);
  staff = await newApprovedStaff(app, admin, canteenId);
  pendingStaff = await newPendingStaff(app);
  student = await newStudent(app, prisma);
});
afterAll(() => prisma.$disconnect());

function initiate(token: string, audience: 'STAFF' | 'ADMIN') {
  return request(app).post('/api/auth/sso/initiate').set(bearer(token)).send({ audience });
}

function exchange(code: string, audience: 'STAFF' | 'ADMIN') {
  return request(app).post('/api/auth/sso/exchange').send({ code, audience });
}

function codeFrom(redirectUrl: string): string {
  const code = new URL(redirectUrl).searchParams.get('code');
  if (!code) throw new Error(`missing code in ${redirectUrl}`);
  return code;
}

describe('SSO initiate', () => {
  it('issues a staff handoff for an approved staff member', async () => {
    const res = await initiate(staff.token, 'STAFF').expect(200);
    const data = expectShape(ssoInitiateResultSchema, res.body.data);
    expect(data.redirectUrl).toMatch(/^http:\/\/localhost:5173\/sso\/callback\?code=/);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(res.body)).not.toMatch(/customToken|idToken|password|BEGIN PRIVATE/i);
  });

  it('issues an admin handoff for an active admin', async () => {
    const res = await initiate(admin.token, 'ADMIN').expect(200);
    const data = expectShape(ssoInitiateResultSchema, res.body.data);
    expect(data.redirectUrl).toMatch(/^http:\/\/localhost:5174\/sso\/callback\?code=/);
  });

  it('rejects a missing or invalid Firebase token', async () => {
    expect((await request(app).post('/api/auth/sso/initiate').send({ audience: 'STAFF' })).status).toBe(
      401,
    );
    const res = await request(app)
      .post('/api/auth/sso/initiate')
      .set(bearer('not-a-jwt'))
      .send({ audience: 'STAFF' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('rejects the wrong dashboard audience', async () => {
    expect((await initiate(staff.token, 'ADMIN')).body.error.code).toBe('FORBIDDEN_ROLE');
    expect((await initiate(admin.token, 'STAFF')).body.error.code).toBe('FORBIDDEN_ROLE');
    expect((await initiate(student.token, 'STAFF')).body.error.code).toBe('FORBIDDEN_ROLE');
    expect((await initiate(student.token, 'ADMIN')).body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('rejects unapproved staff', async () => {
    const res = await initiate(pendingStaff.token, 'STAFF').expect(403);
    expect(res.body.error.code).toBe('STAFF_NOT_APPROVED');
  });

  it('cannot store an approved staff member without a canteen', async () => {
    await expect(
      prisma.staff.update({ where: { id: staff.id }, data: { canteenId: null } }),
    ).rejects.toMatchObject({ code: 'P2039' });
  });

  it('rejects a disabled admin', async () => {
    await prisma.admin.update({ where: { id: admin.id }, data: { isActive: false } });
    const res = await initiate(admin.token, 'ADMIN').expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    await prisma.admin.update({ where: { id: admin.id }, data: { isActive: true } });
  });
});

describe('SSO exchange', () => {
  it('mints a Firebase Custom Token a staff dashboard can redeem', async () => {
    const started = await initiate(staff.token, 'STAFF').expect(200);
    const code = codeFrom(started.body.data.redirectUrl);
    const res = await exchange(code, 'STAFF').expect(200);
    const data = expectShape(ssoExchangeResultSchema, res.body.data);
    const idToken = await signInWithCustomToken(data.customToken);
    const me = await request(app).get('/api/auth/me').set(bearer(idToken)).expect(200);
    expect(me.body.data.role).toBe('STAFF');
    expect(me.body.data.status).toBe('APPROVED');
    expect(me.body.data.canteen.id).toBe(canteenId);
  });

  it('mints a Custom Token for an admin', async () => {
    const started = await initiate(admin.token, 'ADMIN').expect(200);
    const res = await exchange(codeFrom(started.body.data.redirectUrl), 'ADMIN').expect(200);
    const idToken = await signInWithCustomToken(res.body.data.customToken);
    const me = await request(app).get('/api/auth/me').set(bearer(idToken)).expect(200);
    expect(me.body.data.role).toBe('ADMIN');
  });

  it('rejects a code meant for the other dashboard', async () => {
    const started = await initiate(staff.token, 'STAFF').expect(200);
    const res = await exchange(codeFrom(started.body.data.redirectUrl), 'ADMIN').expect(401);
    expect(res.body.error.code).toBe('SSO_CODE_INVALID');
  });

  it('rejects an expired code', async () => {
    const code = `${'expiredcode'.padEnd(24, 'x')}`;
    await prisma.ssoAuthorizationCode.create({
      data: {
        codeHash: createHash('sha256').update(code).digest('hex'),
        firebaseUid: staff.uid,
        audience: 'STAFF',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const res = await exchange(code, 'STAFF').expect(401);
    expect(res.body.error.code).toBe('SSO_CODE_INVALID');
  });

  it('rejects a reused code', async () => {
    const started = await initiate(staff.token, 'STAFF').expect(200);
    const code = codeFrom(started.body.data.redirectUrl);
    await exchange(code, 'STAFF').expect(200);
    const res = await exchange(code, 'STAFF').expect(401);
    expect(res.body.error.code).toBe('SSO_CODE_INVALID');
  });

  it('lets only one concurrent exchange consume the code', async () => {
    const started = await initiate(staff.token, 'STAFF').expect(200);
    const code = codeFrom(started.body.data.redirectUrl);
    const [a, b] = await Promise.all([exchange(code, 'STAFF'), exchange(code, 'STAFF')]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);
    const ok = a.status === 200 ? a : b;
    expectShape(ssoExchangeResultSchema, ok.body.data);
  });

  it('refuses to mint a token after the Firebase user is disabled', async () => {
    const started = await initiate(staff.token, 'STAFF').expect(200);
    const code = codeFrom(started.body.data.redirectUrl);
    const auth = createFirebaseAuth(env);
    await auth.updateUser(staff.uid, { disabled: true });
    try {
      const res = await exchange(code, 'STAFF').expect(401);
      expect(res.body.error.code).toBe('AUTH_USER_DISABLED');
    } finally {
      await auth.updateUser(staff.uid, { disabled: false });
    }
  });

  it('revalidates a deactivated staff member before minting a token', async () => {
    const started = await initiate(staff.token, 'STAFF').expect(200);
    const code = codeFrom(started.body.data.redirectUrl);
    await prisma.staff.update({ where: { id: staff.id }, data: { status: 'DEACTIVATED' } });
    const res = await exchange(code, 'STAFF').expect(403);
    expect(res.body.error.code).toBe('STAFF_DEACTIVATED');
    await prisma.staff.update({
      where: { id: staff.id },
      data: { status: 'APPROVED', canteenId },
    });
  });

  it('rejects invalid exchange bodies', async () => {
    expect((await request(app).post('/api/auth/sso/exchange').send({})).status).toBe(422);
    expect((await exchange('short', 'STAFF')).status).toBe(422);
    const unknown = await exchange(`${'unknowncode'.padEnd(24, 'y')}`, 'STAFF');
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('SSO_CODE_INVALID');
  });

  it('does not require a bearer token on exchange', async () => {
    const started = await initiate(admin.token, 'ADMIN').expect(200);
    const res = await request(app)
      .post('/api/auth/sso/exchange')
      .send({ code: codeFrom(started.body.data.redirectUrl), audience: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.headers.authorization).toBeUndefined();
  });
});

describe('SSO isolation', () => {
  it('cannot be used by an unregistered Firebase user', async () => {
    const user = await createFirebaseUser();
    const res = await initiate(user.idToken, 'STAFF').expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_REGISTERED');
  });
});
