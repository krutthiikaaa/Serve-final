import type { OrderStatus } from '../../generated/prisma/client.js';
import { ConflictError } from '../../lib/errors.js';

/**
 * The only legal order transitions.
 *
 *   PLACED ─► PAYMENT_CONFIRMED ─► PREPARING ─► READY ─► COLLECTED
 *     │              │
 *     └──► CANCELLED ◄┘          (cancellation only before preparation starts)
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PLACED: ['PAYMENT_CONFIRMED', 'CANCELLED'],
  PAYMENT_CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY'],
  READY: ['COLLECTED'],
  COLLECTED: [],
  CANCELLED: [],
};

/** Statuses staff may set. PAYMENT_CONFIRMED is set only by payment verification. */
export const STAFF_SETTABLE_STATUSES = ['PREPARING', 'READY', 'COLLECTED', 'CANCELLED'] as const;
export type StaffSettableStatus = (typeof STAFF_SETTABLE_STATUSES)[number];

export const ACTIVE_STATUSES: OrderStatus[] = ['PLACED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY'];
export const PAST_STATUSES: OrderStatus[] = ['COLLECTED', 'CANCELLED'];
/** Orders staff can see: paid ones only (unpaid PLACED orders never reach the kitchen). */
export const STAFF_VISIBLE_STATUSES: OrderStatus[] = [
  'PAYMENT_CONFIRMED',
  'PREPARING',
  'READY',
  'COLLECTED',
  'CANCELLED',
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictError(
      `An order cannot move from ${from} to ${to}.`,
      'INVALID_STATUS_TRANSITION',
      { from, to },
    );
  }
}

/** Timestamp column recorded when an order enters a status. */
export const STATUS_TIMESTAMP: Partial<
  Record<OrderStatus, 'paidAt' | 'preparingAt' | 'readyAt' | 'collectedAt' | 'cancelledAt'>
> = {
  PAYMENT_CONFIRMED: 'paidAt',
  PREPARING: 'preparingAt',
  READY: 'readyAt',
  COLLECTED: 'collectedAt',
  CANCELLED: 'cancelledAt',
};
