import type { OrderStatus } from '../../generated/prisma/client.js';
import { rooms, type Outbox, type RealtimeEventName } from '../../realtime/events.js';
import { toOrderDto, type OrderWithDetails } from './order.dto.js';

/** One realtime event per lifecycle step. */
export const ORDER_STATUS_EVENTS: Record<OrderStatus, RealtimeEventName> = {
  PLACED: 'order.created',
  PAYMENT_CONFIRMED: 'order.payment_confirmed',
  PREPARING: 'order.preparing',
  READY: 'order.ready',
  COLLECTED: 'order.collected',
  CANCELLED: 'order.cancelled',
};

/**
 * Queue the event for an order's CURRENT status (published after commit).
 * Each audience receives its own representation of the order:
 *  - student:<id>  -> student view (own order)
 *  - canteen:<id>  -> staff view, only once the order is paid (the kitchen
 *                     never sees unpaid orders; `order.payment_confirmed` is
 *                     the "new order" signal for staff)
 *  - admin         -> admin view
 */
export function queueOrderEvent(
  outbox: Outbox,
  order: OrderWithDetails,
  previousStatus: OrderStatus | null,
): void {
  const name = ORDER_STATUS_EVENTS[order.status];
  if (order.studentId) {
    outbox.emit(name, [rooms.student(order.studentId)], {
      order: toOrderDto(order, 'student'),
      previousStatus,
    });
  }
  // Walk-in POS bills must not appear on the app kitchen board.
  if (order.paidAt !== null && order.channel === 'APP') {
    outbox.emit(name, [rooms.canteen(order.canteenId)], {
      order: toOrderDto(order, 'staff'),
      previousStatus,
    });
  }
  outbox.emit(name, [rooms.admins()], { order: toOrderDto(order, 'admin'), previousStatus });
}

export type PaymentQueueChange = 'placed' | 'claimed' | 'rejected' | 'expired' | 'cancelled';

/**
 * Tell the canteen's cashiers that its payment queue changed. IDs only: the
 * kitchen never receives unpaid orders, so cashiers re-read the queue through
 * the CASHIER-only API. App orders only (walk-in bills are paid at once).
 */
export function queuePaymentQueueChange(
  outbox: Outbox,
  order: { id: string; canteenId: string; channel: string },
  change: PaymentQueueChange,
): void {
  if (order.channel !== 'APP') return;
  outbox.emit('payment.queue_changed', [rooms.canteen(order.canteenId)], {
    canteenId: order.canteenId,
    orderId: order.id,
    change,
  });
}
