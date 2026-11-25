import type { Logger } from 'pino';
import type { PrismaClient } from '../../lib/prisma.js';
import { systemClock, type Clock } from '../../lib/time.js';
import { Outbox, type EventPublisher } from '../../realtime/events.js';
import { writeNotifications } from '../notifications/notification.writer.js';
import { orderInclude } from '../orders/order.dto.js';
import { queueOrderEvent, queuePaymentQueueChange } from '../orders/order.events.js';
import {
  EXPIRED_FAILURE_REASON,
  expiredCancelReason,
  type PaymentWindowConfig,
} from './payment-window.js';

/**
 * Expires abandoned app orders: placed, never paid and never claimed ("I've
 * paid") before their payment deadline. Runs in the API process, on start-up
 * and then every `intervalMs` (like the Day/Night scheduler).
 *
 * Never touched: a claimed order (the cashier decides it), a paid order, an
 * order without a deadline (placed before the window existed), walk-in bills.
 *
 * Race-safe and idempotent: each order is expired with conditional updates —
 * the Payment row first (still unclaimed, unpaid, not expired, past its
 * deadline), then the Order row (still PLACED) — in one transaction. A claim,
 * a cashier confirmation or a cancellation that commits first makes the
 * update match nothing; a second pass, or another process running the same
 * job, finds nothing left to do.
 */

export const DEFAULT_EXPIRY_INTERVAL_MS = 60_000;
/** Orders expired per pass (the next pass continues). */
const BATCH = 200;

export function createUnpaidOrderExpiry(deps: {
  prisma: PrismaClient;
  events: EventPublisher;
  logger: Logger;
  env: PaymentWindowConfig;
  clock?: Clock;
}) {
  const { prisma, events, logger, env } = deps;
  const now = () => (deps.clock ?? systemClock)();
  let running = false;

  /** Expires one order if it still qualifies at `at`; true when it did. */
  async function expireOrder(orderId: string, at: Date): Promise<boolean> {
    const outbox = new Outbox();
    const expired = await prisma
      .$transaction(async (tx) => {
        const payment = await tx.payment.updateMany({
          where: {
            orderId,
            status: { in: ['PENDING', 'FAILED'] },
            claimedAt: null,
            expiredAt: null,
            paymentDueAt: { lte: at },
          },
          data: { status: 'FAILED', expiredAt: at, failureReason: EXPIRED_FAILURE_REASON },
        });
        if (payment.count === 0) return null;
        const order = await tx.order.updateMany({
          where: { id: orderId, status: 'PLACED', channel: 'APP' },
          data: { status: 'CANCELLED', cancelledAt: at, cancelReason: expiredCancelReason(env) },
        });
        if (order.count === 0) {
          // The order moved on (e.g. cancelled): undo the payment change.
          throw new OrderMovedOn();
        }
        const fresh = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: orderInclude,
        });
        if (fresh.studentId) {
          await writeNotifications(tx, outbox, [{ kind: 'student', id: fresh.studentId }], {
            type: 'ORDER_CANCELLED',
            title: 'Order expired',
            message: `Order #${fresh.orderNumber} expired: ${expiredCancelReason(env)} Nothing was charged by SERVE. Place a new order to try again.`,
            orderId: fresh.id,
            data: { orderNumber: fresh.orderNumber, status: fresh.status, expired: true },
          });
        }
        queueOrderEvent(outbox, fresh, 'PLACED');
        queuePaymentQueueChange(outbox, fresh, 'expired');
        return fresh;
      })
      .catch((err: unknown) => {
        if (err instanceof OrderMovedOn) return null;
        throw err;
      });
    if (!expired) return false;
    outbox.flush(events);
    return true;
  }

  /** One pass: expire every qualifying order (up to BATCH). */
  async function tick(): Promise<{ expired: string[] }> {
    if (running) return { expired: [] };
    running = true;
    try {
      const at = now();
      const due = await prisma.payment.findMany({
        where: {
          status: { in: ['PENDING', 'FAILED'] },
          claimedAt: null,
          expiredAt: null,
          paymentDueAt: { lte: at },
          order: { status: 'PLACED', channel: 'APP' },
        },
        select: { orderId: true },
        orderBy: { paymentDueAt: 'asc' },
        take: BATCH,
      });
      const expired: string[] = [];
      for (const { orderId } of due) {
        try {
          if (await expireOrder(orderId, at)) expired.push(orderId);
        } catch (err) {
          // One bad order never stops the others; the next pass retries it.
          logger.error({ err, orderId }, 'Unpaid order expiry failed');
        }
      }
      if (expired.length > 0) logger.info({ count: expired.length }, 'Expired unpaid orders');
      return { expired };
    } finally {
      running = false;
    }
  }

  /** Starts the periodic expiry; returns a stop function. */
  function start(intervalMs = DEFAULT_EXPIRY_INTERVAL_MS) {
    const run = () =>
      void tick().catch((err: unknown) => logger.error({ err }, 'Unpaid order expiry pass failed'));
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { expireOrder, tick, start };
}

class OrderMovedOn extends Error {}

export type UnpaidOrderExpiry = ReturnType<typeof createUnpaidOrderExpiry>;
