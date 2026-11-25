import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed.js';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import type { EventPublisher, RealtimeEvent } from '../../src/realtime/events.js';
import { createUnpaidOrderExpiry } from '../../src/modules/payments/unpaid-order-expiry.js';
import { buildTestContext } from '../helpers/test-app.js';
import { truncateAll } from '../helpers/db.js';
import { expectShape, page, staffOrderSchema } from '../helpers/contract.js';
import {
  bearer,
  canteenBySlug,
  itemByName,
  newAdmin,
  newApprovedStaff,
  newStudent,
  placeOrder,
  type Actor,
} from '../helpers/actors.js';

/**
 * UPI claim queue: the student's "I've paid" claim, the cashier's queue
 * (claimed first, oldest claim first, paginated, live), and expiry of
 * abandoned orders — including the races between them. Real API, real
 * PostgreSQL; only the realtime publisher is a recorder.
 */
const published: RealtimeEvent[] = [];
const recorder: EventPublisher = {
  publish: (events) => void published.push(...events),
  apply: () => undefined,
};
const ctx = buildTestContext({ events: recorder });
const app = createApp(ctx);
const { prisma, env } = ctx;
const WINDOW_MS = env.UNPAID_ORDER_EXPIRY_MINUTES * 60_000;
const later = (ms: number) => () => new Date(Date.now() + ms);
const expiry = (clock = later(WINDOW_MS + 60_000)) =>
  createUnpaidOrderExpiry({
    prisma,
    events: recorder,
    logger: createLogger(env),
    env,
    clock,
  });

let admin: Actor;
let cashier: Actor;
let otherCashier: Actor;
let alice: Actor;
let bob: Actor;
let kg: { id: string };
let yn: { id: string };
let coffee: { id: string };

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  kg = await canteenBySlug(prisma, 'krishna-godavari');
  yn = await canteenBySlug(prisma, 'yamuna-narmada');
  coffee = await itemByName(prisma, kg.id, 'Coffee');
  admin = await newAdmin(prisma, env);
  cashier = await newApprovedStaff(app, admin, kg.id);
  otherCashier = await newApprovedStaff(app, admin, yn.id);
  await capabilities(cashier, kg.id, ['CASHIER', 'KITCHEN']);
  alice = await newStudent(app, prisma);
  bob = await newStudent(app, prisma);
});
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  published.length = 0;
});

async function capabilities(staff: Actor, canteenId: string, list: string[]) {
  await request(app)
    .put(`/api/admin/staff/${staff.id}/assignments`)
    .set(bearer(admin.token))
    .send({ primaryCanteenId: canteenId, assignments: [{ canteenId, capabilities: list }] })
    .expect(200);
}

const order = (student: Actor) =>
  placeOrder(app, student, kg.id, [{ menuItemId: coffee.id, quantity: 1 }]);
const claim = (student: Actor, orderId: string, utr?: string) =>
  request(app)
    .post(`/api/payments/${orderId}/claim`)
    .set(bearer(student.token))
    .send(utr ? { utr } : {});
const queue = async (section: 'claimed' | 'unclaimed', query = '') =>
  (
    await request(app)
      .get(`/api/staff/payments/pending?section=${section}${query}`)
      .set(bearer(cashier.token))
      .expect(200)
  ).body as { data: QueueRow[]; nextCursor: string | null };
interface QueueRow {
  id: string;
  status: string;
  payment: {
    status: string;
    claimedAt: string | null;
    paymentDueAt: string | null;
    expiredAt: string | null;
    utr: string | null;
  };
}
const queueEvents = () => published.filter((e) => e.name === 'payment.queue_changed');
const confirm = (orderId: string) =>
  request(app)
    .post(`/api/staff/orders/${orderId}/confirm-demo-payment`)
    .set(bearer(cashier.token))
    .send({ simulatedPaymentReceived: true });
const paymentOf = (orderId: string) => prisma.payment.findUniqueOrThrow({ where: { orderId } });

