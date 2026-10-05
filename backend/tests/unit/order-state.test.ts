import { describe, expect, it } from 'vitest';
import {
  ORDER_TRANSITIONS,
  STAFF_SETTABLE_STATUSES,
  assertTransition,
  canTransition,
} from '../../src/modules/orders/order-state.js';

const ALL = [
  'PLACED',
  'PAYMENT_CONFIRMED',
  'PREPARING',
  'READY',
  'COLLECTED',
  'CANCELLED',
] as const;

const ALLOWED = new Set([
  'PLACED>PAYMENT_CONFIRMED',
  'PLACED>CANCELLED',
  'PAYMENT_CONFIRMED>PREPARING',
  'PAYMENT_CONFIRMED>CANCELLED',
  'PREPARING>READY',
  'READY>COLLECTED',
]);

describe('order state machine', () => {
  it.each(ALL.flatMap((from) => ALL.map((to) => [from, to] as const)))('%s -> %s', (from, to) => {
    const expected = ALLOWED.has(`${from}>${to}`);
    expect(canTransition(from, to)).toBe(expected);
    if (expected) expect(() => assertTransition(from, to)).not.toThrow();
    else expect(() => assertTransition(from, to)).toThrow(/cannot move/);
  });

  it('has terminal COLLECTED and CANCELLED states', () => {
    expect(ORDER_TRANSITIONS.COLLECTED).toEqual([]);
    expect(ORDER_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('never lets staff set payment states', () => {
    expect(STAFF_SETTABLE_STATUSES).not.toContain('PLACED');
    expect(STAFF_SETTABLE_STATUSES).not.toContain('PAYMENT_CONFIRMED');
  });

  it('reports INVALID_STATUS_TRANSITION with from/to details', () => {
    try {
      assertTransition('COLLECTED', 'PREPARING');
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 409,
        code: 'INVALID_STATUS_TRANSITION',
        details: { from: 'COLLECTED', to: 'PREPARING' },
      });
    }
  });
});
