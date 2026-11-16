import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { createAreaScheduler } from '../../src/modules/admin/area-scheduler.js';
import { publishOrderTaking } from '../../src/modules/canteens/order-taking-events.js';
import { truncateAll } from '../helpers/db.js';
import {
  bearer,
  canteenBySlug,
  itemByName,
  newAdmin,
  newApprovedStaff,
  newStudent,
  payOrder,
  placeOrder,
  type Actor,
} from '../helpers/actors.js';
import { expectShape, serviceAreaSchema, studentServiceSchema } from '../helpers/contract.js';
import { nextEvent, startTestServer, subscribeMenu, type TestServer } from '../helpers/realtime.js';

/**
 * Automatic Day/Night switching on the server, manual overrides, and the
 * rule that a staff pause is never lifted by the schedule.
 * Real PostgreSQL, real Firebase Auth Emulator, real Socket.IO. The server
 * clock is injected so each test controls "now".
 */

/** 2026-11-16 at hh:mm in Asia/Kolkata (UTC+05:30). */
const ist = (hours: number, minutes = 0, day = 16) =>
  new Date(Date.UTC(2026, 10, day, hours, minutes) - (5 * 60 + 30) * 60_000);

let now = ist(12);
const clock = () => now;

let server: TestServer;
let admin: Actor;
let student: Actor;
let nightStaff: Actor;
let dayStaff: Actor;
let kgNight: { id: string; serviceAreaId: string };
let kgDay: { id: string; serviceAreaId: string };
let nightCoffee: { id: string };
let dayCoffee: { id: string };
let areaId: string;

const api = () => request(server.app);
const asAdmin = (req: request.Test) => req.set(bearer(admin.token));
const schedulerFor = () =>
  createAreaScheduler({
    prisma: server.prisma,
    logger: server.ctx.logger,
    publish: (ids) => publishOrderTaking(server.prisma, server.ctx.events, ids),
    clock,
  });

// Day 07:00–17:00, Night 18:00–06:00.
const SCHEDULE = {
  autoSwitchEnabled: true,
  timezone: 'Asia/Kolkata',
  day: { opensAt: '07:00', closesAt: '17:00' },
  night: { opensAt: '18:00', closesAt: '06:00' },
};