describe('placing an order', () => {
  it('sets the payment deadline and tells the cashiers (ids only)', async () => {
    const before = Date.now();
    const placed = await order(alice);
    const payment = await paymentOf(placed.id);
    expect(payment.claimedAt).toBeNull();
    expect(payment.paymentDueAt!.getTime()).toBeGreaterThanOrEqual(before + WINDOW_MS - 1000);
    expect(payment.paymentDueAt!.getTime()).toBeLessThanOrEqual(Date.now() + WINDOW_MS + 1000);
    expect(queueEvents()).toEqual([
      {
        name: 'payment.queue_changed',
        rooms: [`canteen:${kg.id}`],
        payload: { canteenId: kg.id, orderId: placed.id, change: 'placed' },
      },
    ]);
  });
});

describe('claiming payment ("I\'ve paid")', () => {
  it('records the claim time and UTR, but never confirms the payment', async () => {
    const placed = await order(alice);
    published.length = 0;
    const res = await claim(alice, placed.id, 'UTR123456').expect(200);
    expect(res.body.data.status).toBe('PLACED');
    expect(res.body.data.payment).toMatchObject({ status: 'PENDING', utr: 'UTR123456' });
    expect(res.body.data.payment.claimedAt).toEqual(expect.any(String));
    const payment = await paymentOf(placed.id);
    expect(payment).toMatchObject({ status: 'PENDING', utr: 'UTR123456', paidAt: null });
    expect(payment.claimedAt).toBeInstanceOf(Date);
    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(orderRow).toMatchObject({ status: 'PLACED', paidAt: null, receiptNumber: null });
    // The cashiers hear about it; the student's details are not broadcast.
    expect(queueEvents()).toEqual([
      expect.objectContaining({
        rooms: [`canteen:${kg.id}`],
        payload: { canteenId: kg.id, orderId: placed.id, change: 'claimed' },
      }),
    ]);
  });

  it('is idempotent: a repeat keeps the first claim time and emits nothing', async () => {
    const placed = await order(alice);
    await claim(alice, placed.id).expect(200);
    const first = await paymentOf(placed.id);
    published.length = 0;
    await claim(alice, placed.id).expect(200);
    await claim(alice, placed.id).expect(200);
    const again = await paymentOf(placed.id);
    expect(again.claimedAt).toEqual(first.claimedAt);
    expect(queueEvents()).toHaveLength(0);
  });

  it('a later UTR is recorded without changing the claim time (one event)', async () => {
    const placed = await order(alice);
    await claim(alice, placed.id).expect(200);
    const first = await paymentOf(placed.id);
    published.length = 0;
    await claim(alice, placed.id, 'LATERUTR99').expect(200);
    await claim(alice, placed.id, 'LATERUTR99').expect(200);
    const updated = await paymentOf(placed.id);
    expect(updated.utr).toBe('LATERUTR99');
    expect(updated.claimedAt).toEqual(first.claimedAt);
    expect(queueEvents()).toHaveLength(1);
  });

  it('concurrent duplicate claims record one claim', async () => {
    const placed = await order(alice);
    published.length = 0;
    const results = await Promise.all(Array.from({ length: 5 }, () => claim(alice, placed.id)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(queueEvents()).toHaveLength(1);
  });

  it('refuses paid, cancelled and other students’ orders', async () => {
    const paid = await order(alice);
    await confirm(paid.id).expect(200);
    expect((await claim(alice, paid.id).expect(409)).body.error.code).toBe('ALREADY_PAID');

    const cancelled = await order(alice);
    await request(app)
      .post(`/api/orders/${cancelled.id}/cancel`)
      .set(bearer(alice.token))
      .expect(200);
    expect((await claim(alice, cancelled.id).expect(409)).body.error.code).toBe(
      'ORDER_NOT_AWAITING_PAYMENT',
    );

    const alices = await order(alice);
    await claim(bob, alices.id).expect(404);
    expect((await paymentOf(alices.id)).claimedAt).toBeNull();
  });

  it('only a student can claim, only with a session', async () => {
    const placed = await order(alice);
    await request(app).post(`/api/payments/${placed.id}/claim`).send({}).expect(401);
    await request(app)
      .post(`/api/payments/${placed.id}/claim`)
      .set(bearer(cashier.token))
      .send({})
      .expect(403);
  });
});

describe('the cashier queue', () => {
  it('lists claimed orders oldest claim first, apart from unclaimed ones', async () => {
    await prisma.payment.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'FAILED', failureReason: 'test reset' },
    });
    const first = await order(alice);
    const second = await order(bob);
    const unclaimed = await order(alice);
    // Claimed in the opposite order from placement: claim time decides.
    await claim(bob, second.id).expect(200);
    await claim(alice, first.id).expect(200);

    const claimed = await queue('claimed');
    // Every row matches the shared (strict) contract, new payment fields included.
    expectShape(page(staffOrderSchema), claimed);
    expect(claimed.data.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(claimed.data.every((row) => row.payment.claimedAt !== null)).toBe(true);
    const open = await queue('unclaimed');
    expect(open.data.map((row) => row.id)).toEqual([unclaimed.id]);
    expect(open.data[0]!.payment.paymentDueAt).toEqual(expect.any(String));
    // Default section is the claimed queue.
    const defaults = await request(app)
      .get('/api/staff/payments/pending')
      .set(bearer(cashier.token))
      .expect(200);
    expect(defaults.body.data.map((row: QueueRow) => row.id)).toEqual([second.id, first.id]);
  });

  it('paginates without losing or repeating claims, even as the queue changes', async () => {
    await prisma.payment.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'FAILED', failureReason: 'test reset' },
    });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const placed = await order(i % 2 ? bob : alice);
      await claim(i % 2 ? bob : alice, placed.id).expect(200);
      ids.push(placed.id);
    }
    const page1 = await queue('claimed', '&limit=2');
    expect(page1.data.map((r) => r.id)).toEqual(ids.slice(0, 2));
    expect(page1.nextCursor).not.toBeNull();
    // A newer claim arrives while the cashier pages: it goes to the end.
    const newer = await order(alice);
    await claim(alice, newer.id).expect(200);
    const page2 = await queue('claimed', `&limit=2&cursor=${page1.nextCursor}`);
    expect(page2.data.map((r) => r.id)).toEqual(ids.slice(2, 4));
    const page3 = await queue('claimed', `&limit=2&cursor=${page2.nextCursor}`);
    expect(page3.data.map((r) => r.id)).toEqual([ids[4], newer.id]);
    expect(page3.nextCursor).toBeNull();
  });

  it('is limited to cashiers of that canteen', async () => {
    await capabilities(cashier, kg.id, ['KITCHEN']);
    await request(app)
      .get('/api/staff/payments/pending?section=claimed')
      .set(bearer(cashier.token))
      .expect(403);
    await capabilities(cashier, kg.id, ['CASHIER', 'KITCHEN']);
    await request(app)
      .get('/api/staff/payments/pending?section=claimed')
      .set(bearer(alice.token))
      .expect(403);
    // Another canteen's cashier never sees this canteen's claims.
    const placed = await order(alice);
    await claim(alice, placed.id).expect(200);
    const theirs = await request(app)
      .get('/api/staff/payments/pending?section=claimed&limit=100')
      .set(bearer(otherCashier.token));
    expect([200, 403]).toContain(theirs.status);
    if (theirs.status === 200) {
      expect(theirs.body.data.map((r: QueueRow) => r.id)).not.toContain(placed.id);
    }
    const invalid = await request(app)
      .get('/api/staff/payments/pending?section=everything')
      .set(bearer(cashier.token))
      .expect(422);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a rejected claim leaves the queue, gets a fresh window and can be claimed again', async () => {
    const placed = await order(alice);
    await claim(alice, placed.id, 'WRONGUTR').expect(200);
    published.length = 0;
    const before = Date.now();
    await request(app)
      .post(`/api/staff/orders/${placed.id}/reject-payment`)
      .set(bearer(cashier.token))
      .send({ reason: 'No matching credit' })
      .expect(200);
    const rejected = await paymentOf(placed.id);
    expect(rejected).toMatchObject({ status: 'FAILED', claimedAt: null, expiredAt: null });
    expect(rejected.paymentDueAt!.getTime()).toBeGreaterThanOrEqual(before + WINDOW_MS - 1000);
    expect(queueEvents().map((e) => e.payload.change)).toEqual(['rejected']);
    // The student is told (their own order view, with the reason).
    expect(
      published.some((e) => e.rooms.includes(`student:${alice.id}`) && e.name.startsWith('order.')),
    ).toBe(true);
    expect((await queue('claimed', '&limit=100')).data.map((r) => r.id)).not.toContain(placed.id);
    const reclaimed = await claim(alice, placed.id, 'RIGHTUTR').expect(200);
    expect(reclaimed.body.data.payment).toMatchObject({ status: 'PENDING', utr: 'RIGHTUTR' });
    expect(new Date(reclaimed.body.data.payment.claimedAt).getTime()).toBeGreaterThanOrEqual(
      before,
    );
  });
});

