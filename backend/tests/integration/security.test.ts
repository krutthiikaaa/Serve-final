import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { buildTestApp } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  newAdmin,
  newApprovedStaff,
  newPendingStaff,
  newStudent,
  type Actor,
} from '../helpers/actors.js';

/**
 * Route-level security sweep: every protected endpoint must reject missing
 * credentials and the wrong role, and malformed ids must never reach the
 * database layer.
 */
const { app, prisma, env } = buildTestApp();
const anyId = randomUUID();

type Method = 'get' | 'post' | 'patch' | 'delete';
type Route = [Method, string];

const STUDENT_ROUTES: Route[] = [
  ['post', '/api/cart/quote'],
  ['post', '/api/orders'],
  ['get', '/api/orders'],
  ['get', `/api/orders/${anyId}`],
  ['post', `/api/orders/${anyId}/cancel`],
  ['post', `/api/payments/${anyId}/initiate`],
  ['post', `/api/payments/${anyId}/verify`],
  ['post', `/api/payments/${anyId}/mock-complete`],
  ['get', '/api/students/me/recommendations'],
];
const STAFF_ROUTES: Route[] = [
  ['get', '/api/staff/dashboard'],
  ['patch', '/api/staff/canteen/status'],
  ['get', '/api/staff/orders'],
  ['get', `/api/staff/orders/${anyId}`],
  ['patch', `/api/staff/orders/${anyId}/status`],
  ['get', '/api/staff/menu'],
  ['post', '/api/staff/menu/categories'],
  ['patch', `/api/staff/menu/categories/${anyId}`],
  ['delete', `/api/staff/menu/categories/${anyId}`],
  ['post', '/api/staff/menu/items'],
  ['patch', `/api/staff/menu/items/${anyId}`],
  ['patch', `/api/staff/menu/items/${anyId}/price`],
  ['patch', `/api/staff/menu/items/${anyId}/availability`],
  ['delete', `/api/staff/menu/items/${anyId}`],
  ['post', '/api/staff/change-requests'],
  ['get', '/api/staff/change-requests'],
];
const ADMIN_ROUTES: Route[] = [
  ['get', '/api/admin/dashboard'],
  ['get', '/api/admin/canteens'],
  ['post', '/api/admin/canteens'],
  ['get', `/api/admin/canteens/${anyId}`],
  ['patch', `/api/admin/canteens/${anyId}`],
  ['get', '/api/admin/hostels'],
  ['post', '/api/admin/hostels'],
  ['patch', `/api/admin/hostels/${anyId}`],
  ['get', '/api/admin/staff'],
  ['get', `/api/admin/staff/${anyId}`],
  ['patch', `/api/admin/staff/${anyId}/assignment`],
  ['post', `/api/admin/staff/${anyId}/deactivate`],
  ['get', '/api/admin/change-requests'],
  ['post', `/api/admin/change-requests/${anyId}/approve`],
  ['post', `/api/admin/change-requests/${anyId}/reject`],
  ['get', '/api/admin/orders'],
  ['get', `/api/admin/orders/${anyId}`],
  ['get', `/api/admin/canteens/${anyId}/menu`],
  ['post', `/api/admin/canteens/${anyId}/menu/categories`],
  ['patch', `/api/admin/menu/categories/${anyId}`],
  ['post', `/api/admin/canteens/${anyId}/menu/items`],
  ['patch', `/api/admin/menu/items/${anyId}`],
];
const ANY_ROLE_ROUTES: Route[] = [
  ['get', '/api/auth/me'],
  ['post', '/api/auth/student/register'],
  ['post', '/api/auth/staff/register'],
  ['get', '/api/canteens'],
  ['get', `/api/canteens/${anyId}`],
  ['get', `/api/canteens/${anyId}/menu`],
  ['get', `/api/canteens/${anyId}/categories`],
  ['get', `/api/menu/items/${anyId}`],
  ['get', '/api/notifications'],
  ['patch', `/api/notifications/${anyId}/read`],
  ['patch', '/api/notifications/read-all'],
];

let student: Actor;
let staff: Actor;
let pendingStaff: Actor;
let admin: Actor;

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  const kg = await canteenBySlug(prisma, 'krishna-godavari');
  admin = await newAdmin(prisma, env);
  student = await newStudent(app, prisma);
  staff = await newApprovedStaff(app, admin, kg.id);
  pendingStaff = await newPendingStaff(app);
});
afterAll(() => prisma.$disconnect());

const call = ([method, path]: Route, token?: string) => {
  const req = request(app)[method](path);
  return token ? req.set(bearer(token)) : req;
};

describe('authentication is required everywhere except health and hostels', () => {
  it.each([...STUDENT_ROUTES, ...STAFF_ROUTES, ...ADMIN_ROUTES, ...ANY_ROLE_ROUTES])(
    '%s %s -> 401',
    async (method, path) => {
      const res = await call([method, path]).send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    },
  );

  it('public endpoints stay public', async () => {
    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/hostels').expect(200);
  });
});

describe('wrong roles are rejected with 403', () => {
  it('student routes reject staff and admins', async () => {
    for (const route of STUDENT_ROUTES) {
      for (const actor of [staff, admin]) {
        expect((await call(route, actor.token).send({})).status).toBe(403);
      }
    }
  });

  it('staff routes reject students and admins', async () => {
    for (const route of STAFF_ROUTES) {
      for (const actor of [student, admin]) {
        expect((await call(route, actor.token).send({})).status).toBe(403);
      }
    }
  });

  it('operational staff routes reject pending staff', async () => {
    for (const route of STAFF_ROUTES.filter(([, path]) => !path.includes('change-requests'))) {
      const res = await call(route, pendingStaff.token).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('STAFF_NOT_APPROVED');
    }
  });

  it('admin routes reject students and staff', async () => {
    for (const route of ADMIN_ROUTES) {
      for (const actor of [student, staff, pendingStaff]) {
        expect((await call(route, actor.token).send({})).status).toBe(403);
      }
    }
  });
});

describe('input validation', () => {
  it('rejects malformed ids with 422 before touching the database', async () => {
    const cases: [Actor, Route][] = [
      [student, ['get', '/api/orders/1 OR 1=1']],
      [student, ['post', "/api/payments/'; DROP TABLE x;--/initiate"]],
      [staff, ['patch', '/api/staff/menu/items/abc/price']],
      [admin, ['get', '/api/admin/canteens/123']],
      [student, ['get', '/api/menu/items/not-an-id']],
    ];
    for (const [actor, route] of cases) {
      const res = await call(route, actor.token).send({ pricePaise: 100 });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('never leaks stack traces or SQL in error responses', async () => {
    const responses = await Promise.all([
      call(['get', '/api/orders/bad-id'], student.token),
      request(app)
        .post('/api/orders')
        .set(bearer(student.token))
        .set('Content-Type', 'application/json')
        .send('{bad json'),
      call(['get', `/api/admin/orders/${anyId}`], admin.token),
    ]);
    for (const res of responses) {
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/at \w+ \(|node_modules|prisma|SELECT|postgres|stack/i);
      expect(res.body.error.requestId).toBeTruthy();
    }
  });

  it('ignores client-supplied role headers', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set(bearer(student.token))
      .set('X-Role', 'ADMIN')
      .expect(200);
    expect(res.body.data.role).toBe('STUDENT');
  });
});