function putSchedule(body: Record<string, unknown>) {
  return asAdmin(api().put(`/api/admin/service-areas/${areaId}/schedule`)).send(body);
}
function switchArea(canteenId: string | null, until?: string) {
  return asAdmin(api().put(`/api/admin/service-areas/${areaId}/active-canteen`)).send(
    until === undefined ? { canteenId } : { canteenId, until },
  );
}
async function onDuty() {
  const rows = await server.prisma.canteen.findMany({
    where: { serviceAreaId: areaId, isActive: true, isAcceptingOrders: true },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
async function area() {
  return expectShape(
    serviceAreaSchema,
    (await asAdmin(api().get(`/api/admin/service-areas/${areaId}`)).expect(200)).body.data,
  );
}
function quote(canteenId: string, menuItemId: string) {
  return api()
    .post('/api/cart/quote')
    .set(bearer(student.token))
    .send({ canteenId, items: [{ menuItemId, quantity: 1 }] });
}
function staffStatus(actor: Actor, isAcceptingOrders: boolean) {
  return api()
    .patch('/api/staff/canteen/status')
    .set(bearer(actor.token))
    .send({ isAcceptingOrders });
}

beforeAll(async () => {
  server = await startTestServer({ clock });
  await truncateAll(server.prisma);
  await seedDatabase(server.prisma);
  kgNight = await canteenBySlug(server.prisma, 'krishna-godavari');
  kgDay = await canteenBySlug(server.prisma, 'krishna-godavari-day');
  areaId = kgNight.serviceAreaId;
  nightCoffee = await itemByName(server.prisma, kgNight.id, 'Coffee');
  dayCoffee = await itemByName(server.prisma, kgDay.id, 'Coffee');
  admin = await newAdmin(server.prisma, server.ctx.env);
  student = await newStudent(server.app, server.prisma, 'Krishna');
  nightStaff = await newApprovedStaff(server.app, admin, kgNight.id);
  dayStaff = await newApprovedStaff(server.app, admin, kgDay.id);
});
afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  // Known state: manual mode, Night on duty, nobody paused.
  now = ist(12);
  await putSchedule({ ...SCHEDULE, autoSwitchEnabled: false }).expect(200);
  await switchArea(kgNight.id).expect(200);
  await server.prisma.canteen.updateMany({
    where: { serviceAreaId: areaId },
    data: { isPaused: false },
  });
});

describe('area schedule settings', () => {
  it('validates the schedule and rejects overlaps, half-set hours and bad zones', async () => {
    const overlap = await putSchedule({
      ...SCHEDULE,
      night: { opensAt: '16:00', closesAt: '06:00' },
    }).expect(422);
    expect(overlap.body.error.code).toBe('INVALID_AREA_SCHEDULE');
    expect(
      (await putSchedule({ ...SCHEDULE, timezone: 'Mars/Olympus' }).expect(422)).body.error.code,
    ).toBe('INVALID_AREA_SCHEDULE');
    await putSchedule({ ...SCHEDULE, day: { opensAt: '7:00', closesAt: '17:00' } }).expect(422);
    await putSchedule({ ...SCHEDULE, day: null, night: null }).expect(422);
    // Nothing was saved.
    expect((await area()).schedule.autoSwitchEnabled).toBe(false);
  });

  it('turning automatic switching on applies the schedule at once', async () => {
    now = ist(12);
    const saved = expectShape(
      serviceAreaSchema,
      (await putSchedule(SCHEDULE).expect(200)).body.data,
    );
    expect(saved).toMatchObject({
      mode: 'AUTOMATIC',
      scheduledTarget: 'DAY',
      openCanteenId: kgDay.id,
      override: null,
      schedule: SCHEDULE,
      nextTransition: { at: ist(17).toISOString(), target: 'NONE' },
    });
    expect(await onDuty()).toEqual([kgDay.id]);
  });

  it('staff and students cannot change the schedule', async () => {
    await api()
      .put(`/api/admin/service-areas/${areaId}/schedule`)
      .set(bearer(dayStaff.token))
      .send(SCHEDULE)
      .expect(403);
    await api()
      .put(`/api/admin/service-areas/${areaId}/schedule`)
      .set(bearer(student.token))
      .send(SCHEDULE)
      .expect(403);
  });
});

describe('automatic switching', () => {
  beforeEach(async () => {
    await putSchedule(SCHEDULE).expect(200);
  });

  it('switches Day → closed → Night → closed → Day as the server clock moves', async () => {
    const scheduler = schedulerFor();
    const steps: [Date, string[]][] = [
      [ist(16, 59), [kgDay.id]],
      [ist(17), []],
      [ist(18), [kgNight.id]],
      [ist(2, 0, 17), [kgNight.id]],
      [ist(6, 0, 17), []],
      [ist(7, 0, 17), [kgDay.id]],
    ];
    for (const [at, expected] of steps) {
      now = at;
      await scheduler.tick(at);
      expect(await onDuty()).toEqual(expected);
    }
  });

  it('students see the right canteen and a clear closed-by-schedule state', async () => {
    now = ist(17, 30);
    await schedulerFor().tick(now);
    const service = expectShape(
      studentServiceSchema,
      (await api().get('/api/students/me/service').set(bearer(student.token)).expect(200)).body
        .data,
    );
    expect(service.unavailable).toBe(true);
    const night = service.canteens.find((c) => c.id === kgNight.id)!;
    expect(night.availability).toMatchObject({
      state: 'CLOSED_BY_SCHEDULE',
      message: 'Closed by schedule. Opens at 18:00.',
    });
    expect((await quote(kgNight.id, nightCoffee.id).expect(409)).body.error.code).toBe(
      'CANTEEN_NOT_ACCEPTING_ORDERS',
    );
    await quote(kgDay.id, dayCoffee.id).expect(409);
  });

  it('is idempotent: a pass with nothing to change writes and emits nothing', async () => {
    const scheduler = schedulerFor();
    now = ist(12);
    await scheduler.tick(now);
    const before = await server.prisma.canteen.findMany({
      where: { serviceAreaId: areaId },
      select: { id: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });
    for (let i = 0; i < 3; i += 1) {
      expect((await scheduler.reconcileArea(areaId, now)).length).toBe(0);
    }
    const after = await server.prisma.canteen.findMany({
      where: { serviceAreaId: areaId },
      select: { id: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });
    expect(after).toEqual(before);
  });

  it('restores the right state after a restart, whatever was left behind', async () => {
    // Simulate a crash that left the wrong canteen on duty during Day hours.
    now = ist(10);
    await server.prisma.$transaction([
      server.prisma.canteen.update({ where: { id: kgDay.id }, data: { isAcceptingOrders: false } }),
      server.prisma.canteen.update({
        where: { id: kgNight.id },
        data: { isAcceptingOrders: true },
      }),
    ]);
    // A fresh scheduler instance (new process) fixes it on its first pass.
    const fresh = schedulerFor();
    const result = await fresh.tick(now);
    expect(result.changed.sort()).toEqual([kgDay.id, kgNight.id].sort());
    expect(await onDuty()).toEqual([kgDay.id]);
  });

  it('concurrent passes from several processes never put both canteens on duty', async () => {
    for (const at of [ist(18), ist(10), ist(17, 30), ist(20)]) {
      now = at;
      const results = await Promise.all(
        Array.from({ length: 6 }, () => schedulerFor().reconcileArea(areaId, at)),
      );
      // Exactly one pass did the work; the others found nothing to change.
      expect(results.filter((changed) => changed.length > 0).length).toBeLessThanOrEqual(1);
      expect((await onDuty()).length).toBeLessThanOrEqual(1);
    }
    expect(await onDuty()).toEqual([kgNight.id]);
  });

  it('a scheduler pass racing an admin switch leaves exactly one consistent state', async () => {
    now = ist(10);
    await schedulerFor().tick(now);
    for (let round = 0; round < 5; round += 1) {
      await Promise.all([
        schedulerFor().reconcileArea(areaId, now),
        switchArea(kgNight.id, 'UNTIL_RESTORED'),
        schedulerFor().reconcileArea(areaId, now),
      ]);
      expect(await onDuty()).toEqual([kgNight.id]);
      expect((await area()).mode).toBe('MANUAL_OVERRIDE');
      await asAdmin(api().delete(`/api/admin/service-areas/${areaId}/override`)).expect(200);
      expect(await onDuty()).toEqual([kgDay.id]);
    }
  });

  it('emits realtime events to students and admins when the schedule switches', async () => {
    now = ist(16, 59);
    await schedulerFor().tick(now);
    const socket = await server.connect(student.token);
    expect((await subscribeMenu(socket, kgNight.id)).ok).toBe(true);
    const adminSocket = await server.connect(admin.token);
    const status = nextEvent<{ canteenId: string; isAcceptingOrders: boolean }>(
      socket,
      'canteen.status_changed',
      (data) => data.canteenId === kgNight.id,
    );
    const areaEvent = nextEvent<{ serviceAreaId: string; openCanteenId: string | null }>(
      adminSocket,
      'service_area.updated',
      (data) => data.serviceAreaId === areaId && data.openCanteenId === kgNight.id,
    );
    now = ist(18);
    await schedulerFor().tick(now);
    expect(await status).toMatchObject({ canteenId: kgNight.id, isAcceptingOrders: true });
    expect(await areaEvent).toMatchObject({ openCanteenId: kgNight.id });
    socket.disconnect();
    adminSocket.disconnect();
  });

  it('never changes existing orders when the service switches', async () => {
    now = ist(10);
    await schedulerFor().tick(now);
    const order = await placeOrder(server.app, student, kgDay.id, [
      { menuItemId: dayCoffee.id, quantity: 1 },
    ]);
    await payOrder(server.app, student, order.id);
    const before = await server.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    now = ist(18);
    await schedulerFor().tick(now);
    const after = await server.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toEqual(before);
    // The Day kitchen can still complete it while off duty.
    await api()
      .patch(`/api/staff/orders/${order.id}/status`)
      .set(bearer(dayStaff.token))
      .send({ status: 'PREPARING' })
      .expect(200);
  });
});

describe('manual override', () => {
  beforeEach(async () => {
    await putSchedule(SCHEDULE).expect(200);
  });

  it('lasts until the next scheduled transition by default', async () => {
    now = ist(10);
    const res = expectShape(
      serviceAreaSchema,
      (await switchArea(kgNight.id).expect(200)).body.data,
    );
    expect(res).toMatchObject({
      mode: 'MANUAL_OVERRIDE',
      openCanteenId: kgNight.id,
      scheduledTarget: 'DAY',
      override: { target: 'NIGHT', until: ist(17).toISOString() },
    });
    const scheduler = schedulerFor();
    now = ist(16, 59);
    await scheduler.tick(now);
    expect(await onDuty()).toEqual([kgNight.id]);
    // At the next transition the override ends and the schedule (closed) applies.
    now = ist(17);
    await scheduler.tick(now);
    expect(await onDuty()).toEqual([]);
    expect(await area()).toMatchObject({ mode: 'AUTOMATIC', override: null });
  });

  it('can last until a chosen time, or until an admin restores automatic', async () => {
    now = ist(10);
    await switchArea(null, ist(11).toISOString()).expect(200);
    const scheduler = schedulerFor();
    now = ist(10, 59);
    await scheduler.tick(now);
    expect(await onDuty()).toEqual([]);
    now = ist(11);
    await scheduler.tick(now);
    expect(await onDuty()).toEqual([kgDay.id]);

    await switchArea(kgNight.id, 'UNTIL_RESTORED').expect(200);
    for (const at of [ist(17, 30), ist(7, 0, 17), ist(12, 0, 18)]) {
      now = at;
      await scheduler.tick(now);
      expect(await onDuty()).toEqual([kgNight.id]);
    }
    expect((await area()).override).toMatchObject({ target: 'NIGHT', until: null });
    const restored = await asAdmin(
      api().delete(`/api/admin/service-areas/${areaId}/override`),
    ).expect(200);
    expect(restored.body.data).toMatchObject({ mode: 'AUTOMATIC', openCanteenId: kgDay.id });
    expect(await onDuty()).toEqual([kgDay.id]);
  });

  it('rejects an override that ends in the past', async () => {
    now = ist(10);
    const res = await switchArea(kgNight.id, ist(9).toISOString()).expect(422);
    expect(res.body.error.code).toBe('INVALID_OVERRIDE_UNTIL');
    expect(await onDuty()).toEqual([kgDay.id]);
  });

  it('a manual choice equal to the schedule is not an override', async () => {
    now = ist(10);
    expect((await switchArea(kgDay.id).expect(200)).body.data).toMatchObject({
      mode: 'AUTOMATIC',
      override: null,
    });
  });

  it('turning automatic switching off clears the override and keeps the current state', async () => {
    now = ist(10);
    await switchArea(kgNight.id, 'UNTIL_RESTORED').expect(200);
    const off = await putSchedule({ ...SCHEDULE, autoSwitchEnabled: false }).expect(200);
    expect(off.body.data).toMatchObject({ mode: 'MANUAL', override: null, nextTransition: null });
    now = ist(12);
    await schedulerFor().tick(now);
    expect(await onDuty()).toEqual([kgNight.id]);
  });

  it('an admin on-duty change from the canteen page also overrides the schedule', async () => {
    now = ist(10);
    await asAdmin(api().patch(`/api/admin/canteens/${kgDay.id}`))
      .send({ isAcceptingOrders: false })
      .expect(200);
    expect(await area()).toMatchObject({
      mode: 'MANUAL_OVERRIDE',
      override: { target: 'NONE', until: ist(17).toISOString() },
    });
    await schedulerFor().tick(now);
    expect(await onDuty()).toEqual([]);
  });
});

describe('a staff pause is never undone by the schedule', () => {
  beforeEach(async () => {
    await putSchedule(SCHEDULE).expect(200);
  });

  it('survives Night → Day → Night switches until staff resume', async () => {
    now = ist(20);
    await schedulerFor().tick(now);
    await staffStatus(nightStaff, false).expect(200);
    expect((await quote(kgNight.id, nightCoffee.id).expect(409)).body.error.code).toBe(
      'CANTEEN_NOT_ACCEPTING_ORDERS',
    );

    for (const at of [ist(10, 0, 17), ist(20, 0, 17)]) {
      now = at;
      await schedulerFor().tick(now);
    }
    const night = await server.prisma.canteen.findUniqueOrThrow({ where: { id: kgNight.id } });
    expect(night).toMatchObject({ isAcceptingOrders: true, isPaused: true });
    const shown = await api().get(`/api/canteens/${kgNight.id}`).set(bearer(student.token));
    expect(shown.body.data.availability.state).toBe('PAUSED');
    await quote(kgNight.id, nightCoffee.id).expect(409);

    const resumed = await staffStatus(nightStaff, true).expect(200);
    expect(resumed.body.data).toMatchObject({ isAcceptingOrders: true, isPaused: false });
    await quote(kgNight.id, nightCoffee.id).expect(200);
  });

  it('staff can lift their own pause while off duty, but cannot override the schedule', async () => {
    now = ist(20);
    await schedulerFor().tick(now);
    await staffStatus(dayStaff, false).expect(200);
    // Lifting the pause while Night serves is allowed and changes nothing else.
    const lifted = await staffStatus(dayStaff, true).expect(200);
    expect(lifted.body.data).toMatchObject({ isAcceptingOrders: false, isPaused: false });
    // Asking to go on duty while Night serves is refused.
    expect((await staffStatus(dayStaff, true).expect(409)).body.error.code).toBe(
      'SERVICE_AREA_CONFLICT',
    );
    // In the closed gap the schedule decides: refused with a clear code.
    now = ist(17, 30);
    await schedulerFor().tick(now);
    const refused = await staffStatus(dayStaff, true).expect(409);
    expect(refused.body.error.code).toBe('CLOSED_BY_SCHEDULE');
    expect(await onDuty()).toEqual([]);
  });

  it('an admin can pause and resume a canteen without changing the schedule', async () => {
    now = ist(10);
    await schedulerFor().tick(now);
    const paused = await asAdmin(api().patch(`/api/admin/canteens/${kgDay.id}`))
      .send({ isPaused: true })
      .expect(200);
    expect(paused.body.data).toMatchObject({
      isAcceptingOrders: true,
      isPaused: true,
      availability: { state: 'PAUSED' },
    });
    expect((await area()).mode).toBe('AUTOMATIC');
    await asAdmin(api().patch(`/api/admin/canteens/${kgDay.id}`))
      .send({ isPaused: false })
      .expect(200);
    await quote(kgDay.id, dayCoffee.id).expect(200);
  });
});