describe('expiry of abandoned orders', () => {
  it('expires an unpaid, unclaimed order after its window, telling everyone', async () => {
    const placed = await order(alice);
    published.length = 0;
    // Not yet due: nothing happens.
    expect((await expiry(later(WINDOW_MS - 60_000)).tick()).expired).not.toContain(placed.id);
    const { expired } = await expiry().tick();
    expect(expired).toContain(placed.id);

    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(orderRow.status).toBe('CANCELLED');
    expect(orderRow.cancelReason).toBe(
      `Payment was not received within ${env.UNPAID_ORDER_EXPIRY_MINUTES} minutes.`,
    );
    const payment = await paymentOf(placed.id);
    expect(payment).toMatchObject({ status: 'FAILED', failureReason: 'Payment window expired' });
    expect(payment.expiredAt).toBeInstanceOf(Date);

    const notification = await prisma.notification.findFirst({
      where: { orderId: placed.id, type: 'ORDER_CANCELLED' },
    });
    expect(notification?.title).toBe('Order expired');
    const forThisOrder = published.filter(
      (e) => JSON.stringify(e.payload).includes(placed.id) && e.name !== 'notification.created',
    );
    expect(forThisOrder.map((e) => [e.name, e.rooms])).toEqual(
      expect.arrayContaining([
        ['order.cancelled', [`student:${alice.id}`]],
        ['payment.queue_changed', [`canteen:${kg.id}`]],
      ]),
    );
    // The kitchen room never receives the unpaid order itself.
    expect(
      forThisOrder.some(
        (e) => e.name === 'order.cancelled' && e.rooms.includes(`canteen:${kg.id}`),
      ),
    ).toBe(false);
  });

  it('never expires a claimed, paid, already cancelled or pre-window order', async () => {
    const claimedOrder = await order(alice);
    await claim(alice, claimedOrder.id).expect(200);
    const paidOrder = await order(alice);
    await confirm(paidOrder.id).expect(200);
    const cancelledOrder = await order(bob);
    await request(app)
      .post(`/api/orders/${cancelledOrder.id}/cancel`)
      .set(bearer(bob.token))
      .expect(200);
    const legacy = await order(bob);
    // Placed before the expiry window existed: no deadline stored.
    await prisma.payment.update({ where: { orderId: legacy.id }, data: { paymentDueAt: null } });

    const far = expiry(later(7 * 24 * 3600_000));
    const { expired } = await far.tick();
    for (const id of [claimedOrder.id, paidOrder.id, cancelledOrder.id, legacy.id]) {
      expect(expired).not.toContain(id);
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: claimedOrder.id } })).status).toBe(
      'PLACED',
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: legacy.id } })).status).toBe(
      'PLACED',
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: paidOrder.id } })).status).toBe(
      'PAYMENT_CONFIRMED',
    );
  });

  it('an expired order can never be claimed, paid, confirmed or prepared', async () => {
    const placed = await order(alice);
    await expiry().expireOrder(placed.id, new Date(Date.now() + WINDOW_MS + 1000));
    expect((await claim(alice, placed.id).expect(409)).body.error.code).toBe('ORDER_EXPIRED');
    const initiate = await request(app)
      .post(`/api/payments/${placed.id}/initiate`)
      .set(bearer(alice.token))
      .expect(409);
    expect(initiate.body.error.code).toBe('ORDER_EXPIRED');
    await confirm(placed.id).expect(409);
    await request(app)
      .patch(`/api/staff/orders/${placed.id}/status`)
      .set(bearer(cashier.token))
      .send({ status: 'PREPARING' })
      .expect((res) => expect([404, 409]).toContain(res.status));
    const payment = await paymentOf(placed.id);
    expect(payment.status).toBe('FAILED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe(
      'CANCELLED',
    );
  });

  it('duplicate and overlapping jobs expire each order exactly once', async () => {
    const placed = await Promise.all([order(alice), order(bob), order(alice)]);
    published.length = 0;
    // Two "processes" (separate job instances) plus a repeated pass.
    const [a, b] = await Promise.all([expiry().tick(), expiry().tick()]);
    const again = await expiry().tick();
    const all = [...a.expired, ...b.expired, ...again.expired];
    for (const { id } of placed) {
      expect(all.filter((x) => x === id)).toHaveLength(1);
      expect(
        await prisma.notification.count({ where: { orderId: id, title: 'Order expired' } }),
      ).toBe(1);
      expect(
        queueEvents().filter((e) => e.payload.orderId === id && e.payload.change === 'expired'),
      ).toHaveLength(1);
    }
  });

  it('claim vs expiry at the same moment: exactly one wins, consistently', async () => {
    for (let i = 0; i < 6; i++) {
      const placed = await order(alice);
      const [claimRes, expired] = await Promise.all([
        claim(alice, placed.id),
        expiry().expireOrder(placed.id, new Date(Date.now() + WINDOW_MS + 1000)),
      ]);
      const payment = await paymentOf(placed.id);
      const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
      if (expired) {
        expect(claimRes.status).toBe(409);
        expect(claimRes.body.error.code).toMatch(/ORDER_EXPIRED|ORDER_NOT_AWAITING_PAYMENT/);
        expect(orderRow.status).toBe('CANCELLED');
        expect(payment.claimedAt).toBeNull();
        expect(payment.expiredAt).not.toBeNull();
      } else {
        expect(claimRes.status).toBe(200);
        expect(orderRow.status).toBe('PLACED');
        expect(payment.claimedAt).not.toBeNull();
        expect(payment.expiredAt).toBeNull();
      }
    }
  });

  it('cashier confirmation vs expiry: never both paid and expired', async () => {
    for (let i = 0; i < 6; i++) {
      const placed = await order(bob);
      const [confirmRes, expired] = await Promise.all([
        confirm(placed.id),
        expiry().expireOrder(placed.id, new Date(Date.now() + WINDOW_MS + 1000)),
      ]);
      const payment = await paymentOf(placed.id);
      const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
      if (expired) {
        expect(confirmRes.status).toBe(409);
        expect(orderRow.status).toBe('CANCELLED');
        expect(payment.status).toBe('FAILED');
        expect(orderRow.paidAt).toBeNull();
      } else {
        expect(confirmRes.status).toBe(200);
        expect(orderRow.status).toBe('PAYMENT_CONFIRMED');
        expect(payment.status).toBe('SUCCESS');
        expect(payment.expiredAt).toBeNull();
      }
    }
  });
});

