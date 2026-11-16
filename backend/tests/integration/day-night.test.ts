import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  idempotencyKey,
  itemByName,
  newAdmin,
  newApprovedStaff,
  newStudent,
  payOrder,
  placeOrder,
  type Actor,
} from '../helpers/actors.js';
import {
  expectShape,
  orderPaymentConfigSchema,
  qrOverviewSchema,
  serviceAreaDirectorySchema,
  serviceAreaSchema,
  studentServiceSchema,
} from '../helpers/contract.js';
import { nextEvent, startTestServer, subscribeMenu, type TestServer } from '../helpers/realtime.js';

/**
 * Day & Night canteens: availability exclusivity per service area, admin
 * switching, dedicated staff isolation, and per-canteen payment QR codes.
 * Real PostgreSQL, real Better Auth sessions, real Socket.IO.
 */
let server: TestServer;
let admin: Actor;
let student: Actor;
let kgNightStaff: Actor;
let kgDayStaff: Actor;
let kgNight: { id: string; serviceAreaId: string };
let kgDay: { id: string; serviceAreaId: string };
let ynNight: { id: string; serviceAreaId: string };
let nightCoffee: { id: string };
let dayCoffee: { id: string };

const api = () => request(server.app);
const asAdmin = (req: request.Test) => req.set(bearer(admin.token));

function switchArea(serviceAreaId: string, canteenId: string | null) {
  return asAdmin(api().put(`/api/admin/service-areas/${serviceAreaId}/active-canteen`)).send({
    canteenId,
  });
}

async function openCount(serviceAreaId: string) {
  return server.prisma.canteen.count({
    where: { serviceAreaId, isActive: true, isAcceptingOrders: true },
  });
}

function quote(canteenId: string, menuItemId: string) {
  return api()
    .post('/api/cart/quote')
    .set(bearer(student.token))
    .send({ canteenId, items: [{ menuItemId, quantity: 1 }] });
}

