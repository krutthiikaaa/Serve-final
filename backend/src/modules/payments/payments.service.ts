import type { Logger } from 'pino';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { Outbox, type EventPublisher } from '../../realtime/events.js';
import type { StudentPrincipal } from '../auth/principal.js';
import { writeNotifications } from '../notifications/notification.writer.js';
import { canteenTakesOrders } from '../canteens/canteen.dto.js';
import { orderInclude, toOrderDto } from '../orders/order.dto.js';
import { queueOrderEvent } from '../orders/order.events.js';
import { MockPaymentProvider } from './mock.provider.js';
import type { PaymentConfirmation, PaymentProvider } from './provider.js';

interface Deps {
  prisma: PrismaClient;
  events: EventPublisher;
  payments: PaymentProvider;
  logger: Logger;
}

/**
 * Payment workflow. The amount is ALWAYS the server-calculated order total
 * stored on the Payment row; nothing a client sends can change it.
 *
 *   initiate  -> provider order for payment.amountPaise
 *   confirm   -> verify signature, verify captured amount server-to-server,
 *                record the event once, Payment SUCCESS + Order PAYMENT_CONFIRMED
 */
export function createPaymentsService({ prisma, events, payments, logger }: Deps) {
  async function ownedOrder(student: StudentPrincipal, orderId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, studentId: student.id },
      include: { payment: true, canteen: { select: { isActive: true, isAcceptingOrders: true } } },
    });
    if (!order?.payment) throw new NotFoundError('Order not found.', 'ORDER_NOT_FOUND');
    return { ...order, payment: order.payment };
  }

  async function currentOrderDto(orderId: string) {
    return toOrderDto(
      await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude }),
      'student',
    );
  }

  /**
   * Apply a verified, captured payment exactly once. Shared by the client
   * verification path and (future) provider webhooks.
   */
  async function applyCapture(input: {
    orderId: string;
    providerOrderId: string;
    providerPaymentId: string;
    signature: string | null;
    capturedAmountPaise: number;
    eventId: string;
  }) {
    const outbox = new Outbox();
    const result = await prisma.$transaction(async (tx) => {
      try {
        await tx.processedPaymentEvent.create({
          data: { provider: payments.name, eventId: input.eventId },
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { duplicate: true as const };
        throw err;
      }

      const payment = await tx.payment.findUniqueOrThrow({ where: { orderId: input.orderId } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
      if (
        payment.amountPaise !== input.capturedAmountPaise ||
        order.totalPaise !== input.capturedAmountPaise
      ) {
        throw new ValidationError(
          'The paid amount does not match the order total.',
          undefined,
          'PAYMENT_AMOUNT_MISMATCH',
        );
      }

      const now = new Date();
      const paid = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING', providerOrderId: input.providerOrderId },
        data: {
          status: 'SUCCESS',
          providerPaymentId: input.providerPaymentId,
          signature: input.signature,
          paidAt: now,
          failureReason: null,
        },
      });
      const confirmed = await tx.order.updateMany({
        where: { id: order.id, status: 'PLACED' },
        data: { status: 'PAYMENT_CONFIRMED', paidAt: now },
      });
      if (paid.count === 0 || confirmed.count === 0) {
        throw new ConflictError(
          'This order is no longer awaiting payment.',
          'ORDER_NOT_AWAITING_PAYMENT',
        );
      }

      const fresh = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: orderInclude,
      });
      await writeNotifications(tx, outbox, [{ kind: 'student', id: fresh.studentId }], {
        type: 'PAYMENT_CONFIRMED',
        title: 'Payment confirmed',
        message: `Payment received. Order #${fresh.orderNumber} has been sent to the canteen.`,
        orderId: fresh.id,
        data: { orderNumber: fresh.orderNumber, status: fresh.status },
      });
      return { duplicate: false as const, order: fresh };
    });

    if (!result.duplicate) {
      // order.payment_confirmed doubles as the kitchen's "new order" signal.
      queueOrderEvent(outbox, result.order, 'PLACED');
      outbox.flush(events);
    }
    return result;
  }

  async function markFailed(paymentId: string, reason: string) {
    await prisma.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'FAILED', failureReason: reason },
    });
  }

  async function confirm(
    student: StudentPrincipal,
    orderId: string,
    confirmation: PaymentConfirmation,
  ) {
    const order = await ownedOrder(student, orderId);
    const { payment } = order;

    if (payment.providerOrderId !== confirmation.providerOrderId) {
      throw new ValidationError(
        'Payment does not belong to this order.',
        undefined,
        'PAYMENT_ORDER_MISMATCH',
      );
    }
    if (payment.status === 'SUCCESS') {
      // Idempotent replay of the same confirmation.
      if (payment.providerPaymentId === confirmation.providerPaymentId) {
        return { order: await currentOrderDto(order.id), replayed: true };
      }
      throw new ConflictError('This order has already been paid.', 'ALREADY_PAID');
    }
    if (order.status !== 'PLACED') {
      throw new ConflictError(
        'This order is no longer awaiting payment.',
        'ORDER_NOT_AWAITING_PAYMENT',
      );
    }
    if (!payments.verifyPaymentSignature(confirmation)) {
      throw new ValidationError(
        'Payment signature is invalid.',
        undefined,
        'PAYMENT_SIGNATURE_INVALID',
      );
    }

    // Never trust the client about what was captured: ask the provider.
    const captured = await payments.fetchPayment(
      confirmation.providerPaymentId,
      confirmation.providerOrderId,
    );
    if (captured.providerOrderId !== confirmation.providerOrderId) {
      throw new ValidationError(
        'Payment does not belong to this order.',
        undefined,
        'PAYMENT_ORDER_MISMATCH',
      );
    }
    if (captured.status !== 'captured') {
      await markFailed(payment.id, 'Payment was not completed');
      throw new ValidationError('Payment was not completed.', undefined, 'PAYMENT_FAILED');
    }
    if (captured.amountPaise !== payment.amountPaise) {
      logger.warn(
        { orderId: order.id, expected: payment.amountPaise, captured: captured.amountPaise },
        'Payment amount mismatch',
      );
      throw new ValidationError(
        'The paid amount does not match the order total.',
        undefined,
        'PAYMENT_AMOUNT_MISMATCH',
      );
    }

    const result = await applyCapture({
      orderId: order.id,
      providerOrderId: confirmation.providerOrderId,
      providerPaymentId: confirmation.providerPaymentId,
      signature: confirmation.signature,
      capturedAmountPaise: captured.amountPaise,
      eventId: `payment.captured:${confirmation.providerPaymentId}`,
    });
    return { order: await currentOrderDto(order.id), replayed: result.duplicate };
  }

  return {
    confirm,

    async initiate(student: StudentPrincipal, orderId: string) {
      const order = await ownedOrder(student, orderId);
      const { payment } = order;
      if (payment.status === 'SUCCESS')
        throw new ConflictError('This order has already been paid.', 'ALREADY_PAID');
      if (order.status !== 'PLACED') {
        throw new ConflictError(
          'This order is no longer awaiting payment.',
          'ORDER_NOT_AWAITING_PAYMENT',
        );
      }
      if (!canteenTakesOrders(order.canteen)) {
        throw new ConflictError(
          'This canteen is currently not accepting orders.',
          'CANTEEN_NOT_ACCEPTING_ORDERS',
        );
      }
      if (payment.amountPaise !== order.totalPaise) {
        // Defensive: should be impossible (both are written in one transaction).
        throw new ConflictError(
          'Payment amount is inconsistent with the order.',
          'PAYMENT_AMOUNT_MISMATCH',
        );
      }

      let providerOrderId = payment.status === 'PENDING' ? payment.providerOrderId : null;
      if (!providerOrderId) {
        const providerOrder = await payments.createOrder({
          amountPaise: payment.amountPaise,
          currency: 'INR',
          receipt: order.orderNumber,
        });
        if (providerOrder.amountPaise !== payment.amountPaise) {
          throw new ConflictError(
            'Payment provider returned a different amount.',
            'PAYMENT_AMOUNT_MISMATCH',
          );
        }
        providerOrderId = providerOrder.providerOrderId;
        await prisma.payment.update({
          where: { id: payment.id },
          data: { providerOrderId, status: 'PENDING', failureReason: null },
        });
      }
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        provider: payments.name,
        providerOrderId,
        amountPaise: payment.amountPaise,
        currency: payment.currency,
      };
    },

    /**
     * DEVELOPMENT/TEST ONLY: simulate the customer completing checkout on the
     * gateway, then run the normal verification path. Never mounted in
     * production (and the mock provider is rejected there).
     */
    async mockComplete(
      student: StudentPrincipal,
      orderId: string,
      options: { outcome: 'success' | 'failure'; capturedAmountPaise?: number | undefined },
    ) {
      if (!(payments instanceof MockPaymentProvider)) {
        throw new NotFoundError('Not found', 'ROUTE_NOT_FOUND');
      }
      const order = await ownedOrder(student, orderId);
      if (order.payment.status === 'SUCCESS') {
        return { order: await currentOrderDto(order.id), replayed: true, confirmation: null };
      }
      if (!order.payment.providerOrderId || order.payment.status !== 'PENDING') {
        throw new ConflictError('Start the payment before completing it.', 'PAYMENT_NOT_INITIATED');
      }
      const checkout = payments.simulateCheckout(order.payment.providerOrderId, {
        outcome: options.outcome,
        amountPaise: order.payment.amountPaise,
        ...(options.capturedAmountPaise !== undefined
          ? { capturedAmountPaise: options.capturedAmountPaise }
          : {}),
      });
      const confirmation = {
        providerOrderId: checkout.providerOrderId,
        providerPaymentId: checkout.providerPaymentId,
        signature: checkout.signature,
      };
      const result = await confirm(student, orderId, confirmation);
      return { ...result, confirmation };
    },

    /**
     * Provider webhook (Razorpay-shaped). Signature verified over the raw body;
     * each provider event id is processed at most once.
     */
    async handleWebhook(
      rawBody: Buffer,
      signature: string | undefined,
      eventIdHeader: string | undefined,
    ) {
      if (!signature || !payments.verifyWebhookSignature(rawBody, signature)) {
        throw new ValidationError(
          'Invalid webhook signature.',
          undefined,
          'WEBHOOK_SIGNATURE_INVALID',
        );
      }
      let event: {
        event?: string;
        payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } } };
      };
      try {
        event = JSON.parse(rawBody.toString('utf8')) as typeof event;
      } catch {
        throw new ValidationError('Webhook body is not valid JSON.', undefined, 'WEBHOOK_INVALID');
      }
      const entity = event.payload?.payment?.entity;
      if (!eventIdHeader || !event.event || !entity?.id || !entity.order_id) {
        throw new ValidationError(
          'Webhook event is missing required fields.',
          undefined,
          'WEBHOOK_INVALID',
        );
      }

      const payment = await prisma.payment.findUnique({
        where: { providerOrderId: entity.order_id },
      });
      if (!payment) {
        // Unknown order: acknowledge (so the provider stops retrying) but record it.
        await recordEvent(eventIdHeader);
        return { processed: false, reason: 'unknown_order' as const };
      }

      if (event.event === 'payment.captured' && typeof entity.amount === 'number') {
        const result = await applyCapture({
          orderId: payment.orderId,
          providerOrderId: entity.order_id,
          providerPaymentId: entity.id,
          signature: null,
          capturedAmountPaise: entity.amount,
          eventId: eventIdHeader,
        });
        return {
          processed: !result.duplicate,
          reason: result.duplicate ? ('duplicate' as const) : undefined,
        };
      }
      if (event.event === 'payment.failed') {
        const fresh = await recordEvent(eventIdHeader);
        if (fresh) await markFailed(payment.id, 'Payment failed at provider');
        return { processed: fresh, reason: fresh ? undefined : ('duplicate' as const) };
      }
      const fresh = await recordEvent(eventIdHeader);
      return {
        processed: false,
        reason: fresh ? ('ignored_event' as const) : ('duplicate' as const),
      };
    },
  };

  /** Returns false when the event was already processed. */
  async function recordEvent(
    eventId: string,
    tx: Prisma.TransactionClient | PrismaClient = prisma,
  ) {
    try {
      await tx.processedPaymentEvent.create({ data: { provider: payments.name, eventId } });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }
}

export type PaymentsService = ReturnType<typeof createPaymentsService>;
