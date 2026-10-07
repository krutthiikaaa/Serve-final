import { createHash } from 'node:crypto';
import type { OrderStatus, Prisma } from '../../generated/prisma/client.js';
import type { Logger } from 'pino';
import type { PrismaClient } from '../../lib/prisma.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { Outbox, type EventPublisher } from '../../realtime/events.js';
import type { PaymentProvider } from '../payments/provider.js';
import { writeNotifications } from '../notifications/notification.writer.js';
import type { StudentPrincipal } from '../auth/principal.js';
import type { ApprovedStaffPrincipal } from '../../middleware/auth.js';
import { pageArgs, toPage, type Pagination } from '../../http/validation.js';
import { priceCart, type CartLineInput } from './pricing.js';
import {
  ACTIVE_STATUSES,
  PAST_STATUSES,
  STAFF_VISIBLE_STATUSES,
  STATUS_TIMESTAMP,
  assertTransition,
  type StaffSettableStatus,
} from './order-state.js';
import { orderInclude, toOrderDto, type OrderWithDetails } from './order.dto.js';
import { queueOrderEvent } from './order.events.js';

export interface CreateOrderInput {
  canteenId: string;
  items: CartLineInput[];
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** Stable fingerprint of what was ordered (prices excluded — they are server-side). */
function requestHash(input: CreateOrderInput): string {
  const normalized = {
    canteenId: input.canteenId,
    items: [...input.items]
      .map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity }))
      .sort((a, b) => a.menuItemId.localeCompare(b.menuItemId)),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

const STATUS_COPY: Partial<
  Record<
    OrderStatus,
    { type: Prisma.NotificationCreateInput['type']; title: string; message: (n: string) => string }
  >
> = {
  PREPARING: {
    type: 'ORDER_PREPARING',
    title: 'Preparing your order',
    message: (n) => `Order #${n} is being prepared.`,
  },
  READY: {
    type: 'ORDER_READY',
    title: 'Ready for pickup',
    message: (n) => `Your order is ready for pickup. Show order #${n} at the counter.`,
  },
  COLLECTED: {
    type: 'ORDER_COLLECTED',
    title: 'Order collected',
    message: (n) => `Order #${n} has been collected. Enjoy your food!`,
  },
  CANCELLED: {
    type: 'ORDER_CANCELLED',
    title: 'Order cancelled',
    message: (n) => `Order #${n} was cancelled.`,
  },
};