// Smallest valid PNG / JPEG / WEBP headers (validation is by magic bytes).
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('IHDR-test-qr-image'),
]);
const PNG2 = Buffer.concat([PNG, Buffer.from('-second')]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function uploadQr(canteenId: string, body: Buffer, contentType: string, token = admin.token) {
  return api()
    .put(`/api/admin/canteens/${canteenId}/qr`)
    .set(bearer(token))
    .set('Content-Type', contentType)
    .send(body);
}

beforeAll(async () => {
  server = await startTestServer();
  await truncateAll(server.prisma);
  await seedDatabase(server.prisma);
  kgNight = await canteenBySlug(server.prisma, 'krishna-godavari');
  kgDay = await canteenBySlug(server.prisma, 'krishna-godavari-day');
  ynNight = await canteenBySlug(server.prisma, 'yamuna-narmada');
  nightCoffee = await itemByName(server.prisma, kgNight.id, 'Coffee');
  dayCoffee = await itemByName(server.prisma, kgDay.id, 'Coffee');
  admin = await newAdmin(server.prisma, server.ctx.env);
  student = await newStudent(server.app, server.prisma, 'Krishna');
  kgNightStaff = await newApprovedStaff(server.app, admin, kgNight.id);
  kgDayStaff = await newApprovedStaff(server.app, admin, kgDay.id);
});
afterAll(async () => {
  await server.close();
});

describe('Day/Night availability for one service area', () => {
  beforeEach(async () => {
    // Known state: the Night canteen serves Krishna & Godavari.
    await switchArea(kgNight.serviceAreaId, kgNight.id).expect(200);
  });

  it('Night active → Day unavailable; the student is shown the Night canteen', async () => {
    const service = expectShape(
      studentServiceSchema,
      (await api().get('/api/students/me/service').set(bearer(student.token)).expect(200)).body
        .data,
    );
    expect(service.serviceArea.name).toBe('Krishna & Godavari');
    expect(service.current).toMatchObject({ id: kgNight.id, type: 'NIGHT' });
    expect(service.unavailable).toBe(false);
    expect(service.canteens.find((c) => c.id === kgDay.id)?.availability.state).toBe(
      'OTHER_SERVICE_ACTIVE',
    );

    await quote(kgNight.id, nightCoffee.id).expect(200);
    expect((await quote(kgDay.id, dayCoffee.id).expect(409)).body.error.code).toBe(
      'CANTEEN_NOT_ACCEPTING_ORDERS',
    );
  });

  it('switching to Day makes Night unavailable in one step, and back again', async () => {
    const area = expectShape(
      serviceAreaSchema,
      (await switchArea(kgNight.serviceAreaId, kgDay.id).expect(200)).body.data,
    );
    expect(area.openCanteenId).toBe(kgDay.id);
    expect(await openCount(kgNight.serviceAreaId)).toBe(1);

    const service = (await api().get('/api/students/me/service').set(bearer(student.token))).body
      .data;
    expect(service.current).toMatchObject({ id: kgDay.id, type: 'DAY' });
    const menu = await api()
      .get(`/api/canteens/${service.current.id}/menu`)
      .set(bearer(student.token))
      .expect(200);
    expect(menu.body.data.servicePeriod).toBe('DAY');
    expect((await quote(kgDay.id, dayCoffee.id).expect(200)).body.data.canteen).toMatchObject({
      id: kgDay.id,
      type: 'DAY',
    });
    expect((await quote(kgNight.id, nightCoffee.id).expect(409)).body.error.code).toBe(
      'CANTEEN_NOT_ACCEPTING_ORDERS',
    );

    // Day order is associated with the Day canteen.
    const order = await placeOrder(server.app, student, kgDay.id, [
      { menuItemId: dayCoffee.id, quantity: 1 },
    ]);
    const stored = await server.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ canteenId: kgDay.id, servicePeriod: 'DAY' });

    await switchArea(kgNight.serviceAreaId, kgNight.id).expect(200);
    await quote(kgNight.id, nightCoffee.id).expect(200);
    await quote(kgDay.id, dayCoffee.id).expect(409);
  });

  it('neither canteen available → a clear unavailable state and no orders', async () => {
    await switchArea(kgNight.serviceAreaId, null).expect(200);
    expect(await openCount(kgNight.serviceAreaId)).toBe(0);
    const service = (await api().get('/api/students/me/service').set(bearer(student.token))).body
      .data;
    expect(service.unavailable).toBe(true);
    // Off duty (no canteen of the area serving) is distinct from a staff pause.
    expect(service.current.availability.state).toBe('OFF_DUTY');
    await quote(kgNight.id, nightCoffee.id).expect(409);
    await quote(kgDay.id, dayCoffee.id).expect(409);
    const order = await api()
      .post('/api/orders')
      .set(bearer(student.token))
      .set('Idempotency-Key', idempotencyKey())
      .send({ canteenId: kgDay.id, items: [{ menuItemId: dayCoffee.id, quantity: 1 }] });
    expect(order.status).toBe(409);
  });

  it('staff cannot resume their canteen while the other one serves the area', async () => {
    const res = await api()
      .patch('/api/staff/canteen/status')
      .set(bearer(kgDayStaff.token))
      .send({ isAcceptingOrders: true })
      .expect(409);
    expect(res.body.error.code).toBe('SERVICE_AREA_CONFLICT');
    expect(res.body.error.details.openCanteen).toMatchObject({ id: kgNight.id, type: 'NIGHT' });

    // Admin PATCH without switching is refused the same way.
    const admin409 = await asAdmin(api().patch(`/api/admin/canteens/${kgDay.id}`))
      .send({ isAcceptingOrders: true })
      .expect(409);
    expect(admin409.body.error.code).toBe('SERVICE_AREA_CONFLICT');
    expect(await openCount(kgNight.serviceAreaId)).toBe(1);
  });

  it('a paused canteen accepts no new orders; resuming restores ordering', async () => {
    await api()
      .patch('/api/staff/canteen/status')
      .set(bearer(kgNightStaff.token))
      .send({ isAcceptingOrders: false })
      .expect(200);
    expect((await quote(kgNight.id, nightCoffee.id).expect(409)).body.error.code).toBe(
      'CANTEEN_NOT_ACCEPTING_ORDERS',
    );
    const paused = await api().get(`/api/canteens/${kgNight.id}`).set(bearer(student.token));
    expect(paused.body.data.availability.state).toBe('PAUSED');
    await api()
      .patch('/api/staff/canteen/status')
      .set(bearer(kgNightStaff.token))
      .send({ isAcceptingOrders: true })
      .expect(200);
    await quote(kgNight.id, nightCoffee.id).expect(200);
  });

  it('simultaneous activation attempts never open both canteens', async () => {
    for (let round = 0; round < 5; round += 1) {
      await switchArea(kgNight.serviceAreaId, null).expect(200);
      const results = await Promise.all([
        api()
          .patch('/api/staff/canteen/status')
          .set(bearer(kgNightStaff.token))
          .send({ isAcceptingOrders: true }),
        api()
          .patch('/api/staff/canteen/status')
          .set(bearer(kgDayStaff.token))
          .send({ isAcceptingOrders: true }),
        asAdmin(api().patch(`/api/admin/canteens/${kgDay.id}`)).send({ isAcceptingOrders: true }),
      ]);
      const statuses = results.map((res) => res.status).sort();
      expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
      expect(statuses.filter((status) => status === 409).length).toBeGreaterThanOrEqual(1);
      for (const res of results.filter((r) => r.status === 409)) {
        expect(res.body.error.code).toBe('SERVICE_AREA_CONFLICT');
      }
      expect(await openCount(kgNight.serviceAreaId)).toBe(1);
    }

    // Concurrent admin switches to different canteens: last one wins, never both.
    const switches = await Promise.all([
      switchArea(kgNight.serviceAreaId, kgDay.id),
      switchArea(kgNight.serviceAreaId, kgNight.id),
      switchArea(kgNight.serviceAreaId, kgDay.id),
    ]);
    expect(switches.every((res) => res.status === 200)).toBe(true);
    expect(await openCount(kgNight.serviceAreaId)).toBe(1);
  });

  it('different service areas operate independently', async () => {
    await switchArea(kgNight.serviceAreaId, kgDay.id).expect(200);
    const yn = await server.prisma.canteen.findUniqueOrThrow({ where: { id: ynNight.id } });
    expect(yn).toMatchObject({ isActive: true, isAcceptingOrders: true });
    const ynCoffee = await itemByName(server.prisma, ynNight.id, 'Coffee');
    await quote(ynNight.id, ynCoffee.id).expect(200);
  });

  it('existing orders keep their lifecycle after availability changes', async () => {
    const order = await placeOrder(server.app, student, kgNight.id, [
      { menuItemId: nightCoffee.id, quantity: 2 },
    ]);
    await payOrder(server.app, student, order.id);
    await switchArea(kgNight.serviceAreaId, kgDay.id).expect(200);

    for (const status of ['PREPARING', 'READY', 'COLLECTED'] as const) {
      const res = await api()
        .patch(`/api/staff/orders/${order.id}/status`)
        .set(bearer(kgNightStaff.token))
        .send({ status })
        .expect(200);
      expect(res.body.data.status).toBe(status);
    }
    const mine = await api().get(`/api/orders/${order.id}`).set(bearer(student.token)).expect(200);
    expect(mine.body.data).toMatchObject({
      status: 'COLLECTED',
      canteen: { id: kgNight.id, type: 'NIGHT' },
    });
  });

  it('activating an inactive canteen is refused for the area switch', async () => {
    await asAdmin(api().patch(`/api/admin/canteens/${kgDay.id}`))
      .send({ isActive: false })
      .expect(200);
    try {
      const res = await switchArea(kgNight.serviceAreaId, kgDay.id).expect(409);
      expect(res.body.error.code).toBe('CANTEEN_INACTIVE');
      expect(await openCount(kgNight.serviceAreaId)).toBe(1);
    } finally {
      await asAdmin(api().patch(`/api/admin/canteens/${kgDay.id}`))
        .send({ isActive: true })
        .expect(200);
    }
  });
});

