import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { Env } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/lib/prisma.js';
import { bootstrapAdmin } from '../../src/modules/auth/admin-bootstrap.js';
import { hashNewPassword, setAccountPassword } from '../../src/modules/auth/password-accounts.js';
import {
  TEST_PASSWORD,
  createTestUser,
  passwordSignIn,
  uniqueEmail,
  uniquePersonalEmail,
} from './identity.js';

/**
 * Test actors created through the REAL flows: students via the Google
 * stand-in (SRM gate) and the registration API; staff via password sign-up
 * and email + password sign-in; admins via the provisioning bootstrap with a
 * password; approvals via the admin API.
 */
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface Actor {
  id: string;
  uid: string;
  email: string;
  token: string;
}

export async function newStudent(
  app: Express,
  prisma: PrismaClient,
  hostelName = 'Krishna',
): Promise<Actor> {
  const user = await createTestUser(uniqueEmail('student'));
  const hostel = await prisma.hostel.findUniqueOrThrow({ where: { name: hostelName } });
  const res = await request(app)
    .post('/api/auth/student/register')
    .set(bearer(user.token))
    .send({ name: 'Test Student', email: user.email, hostelId: hostel.id });
  if (res.status !== 201)
    throw new Error(`student registration failed: ${JSON.stringify(res.body)}`);
  return { id: res.body.data.id as string, uid: user.uid, email: user.email, token: user.token };
}

/** Hashed once: scrypt is deliberately slow. */
let testPasswordHash: Promise<string> | null = null;
const passwordHash = () => (testPasswordHash ??= hashNewPassword(TEST_PASSWORD));

/** Admin provisioned with a password (the only way), then signed in with it. */
export async function newAdmin(prisma: PrismaClient, _env?: Env): Promise<Actor> {
  const email = uniqueEmail('admin');
  const result = await bootstrapAdmin({ prisma }, { email, name: 'Test Admin' });
  await setAccountPassword(prisma, { role: 'ADMIN', email, passwordHash: await passwordHash() });
  const user = await passwordSignIn(email);
  return { id: result.adminId, uid: user.uid, email: user.email, token: user.token };
}

/** Staff self-registration (email + password, personal address), then password sign-in. */
export async function newPendingStaff(app: Express, requestedCanteenId?: string): Promise<Actor> {
  const email = uniquePersonalEmail('staff');
  const res = await request(app)
    .post('/api/auth/staff/sign-up')
    .send({
      name: 'Test Staff',
      email,
      password: TEST_PASSWORD,
      ...(requestedCanteenId ? { requestedCanteenId } : {}),
    });
  if (res.status !== 201) throw new Error(`staff sign-up failed: ${JSON.stringify(res.body)}`);
  const user = await passwordSignIn(email);
  const me = await request(app).get('/api/auth/me').set(bearer(user.token));
  if (me.status !== 200) throw new Error(`staff /me failed: ${JSON.stringify(me.body)}`);
  return { id: me.body.data.id as string, uid: user.uid, email: user.email, token: user.token };
}

/** Staff registers with an access request; an admin approves it through the API. */
export async function newApprovedStaff(
  app: Express,
  admin: Actor,
  canteenId: string,
  options: { replaceExisting?: boolean } = {},
): Promise<Actor> {
  const staff = await newPendingStaff(app, canteenId);
  const pending = await request(app)
    .get('/api/admin/change-requests?status=PENDING&limit=100')
    .set(bearer(admin.token));
  const requestRow = (pending.body.data as { id: string; staff: { id: string } }[]).find(
    (row) => row.staff.id === staff.id,
  );
  if (!requestRow) throw new Error('change request not found');
  const approved = await request(app)
    .post(`/api/admin/change-requests/${requestRow.id}/approve`)
    .set(bearer(admin.token))
    .send(options.replaceExisting ? { replaceExisting: true } : {});
  if (approved.status !== 200) throw new Error(`approval failed: ${JSON.stringify(approved.body)}`);
  return staff;
}

export const idempotencyKey = () => `test-${randomUUID()}`;

export async function canteenBySlug(prisma: PrismaClient, slug: string) {
  return prisma.canteen.findUniqueOrThrow({ where: { slug } });
}

export async function itemByName(prisma: PrismaClient, canteenId: string, name: string) {
  return prisma.menuItem.findUniqueOrThrow({ where: { canteenId_name: { canteenId, name } } });
}

/** Place an order through the API and return its body. */
export async function placeOrder(
  app: Express,
  student: Actor,
  canteenId: string,
  items: { menuItemId: string; quantity: number }[],
) {
  const res = await request(app)
    .post('/api/orders')
    .set(bearer(student.token))
    .set('Idempotency-Key', idempotencyKey())
    .send({ canteenId, items });
  if (res.status !== 201) throw new Error(`order failed: ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; orderNumber: string; totalPaise: number; status: string };
}

/** Initiate + complete a mock payment through the API. */
export async function payOrder(app: Express, student: Actor, orderId: string) {
  const init = await request(app)
    .post(`/api/payments/${orderId}/initiate`)
    .set(bearer(student.token));
  if (init.status !== 200) throw new Error(`initiate failed: ${JSON.stringify(init.body)}`);
  const done = await request(app)
    .post(`/api/payments/${orderId}/mock-complete`)
    .set(bearer(student.token))
    .send({ outcome: 'success' });
  if (done.status !== 200) throw new Error(`mock-complete failed: ${JSON.stringify(done.body)}`);
  return done.body.data as { order: { status: string }; confirmation: Record<string, string> };
}
