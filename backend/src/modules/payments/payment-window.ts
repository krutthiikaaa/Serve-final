/**
 * The unpaid-order payment window (UPI claim queue).
 *
 * An app order is placed with a payment deadline (`Payment.paymentDueAt`).
 * Until the student says "I've paid" (`Payment.claimedAt`) the order expires
 * at that deadline; a claimed order never expires automatically — the
 * cashier confirms or rejects it. A rejected claim gets a fresh window.
 *
 * Every state change below is a conditional update on the Payment row, then
 * the Order row (always in that order), so claims, cashier decisions and
 * expiry passes — from any number of processes — serialise on the payment
 * row and exactly one of them wins.
 */

/** UNPAID_ORDER_EXPIRY_MINUTES from the environment. */
export interface PaymentWindowConfig {
  UNPAID_ORDER_EXPIRY_MINUTES: number;
}

export function paymentDueAt(from: Date, config: PaymentWindowConfig): Date {
  return new Date(from.getTime() + config.UNPAID_ORDER_EXPIRY_MINUTES * 60_000);
}

/** Payment.failureReason of an expired payment. */
export const EXPIRED_FAILURE_REASON = 'Payment window expired';

/** Order.cancelReason of an expired order (shown to the student). */
export function expiredCancelReason(config: PaymentWindowConfig): string {
  const minutes = config.UNPAID_ORDER_EXPIRY_MINUTES;
  return `Payment was not received within ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}