describe('admin canteen management', () => {
  it('creates Day and Night canteens with generated slugs and safe defaults', async () => {
    const night = await asAdmin(api().post('/api/admin/canteens'))
      .send({ name: 'Tungabhadra Night Canteen', type: 'NIGHT', serviceAreaName: 'Tungabhadra' })
      .expect(201);
    expect(night.body.data).toMatchObject({
      type: 'NIGHT',
      slug: 'tungabhadra-night-canteen',
      isAcceptingOrders: true,
    });
    const areaId = night.body.data.serviceArea.id;

    // The Day canteen never silently closes its open sibling.
    const day = await asAdmin(api().post('/api/admin/canteens'))
      .send({ name: 'Tungabhadra Day Canteen', type: 'DAY', serviceAreaId: areaId })
      .expect(201);
    expect(day.body.data).toMatchObject({
      type: 'DAY',
      slug: 'tungabhadra-day-canteen',
      isAcceptingOrders: false,
      availability: { state: 'OTHER_SERVICE_ACTIVE' },
    });

    const third = await asAdmin(api().post('/api/admin/canteens'))
      .send({ name: 'Tungabhadra Late Canteen', type: 'NIGHT', serviceAreaId: areaId })
      .expect(409);
    expect(third.body.error.code).toBe('CANTEEN_TYPE_TAKEN');

    const explicit = await asAdmin(api().post('/api/admin/canteens'))
      .send({
        name: 'Other Area Day',
        type: 'DAY',
        serviceAreaId: areaId,
        isAcceptingOrders: true,
      })
      .expect(409);
    expect(['CANTEEN_TYPE_TAKEN', 'SERVICE_AREA_CONFLICT']).toContain(explicit.body.error.code);

    // A colliding name still gets a unique internal slug.
    const area2 = await asAdmin(api().post('/api/admin/service-areas'))
      .send({ name: 'Slug Collision' })
      .expect(201);
    await server.prisma.canteen.update({
      where: { id: night.body.data.id },
      data: { name: 'Renamed For Slug Test' },
    });
    const clash = await asAdmin(api().post('/api/admin/canteens'))
      .send({ name: 'Tungabhadra Night Canteen', type: 'NIGHT', serviceAreaId: area2.body.data.id })
      .expect(201);
    expect(clash.body.data.slug).toBe('tungabhadra-night-canteen-2');
  });

  it('edits details and type, and updates the canteen’s own schedule', async () => {
    const created = await asAdmin(api().post('/api/admin/canteens'))
      .send({ name: 'Kaveri Canteen', type: 'NIGHT', serviceAreaName: 'Kaveri' })
      .expect(201);
    const id = created.body.data.id;
    const edited = await asAdmin(api().patch(`/api/admin/canteens/${id}`))
      .send({ name: 'Kaveri Day Canteen', type: 'DAY', location: 'Kaveri block' })
      .expect(200);
    expect(edited.body.data).toMatchObject({
      name: 'Kaveri Day Canteen',
      type: 'DAY',
      location: 'Kaveri block',
      slug: created.body.data.slug,
    });
    await asAdmin(api().put(`/api/admin/canteens/${id}/services`))
      .send({ services: [{ period: 'DAY', isEnabled: true, override: 'AUTO' }] })
      .expect(200);
    const scheduled = await asAdmin(api().put(`/api/admin/canteens/${id}/services/DAY/schedule`))
      .send({
        schedules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          opensAtMinutes: 8 * 60,
          closesAtMinutes: 20 * 60,
        })),
      })
      .expect(200);
    expect(
      scheduled.body.data.services.find((s: { period: string }) => s.period === 'DAY').schedules,
    ).toHaveLength(7);
  });

  it('lists service areas with both canteens and their open canteen', async () => {
    const res = await asAdmin(api().get('/api/admin/service-areas')).expect(200);
    const kg = res.body.data.find((area: { id: string }) => area.id === kgNight.serviceAreaId);
    expectShape(serviceAreaSchema, kg);
    expect(kg.canteens.map((c: { type: string }) => c.type)).toEqual(['DAY', 'NIGHT']);
    expect(kg.hostels.map((h: { name: string }) => h.name)).toEqual(['Godavari', 'Krishna']);
    const list = await asAdmin(api().get('/api/admin/canteens')).expect(200);
    const row = list.body.data.find((c: { id: string }) => c.id === kgNight.id);
    expect(row.staffAccount).toMatchObject({ id: kgNightStaff.id });
  });
});

