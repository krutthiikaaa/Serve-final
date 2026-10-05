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
  outbox.emit(name, [rooms.student(order.studentId)], {
    order: toOrderDto(order, 'student'),
    previousStatus,
  });
  if (order.paidAt !== null) {
    outbox.emit(name, [rooms.canteen(order.canteenId)], {
      order: toOrderDto(order, 'staff'),
      previousStatus,
    });
  }
  outbox.emit(name, [rooms.admins()], { order: toOrderDto(order, 'admin'), previousStatus });
}
