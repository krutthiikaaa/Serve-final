import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { pageArgs, toPage, type Pagination } from '../../http/validation.js';
import { Outbox, type EventPublisher } from '../../realtime/events.js';
import type { ApprovedStaffPrincipal } from '../../middleware/auth.js';
import { writeNotifications } from '../notifications/notification.writer.js';
import { priceCart, type CartLineInput } from '../orders/pricing.js';
import { orderInclude, toOrderDto } from '../orders/order.dto.js';
import { queueOrderEvent } from '../orders/order.events.js';
import { allocateReceiptNumber, toReceiptDto } from '../orders/receipt.js';
import type { ServicePeriod } from '../canteens/availability.js';
import type { CanteensService } from '../canteens/canteens.service.js';
import {
  ensureDemoPaymentConfig,
  requireCanteenPaymentMode,
  toStaffPaymentConfigDto,
} from '../canteens/payment-config.js';

type PaymentMethod = 'CASH' | 'UPI';
type OrderChannel = 'APP' | 'WALK_IN';

export interface WalkInInput {
  servicePeriod: ServicePeriod;
  paymentMethod: PaymentMethod;
  paymentReceived?: boolean | undefined;
  simulatedPaymentReceived?: boolean | undefined;
  items: CartLineInput[];
  guestName?: string | null;
  utr?: string | null;
}