describe('public service-area directory (registration)', () => {
  it('lists active Day and Night canteens per area without authentication', async () => {
    const res = await api().get('/api/service-areas').expect(200);
    const areas = expectShape(serviceAreaDirectorySchema, res.body.data);
    const kg = areas.find((area) => area.id === kgNight.serviceAreaId)!;
    expect(kg.canteens.map((c) => c.type)).toEqual(['DAY', 'NIGHT']);
    expect(JSON.stringify(res.body)).not.toMatch(/isAcceptingOrders|upi|qr|staff/i);
  });
});

describe('dedicated staff accounts are isolated per canteen', () => {
  it('Day staff see only the Day canteen and cannot touch Night data', async () => {
    const me = await api().get('/api/auth/me').set(bearer(kgDayStaff.token)).expect(200);
    expect(me.body.data.canteen).toMatchObject({ id: kgDay.id, type: 'DAY' });
    const dash = await api().get('/api/staff/dashboard').set(bearer(kgDayStaff.token)).expect(200);
    expect(dash.body.data.canteen).toMatchObject({ id: kgDay.id, type: 'DAY' });

    await switchArea(kgNight.serviceAreaId, kgNight.id).expect(200);
    const nightOrder = await placeOrder(server.app, student, kgNight.id, [
      { menuItemId: nightCoffee.id, quantity: 1 },
    ]);
    await payOrder(server.app, student, nightOrder.id);

    const list = await api().get('/api/staff/orders').set(bearer(kgDayStaff.token)).expect(200);
    expect(list.body.data.map((o: { id: string }) => o.id)).not.toContain(nightOrder.id);
    await api().get(`/api/staff/orders/${nightOrder.id}`).set(bearer(kgDayStaff.token)).expect(404);
    await api()
      .patch(`/api/staff/orders/${nightOrder.id}/status`)
      .set(bearer(kgDayStaff.token))
      .send({ status: 'PREPARING' })
      .expect(404);
    await api()
      .patch(`/api/staff/menu/items/${nightCoffee.id}/price`)
      .set(bearer(kgDayStaff.token))
      .send({ pricePaise: 5_000 })
      .expect(404);
    expect(
      (await server.prisma.menuItem.findUniqueOrThrow({ where: { id: nightCoffee.id } }))
        .pricePaise,
    ).toBe(3_000);
    const menu = await api().get('/api/staff/menu').set(bearer(kgDayStaff.token)).expect(200);
    const names = menu.body.data.flatMap((c: { items: { canteenId: string }[] }) => c.items);
    expect(names.every((item: { canteenId: string }) => item.canteenId === kgDay.id)).toBe(true);
    for (const path of ['/api/staff/orders', '/api/staff/menu', '/api/staff/dashboard']) {
      await api()
        .get(path)
        .query({ canteenId: kgNight.id })
        .set(bearer(kgDayStaff.token))
        .expect(403);
    }
  });
});