export function createOrdersService(deps: {
  prisma: PrismaClient;
  events: EventPublisher;
  payments: PaymentProvider;
  logger: Logger;
}) {
  const { prisma, events, payments, logger } = deps;

  async function loadOrder(where: Prisma.OrderWhereInput): Promise<OrderWithDetails> {
    const order = await prisma.order.findFirst({ where, include: orderInclude });
    if (!order) throw new NotFoundError('Order not found.', 'ORDER_NOT_FOUND');
    return order;
  }

  /**
   * Refund a committed cancellation. If the provider fails, the order stays
   * CANCELLED and the payment stays SUCCESS with a failure note so the refund
   * can be retried; the failure is logged, never hidden.
   */
  async function refundCancelledOrder(order: OrderWithDetails): Promise<OrderWithDetails> {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    if (payment.status !== 'SUCCESS' || !payment.providerPaymentId) return order;
    try {
      await payments.refund(payment.providerPaymentId, payment.amountPaise);
      await prisma.payment.updateMany({
        where: { id: payment.id, status: 'SUCCESS' },
        data: { status: 'REFUNDED', refundedAt: new Date(), failureReason: null },
      });
    } catch (err) {
      logger.error({ err, orderId: order.id }, 'Refund failed for cancelled order');
      await prisma.payment.update({
        where: { id: payment.id },
        data: { failureReason: 'Refund pending: the payment provider refund failed' },
      });
    }
    return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
  }

  async function replayOrConflict(studentId: string, key: string, hash: string) {
    const existing = await prisma.order.findUnique({
      where: { studentId_idempotencyKey: { studentId, idempotencyKey: key } },
      include: orderInclude,
    });
    if (!existing) return null;
    if (existing.requestHash !== hash) {
      throw new ValidationError(
        'This Idempotency-Key was already used for a different order.',
        undefined,
        'IDEMPOTENCY_KEY_REUSED',
      );
    }
    return existing;
  }

  return {
    async quote(input: CreateOrderInput) {
      return priceCart(prisma, input.canteenId, input.items);
    },

    /**
     * Create an order + immutable item snapshots + PENDING payment in one
     * transaction. Totals are computed from current database prices.
     * Repeating a request with the same Idempotency-Key returns the original
     * order instead of creating a duplicate.
     */
    async create(
      student: StudentPrincipal,
      idempotencyKey: string | undefined,
      input: CreateOrderInput,
    ) {
      if (!idempotencyKey) {
        throw new BadRequestError(
          'The Idempotency-Key header is required.',
          'IDEMPOTENCY_KEY_REQUIRED',
        );
      }
      if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
        throw new ValidationError(
          'Idempotency-Key must be 8–128 characters: letters, digits, "-" or "_".',
          undefined,
          'IDEMPOTENCY_KEY_INVALID',
        );
      }
      const hash = requestHash(input);
      const replay = await replayOrConflict(student.id, idempotencyKey, hash);
      if (replay) return { order: toOrderDto(replay, 'student'), replayed: true };

      const outbox = new Outbox();
      let order: OrderWithDetails;
      try {
        order = await prisma.$transaction(async (tx) => {
          const priced = await priceCart(tx, input.canteenId, input.items);
          const created = await tx.order.create({
            data: {
              studentId: student.id,
              canteenId: priced.canteen.id,
              totalPaise: priced.totalPaise,
              idempotencyKey,
              requestHash: hash,
              items: {
                create: priced.items.map((line) => ({
                  menuItemId: line.menuItemId,
                  itemName: line.itemName,
                  unitPricePaise: line.unitPricePaise,
                  quantity: line.quantity,
                  lineTotalPaise: line.lineTotalPaise,
                })),
              },
              payment: { create: { provider: payments.name, amountPaise: priced.totalPaise } },
            },
            include: orderInclude,
          });
          await writeNotifications(tx, outbox, [{ kind: 'student', id: student.id }], {
            type: 'ORDER_PLACED',
            title: 'Order placed',
            message: `Order #${created.orderNumber} was placed. Complete payment to confirm it.`,
            orderId: created.id,
            data: { orderNumber: created.orderNumber, status: created.status },
          });
          queueOrderEvent(outbox, created, null);
          return created;
        });
      } catch (err) {
        // Concurrent duplicate with the same key: return the winner.
        if (isUniqueViolation(err, 'idempotencyKey')) {
          const winner = await replayOrConflict(student.id, idempotencyKey, hash);
          if (winner) return { order: toOrderDto(winner, 'student'), replayed: true };
        }
        throw err;
      }
      outbox.flush(events);
      return { order: toOrderDto(order, 'student'), replayed: false };
    },

    async listForStudent(
      student: StudentPrincipal,
      filter: 'active' | 'past' | 'all',
      page: Pagination,
    ) {
      const statuses =
        filter === 'active' ? ACTIVE_STATUSES : filter === 'past' ? PAST_STATUSES : undefined;
      const rows = await prisma.order.findMany({
        where: { studentId: student.id, ...(statuses ? { status: { in: statuses } } : {}) },
        include: orderInclude,
        ...pageArgs(page),
      });
      const result = toPage(rows, page);
      return { ...result, data: result.data.map((order) => toOrderDto(order, 'student')) };
    },

    async getForStudent(student: StudentPrincipal, orderId: string) {
      return toOrderDto(await loadOrder({ id: orderId, studentId: student.id }), 'student');
    },

    /** A student may cancel only an unpaid order. */
    async cancelByStudent(student: StudentPrincipal, orderId: string) {
      const order = await loadOrder({ id: orderId, studentId: student.id });
      assertTransition(order.status, 'CANCELLED');
      if (order.status !== 'PLACED') {
        throw new ConflictError(
          'Paid orders can only be cancelled by the canteen.',
          'INVALID_STATUS_TRANSITION',
          { from: order.status, to: 'CANCELLED' },
        );
      }
      const outbox = new Outbox();
      const updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.order.updateMany({
          where: { id: order.id, status: 'PLACED' },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelReason: 'Cancelled by student before payment',
          },
        });
        if (changed.count === 0) {
          throw new ConflictError(
            'The order changed. Refresh and try again.',
            'ORDER_STATE_CHANGED',
          );
        }
        await tx.payment.updateMany({
          where: { orderId: order.id, status: 'PENDING' },
          data: { status: 'FAILED', failureReason: 'Order cancelled before payment' },
        });
        const fresh = await tx.order.findUniqueOrThrow({
          where: { id: order.id },
          include: orderInclude,
        });
        queueOrderEvent(outbox, fresh, order.status);
        return fresh;
      });
      outbox.flush(events);
      return toOrderDto(updated, 'student');
    },

    async listForCanteen(
      canteenId: string,
      status: OrderStatus | 'active' | undefined,
      page: Pagination,
    ) {
      const statuses =
        status === 'active'
          ? ACTIVE_STATUSES.filter((s) => s !== 'PLACED')
          : status
            ? [status]
            : STAFF_VISIBLE_STATUSES;
      const visible = statuses.filter((s) => STAFF_VISIBLE_STATUSES.includes(s));
      const rows = await prisma.order.findMany({
        where: { canteenId, status: { in: visible } },
        include: orderInclude,
        ...pageArgs(page),
      });
      const result = toPage(rows, page);
      return { ...result, data: result.data.map((order) => toOrderDto(order, 'staff')) };
    },

    async getForCanteen(canteenId: string, orderId: string) {
      return toOrderDto(
        await loadOrder({ id: orderId, canteenId, status: { in: STAFF_VISIBLE_STATUSES } }),
        'staff',
      );
    },

    async listForAdmin(
      filter: { canteenId?: string | undefined; status?: OrderStatus | undefined },
      page: Pagination,
    ) {
      const rows = await prisma.order.findMany({
        where: {
          ...(filter.canteenId ? { canteenId: filter.canteenId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
        },
        include: orderInclude,
        ...pageArgs(page),
      });
      const result = toPage(rows, page);
      return { ...result, data: result.data.map((order) => toOrderDto(order, 'admin')) };
    },

    async getForAdmin(orderId: string) {
      return toOrderDto(await loadOrder({ id: orderId }), 'admin');
    },

    /**
     * Staff status change for an order in THEIR canteen (canteen taken from
     * the staff member's database record). Enforces the state machine with a
     * conditional update so concurrent changes cannot skip states.
     */
    async updateStatusByStaff(
      staff: ApprovedStaffPrincipal,
      orderId: string,
      target: StaffSettableStatus,
      reason?: string | null,
    ) {
      const order = await loadOrder({
        id: orderId,
        canteenId: staff.canteenId,
        status: { in: STAFF_VISIBLE_STATUSES },
      });
      assertTransition(order.status, target);

      const outbox = new Outbox();
      const timestampColumn = STATUS_TIMESTAMP[target];
      let updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.order.updateMany({
          where: { id: order.id, canteenId: staff.canteenId, status: order.status },
          data: {
            status: target,
            ...(timestampColumn ? { [timestampColumn]: new Date() } : {}),
            ...(target === 'CANCELLED' ? { cancelReason: reason ?? 'Cancelled by canteen' } : {}),
          },
        });
        if (changed.count === 0) {
          throw new ConflictError(
            'The order changed. Refresh and try again.',
            'ORDER_STATE_CHANGED',
          );
        }
        const fresh = await tx.order.findUniqueOrThrow({
          where: { id: order.id },
          include: orderInclude,
        });
        const copy = STATUS_COPY[target];
        if (copy) {
          await writeNotifications(tx, outbox, [{ kind: 'student', id: fresh.studentId }], {
            type: copy.type,
            title: copy.title,
            message: copy.message(fresh.orderNumber),
            orderId: fresh.id,
            data: { orderNumber: fresh.orderNumber, status: fresh.status },
          });
        }
        queueOrderEvent(outbox, fresh, order.status);
        return fresh;
      });
      outbox.flush(events);

      // Refund only AFTER the cancellation is committed, so money is never
      // returned for an order that a concurrent update kept in preparation.
      if (target === 'CANCELLED' && updated.payment?.status === 'SUCCESS') {
        updated = await refundCancelledOrder(updated);
      }
      return toOrderDto(updated, 'staff');
    },
  };
}

export type OrdersService = ReturnType<typeof createOrdersService>;