describe('end to end', () => {
  it('student order → claim → cashier confirmation → kitchen prepares', async () => {
    const placed = await order(alice);
    await claim(alice, placed.id, 'UTR777').expect(200);
    expect((await queue('claimed', '&limit=100')).data.map((r) => r.id)).toContain(placed.id);
    // The kitchen board shows only paid orders.
    const before = await request(app)
      .get('/api/staff/orders?status=active&limit=100')
      .set(bearer(cashier.token))
      .expect(200);
    expect(before.body.data.map((r: QueueRow) => r.id)).not.toContain(placed.id);

    const confirmed = await confirm(placed.id).expect(200);
    expect(confirmed.body.data.order.status).toBe('PAYMENT_CONFIRMED');
    expect((await queue('claimed', '&limit=100')).data.map((r) => r.id)).not.toContain(placed.id);
    await request(app)
      .patch(`/api/staff/orders/${placed.id}/status`)
      .set(bearer(cashier.token))
      .send({ status: 'PREPARING' })
      .expect(200);
    // A paid order is never expired, however late.
    expect((await expiry(later(30 * 24 * 3600_000)).tick()).expired).not.toContain(placed.id);
  });

  it('abandoned order: placed, never claimed, expires, and the student sees why', async () => {
    const placed = await order(bob);
    expect((await queue('unclaimed', '&limit=100')).data.map((r) => r.id)).toContain(placed.id);
    await expiry().tick();
    expect((await queue('unclaimed', '&limit=100')).data.map((r) => r.id)).not.toContain(placed.id);
    const seen = await request(app)
      .get(`/api/orders/${placed.id}`)
      .set(bearer(bob.token))
      .expect(200);
    expect(seen.body.data.status).toBe('CANCELLED');
    expect(seen.body.data.payment.expiredAt).toEqual(expect.any(String));
    expect(seen.body.data.cancelReason).toMatch(/not received within/);
  });
});