describe('per-canteen payment QR codes', () => {
  it('uploads, previews, replaces and removes a QR; history is kept', async () => {
    const first = expectShape(
      qrOverviewSchema,
      (await uploadQr(kgDay.id, PNG, 'image/png').expect(200)).body.data,
    );
    expect(first.canteen).toMatchObject({ id: kgDay.id, type: 'DAY' });
    expect(first.active).toMatchObject({ contentType: 'image/png', isActive: true });
    expect(first.studentSees).toBe('PLACEHOLDER');
    const img = await api().get(first.active!.url).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(Buffer.from(img.body as Buffer).equals(PNG)).toBe(true);

    const second = (await uploadQr(kgDay.id, JPEG, 'image/jpeg').expect(200)).body.data;
    expect(second.active.id).not.toBe(first.active!.id);
    expect(second.history).toHaveLength(2);
    expect(second.history.filter((row: { isActive: boolean }) => row.isActive)).toHaveLength(1);
    // The replaced image is no longer served.
    await api().get(first.active!.url).expect(404);

    const removed = (await asAdmin(api().delete(`/api/admin/canteens/${kgDay.id}/qr`)).expect(200))
      .body.data;
    expect(removed.active).toBeNull();
    expect(removed.history).toHaveLength(2);
    await api().get(second.active.url).expect(404);
    await asAdmin(api().delete(`/api/admin/canteens/${kgDay.id}/qr`)).expect(404);
  });

  it('rejects unsafe or invalid uploads and non-admin callers', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect((await uploadQr(kgNight.id, svg, 'image/svg+xml').expect(422)).body.error.code).toBe(
      'QR_IMAGE_TYPE_INVALID',
    );
    // Declared type must match the bytes.
    expect((await uploadQr(kgNight.id, PNG, 'image/jpeg').expect(422)).body.error.code).toBe(
      'QR_IMAGE_TYPE_INVALID',
    );
    expect(
      (await uploadQr(kgNight.id, Buffer.from('hello'), 'text/plain').expect(422)).body.error.code,
    ).toBe('QR_IMAGE_TYPE_INVALID');
    const huge = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    expect([413, 422]).toContain((await uploadQr(kgNight.id, huge, 'image/png')).status);
    await uploadQr(kgNight.id, PNG, 'image/png', kgNightStaff.token).expect(403);
    await uploadQr(kgNight.id, PNG, 'image/png', student.token).expect(403);
    expect(await server.prisma.canteenQrCode.count({ where: { canteenId: kgNight.id } })).toBe(0);
  });

  it('students get their order’s own canteen QR, always the latest one', async () => {
    await switchArea(kgNight.serviceAreaId, kgNight.id).expect(200);
    const order = await placeOrder(server.app, student, kgNight.id, [
      { menuItemId: nightCoffee.id, quantity: 1 },
    ]);
    const config = async () =>
      expectShape(
        orderPaymentConfigSchema,
        (
          await api()
            .get(`/api/payments/${order.id}/payment-config`)
            .set(bearer(student.token))
            .expect(200)
        ).body.data,
      );

    // Test mode: a labelled DEMO placeholder, never an uploaded QR.
    await uploadQr(kgNight.id, PNG, 'image/png').expect(200);
    const demo = await config();
    expect(demo.canteen).toMatchObject({ id: kgNight.id, type: 'NIGHT' });
    expect(demo.mode).toBe('DEMO');
    expect(demo.qr).toBeNull();
    expect(demo.demoQr?.warning).toBe('DEMO ONLY — NOT PAYABLE');
    expect(demo.demoQr?.payload).toBe(`SERVE-DEMO:${kgNight.id}`);

    // Live: the uploaded QR of THIS canteen.
    await asAdmin(api().put(`/api/admin/canteens/${kgNight.id}/payment-config`))
      .send({ mode: 'LIVE', upiVpa: 'kgnight@okaxis', merchantName: 'K&G Night Canteen' })
      .expect(200);
    const live = await config();
    expect(live.mode).toBe('LIVE');
    expect(live.demoQr).toBeNull();
    const firstQrUrl = live.qr!.url;

    const otherConfig = await asAdmin(api().get(`/api/admin/canteens/${ynNight.id}/qr`)).expect(
      200,
    );
    expect(otherConfig.body.data.active).toBeNull();

    // Replace: the very next fetch returns the new QR.
    await uploadQr(kgNight.id, PNG2, 'image/png').expect(200);
    const replaced = await config();
    expect(replaced.qr!.url).not.toBe(firstQrUrl);
    const bytes = await api().get(replaced.qr!.url).expect(200);
    expect(Buffer.from(bytes.body as Buffer).equals(PNG2)).toBe(true);

    // Live payments need a QR: removal is refused until test mode.
    expect(
      (await asAdmin(api().delete(`/api/admin/canteens/${kgNight.id}/qr`)).expect(409)).body.error
        .code,
    ).toBe('QR_REQUIRED_FOR_LIVE');

    // Showing a QR never marks anything paid.
    const stillPlaced = await api()
      .get(`/api/orders/${order.id}`)
      .set(bearer(student.token))
      .expect(200);
    expect(stillPlaced.body.data).toMatchObject({ status: 'PLACED' });
    expect(stillPlaced.body.data.payment.status).toBe('PENDING');

    // Another student's order is not visible.
    const other = await newStudent(server.app, server.prisma, 'Godavari');
    await api()
      .get(`/api/payments/${order.id}/payment-config`)
      .set(bearer(other.token))
      .expect(404);

    await asAdmin(api().put(`/api/admin/canteens/${kgNight.id}/payment-config`))
      .send({ mode: 'DEMO' })
      .expect(200);
  });
});