export interface SalesFilter {
  channel?: OrderChannel | undefined;
  method?: PaymentMethod | undefined;
  period?: ServicePeriod | undefined;
  simulated?: boolean | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export function createCashierService(
  prisma: PrismaClient,
  events: EventPublisher,
  canteens: CanteensService,
) {
  async function loadCanteenOrder(canteenId: string, orderId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, canteenId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundError('Order not found.', 'ORDER_NOT_FOUND');
    return order;
  }

  async function settleAppPayment(
    staff: ApprovedStaffPrincipal,
    canteenId: string,
    orderId: string,
    input: { simulated: boolean; utr?: string | null },
  ) {
    const outbox = new Outbox();
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, canteenId, channel: 'APP' },
        include: { payment: true },
      });
      if (!order?.payment) throw new NotFoundError('Order not found.', 'ORDER_NOT_FOUND');
      if (order.payment.status === 'SUCCESS' || order.status !== 'PLACED') {
        throw new ConflictError(
          'This payment has already been processed.',
          'PAYMENT_ALREADY_CONFIRMED',
        );
      }
      if (order.payment.status !== 'PENDING') {
        throw new ConflictError(
          'This order is not awaiting cashier confirmation.',
          'ORDER_NOT_AWAITING_PAYMENT',
        );
      }
      const now = new Date();
      const receiptNumber = order.receiptNumber ?? (await allocateReceiptNumber(tx));
      const paid = await tx.payment.updateMany({
        where: { id: order.payment.id, status: 'PENDING' },
        data: {
          status: 'SUCCESS',
          provider: order.payment.provider === 'MOCK' ? 'UPI' : order.payment.provider,
          utr: input.utr ?? order.payment.utr,
          verifiedByStaffId: staff.id,
          verifiedAt: now,
          paidAt: now,
          failureReason: null,
          isSimulated: input.simulated,
        },
      });
      const confirmed = await tx.order.updateMany({
        where: { id: order.id, status: 'PLACED' },
        data: { status: 'PAYMENT_CONFIRMED', paidAt: now, receiptNumber },
      });
      if (paid.count === 0 || confirmed.count === 0) {
        throw new ConflictError(
          'This payment has already been processed.',
          'PAYMENT_ALREADY_CONFIRMED',
        );
      }
      const fresh = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: orderInclude,
      });
      if (fresh.studentId) {
        await writeNotifications(tx, outbox, [{ kind: 'student', id: fresh.studentId }], {
          type: 'PAYMENT_CONFIRMED',
          title: input.simulated ? 'Demo payment recorded' : 'Payment confirmed',
          message: input.simulated
            ? `DEMO transaction recorded. Order #${fresh.orderNumber} is not a real payment.`
            : `Payment received. Order #${fresh.orderNumber} has been sent to the canteen.`,
          orderId: fresh.id,
          data: { orderNumber: fresh.orderNumber, status: fresh.status, simulated: input.simulated },
        });
      }
      return fresh;
    });
    queueOrderEvent(outbox, updated, 'PLACED');
    outbox.flush(events);
    return { order: toOrderDto(updated, 'staff'), receipt: toReceiptDto(updated) };
  }

  async function completePosSale(
    staff: ApprovedStaffPrincipal,
    canteenId: string,
    input: WalkInInput,
    now: Date,
    simulated: boolean,
  ) {
    const guestName = input.guestName?.trim() ? input.guestName.trim() : null;
    const priced = await priceCart(prisma, canteenId, input.items, {
      servicePeriod: input.servicePeriod,
      now,
    });
    const created = await prisma.$transaction(async (tx) => {
      const receiptNumber = await allocateReceiptNumber(tx);
      const paidAt = new Date();
      return tx.order.create({
        data: {
          channel: 'WALK_IN',
          guestName,
          canteenId: priced.canteen.id,
          servicePeriod: priced.servicePeriod,
          totalPaise: priced.totalPaise,
          status: 'PAYMENT_CONFIRMED',
          paidAt,
          receiptNumber,
          idempotencyKey: `pos-${randomUUID()}`,
          requestHash: randomUUID().replace(/-/g, ''),
          items: {
            create: priced.items.map((line) => ({
              menuItemId: line.menuItemId,
              itemName: line.itemName,
              unitPricePaise: line.unitPricePaise,
              quantity: line.quantity,
              lineTotalPaise: line.lineTotalPaise,
            })),
          },
          payment: {
            create: {
              provider: input.paymentMethod,
              amountPaise: priced.totalPaise,
              status: 'SUCCESS',
              utr: input.utr ?? null,
              verifiedByStaffId: staff.id,
              verifiedAt: paidAt,
              paidAt,
              isSimulated: simulated,
            },
          },
        },
        include: orderInclude,
      });
    });
    return { order: toOrderDto(created, 'staff'), receipt: toReceiptDto(created) };
  }

  return {
    async pendingPayments(canteenId: string, page: Pagination) {
      const rows = await prisma.order.findMany({
        where: {
          canteenId,
          channel: 'APP',
          status: 'PLACED',
          payment: { status: 'PENDING' },
        },
        include: orderInclude,
        ...pageArgs(page),
      });
      const result = toPage(rows, page);
      return { ...result, data: result.data.map((order) => toOrderDto(order, 'staff')) };
    },

    async posMenu(principal: ApprovedStaffPrincipal, canteenId: string, period: ServicePeriod) {
      return canteens.menu(principal, canteenId, period);
    },

    async paymentConfig(canteenId: string) {
      return toStaffPaymentConfigDto(await ensureDemoPaymentConfig(prisma, canteenId));
    },

    /**
     * LIVE cashier confirmation of actual UPI credit. Screenshots and UTRs are not proof.
     */
    async confirmPayment(
      staff: ApprovedStaffPrincipal,
      canteenId: string,
      orderId: string,
      input: { paymentReceived: boolean; utr?: string | null },
    ) {
      if (input.paymentReceived !== true) {
        throw new ValidationError(
          'Confirm that the payment was actually received.',
          { paymentReceived: 'Required' },
          'PAYMENT_NOT_CONFIRMED',
        );
      }
      await requireCanteenPaymentMode(prisma, canteenId, 'LIVE');
      return settleAppPayment(staff, canteenId, orderId, { simulated: false, utr: input.utr });
    },

    /**
     * DEMO cashier confirmation. Separate from LIVE verification; the canteen must be DEMO.
     */
    async confirmDemoPayment(
      staff: ApprovedStaffPrincipal,
      canteenId: string,
      orderId: string,
      input: { simulatedPaymentReceived: boolean; utr?: string | null },
    ) {
      if (input.simulatedPaymentReceived !== true) {
        throw new ValidationError(
          'Confirm the simulated DEMO payment explicitly.',
          { simulatedPaymentReceived: 'Required' },
          'PAYMENT_NOT_CONFIRMED',
        );
      }
      await requireCanteenPaymentMode(prisma, canteenId, 'DEMO');
      return settleAppPayment(staff, canteenId, orderId, { simulated: true, utr: input.utr });
    },

    async rejectPayment(
      staff: ApprovedStaffPrincipal,
      canteenId: string,
      orderId: string,
      reason?: string | null,
    ) {
      const updated = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findFirst({
          where: { id: orderId, canteenId, channel: 'APP' },
          include: { payment: true },
        });
        if (!order?.payment) throw new NotFoundError('Order not found.', 'ORDER_NOT_FOUND');
        if (order.payment.status === 'SUCCESS') {
          throw new ConflictError(
            'This payment has already been processed.',
            'PAYMENT_ALREADY_CONFIRMED',
          );
        }
        const rejected = await tx.payment.updateMany({
          where: { id: order.payment.id, status: 'PENDING' },
          data: {
            status: 'FAILED',
            failureReason: reason ?? 'Payment rejected by cashier',
            verifiedByStaffId: staff.id,
            verifiedAt: new Date(),
          },
        });
        if (rejected.count === 0) {
          throw new ConflictError(
            'This payment has already been processed.',
            'PAYMENT_ALREADY_CONFIRMED',
          );
        }
        return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
      });
      return toOrderDto(updated, 'staff');
    },

    async completeWalkIn(
      staff: ApprovedStaffPrincipal,
      canteenId: string,
      input: WalkInInput,
      now: Date,
    ) {
      if (input.paymentReceived !== true) {
        throw new ValidationError(
          'Confirm that cash was received or UPI credit was verified.',
          { paymentReceived: 'Required' },
          'PAYMENT_NOT_CONFIRMED',
        );
      }
      await requireCanteenPaymentMode(prisma, canteenId, 'LIVE');
      return completePosSale(staff, canteenId, input, now, false);
    },

    async completeDemoWalkIn(
      staff: ApprovedStaffPrincipal,
      canteenId: string,
      input: WalkInInput,
      now: Date,
    ) {
      if (input.simulatedPaymentReceived !== true) {
        throw new ValidationError(
          'Confirm the simulated DEMO sale explicitly.',
          { simulatedPaymentReceived: 'Required' },
          'PAYMENT_NOT_CONFIRMED',
        );
      }
      await requireCanteenPaymentMode(prisma, canteenId, 'DEMO');
      return completePosSale(staff, canteenId, input, now, true);
    },

    async listSales(canteenId: string, filter: SalesFilter, page: Pagination) {
      const where: Prisma.OrderWhereInput = {
        canteenId,
        paidAt: { not: null },
        status: { not: 'CANCELLED' },
        payment: {
          status: 'SUCCESS',
          ...(filter.simulated === undefined ? {} : { isSimulated: filter.simulated }),
          ...(filter.method ? { provider: filter.method } : {}),
        },
        ...(filter.channel ? { channel: filter.channel } : {}),
        ...(filter.period ? { servicePeriod: filter.period } : {}),
        ...(filter.from || filter.to
          ? {
              paidAt: {
                not: null,
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lte: filter.to } : {}),
              },
            }
          : {}),
      };
      const rows = await prisma.order.findMany({
        where,
        include: orderInclude,
        ...pageArgs(page),
      });
      const result = toPage(rows, page);
      return { ...result, data: result.data.map((order) => toOrderDto(order, 'staff')) };
    },

    async receipt(canteenId: string, orderId: string) {
      return toReceiptDto(await loadCanteenOrder(canteenId, orderId));
    },
  };
}

export type CashierService = ReturnType<typeof createCashierService>;