describe('realtime synchronisation', () => {
  it('pushes area switches and QR replacements to subscribed students', async () => {
    await switchArea(kgNight.serviceAreaId, kgNight.id).expect(200);
    const socket = await server.connect(student.token);
    expect((await subscribeMenu(socket, kgNight.id)).ok).toBe(true);

    const status = nextEvent<{ canteenId: string; isAcceptingOrders: boolean }>(
      socket,
      'canteen.status_changed',
      (d) => d.canteenId === kgNight.id,
    );
    const area = nextEvent<{ serviceAreaId: string; openCanteenId: string | null }>(
      socket,
      'service_area.updated',
    );
    await switchArea(kgNight.serviceAreaId, kgDay.id).expect(200);
    expect(await status).toMatchObject({ canteenId: kgNight.id, isAcceptingOrders: false });
    expect(await area).toEqual({ serviceAreaId: kgNight.serviceAreaId, openCanteenId: kgDay.id });

    const qr = nextEvent<{ canteenId: string; qrId: string | null }>(
      socket,
      'canteen.payment_qr_updated',
    );
    await uploadQr(kgNight.id, JPEG, 'image/jpeg').expect(200);
    expect((await qr).canteenId).toBe(kgNight.id);
    socket.disconnect();
  });
});

describe('menu management prices the canteen’s own period', () => {
  it('a Day canteen’s new item gets a DAY price and is orderable once Day serves', async () => {
    const menu = await api().get('/api/staff/menu').set(bearer(kgDayStaff.token)).expect(200);
    const categoryId = menu.body.data[0].id as string;
    const created = await api()
      .post('/api/staff/menu/items')
      .set(bearer(kgDayStaff.token))
      .send({ categoryId, name: 'Filter Coffee Large', pricePaise: 4_000 })
      .expect(201);
    const rows = await server.prisma.menuItemService.findMany({
      where: { menuItemId: created.body.data.id },
    });
    expect(rows.map((row) => [row.period, row.pricePaise])).toEqual([['DAY', 4_000]]);

    await api()
      .patch(`/api/staff/menu/items/${created.body.data.id}/price`)
      .set(bearer(kgDayStaff.token))
      .send({ pricePaise: 4_500 })
      .expect(200);
    await switchArea(kgNight.serviceAreaId, kgDay.id).expect(200);
    const quoted = await quote(kgDay.id, created.body.data.id).expect(200);
    expect(quoted.body.data).toMatchObject({ servicePeriod: 'DAY', totalPaise: 4_500 });

    const recs = await api()
      .get('/api/students/me/recommendations')
      .query({ canteenId: kgDay.id })
      .set(bearer(student.token))
      .expect(200);
    expect(recs.body.data.items.length).toBeGreaterThan(0);
    await switchArea(kgNight.serviceAreaId, kgNight.id).expect(200);
  });
});
