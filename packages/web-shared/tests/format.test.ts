import { describe, expect, it } from 'vitest';
import { formatRupees, paiseToRupeesInput, rupeesToPaise, timeAgo } from '../src/format';

describe('money formatting', () => {
  it.each([
    ['120', 12_000],
    ['99.5', 9_950],
    ['99.50', 9_950],
    [' 45 ', 4_500],
    ['0.01', 1],
    ['10000', 1_000_000],
  ])('converts ₹%s to %i paise with integer maths', (input, paise) => {
    expect(rupeesToPaise(input)).toBe(paise);
  });

  it.each(['', 'abc', '-5', '1.234', '1,000', '12.', '.5', '1e3'])('rejects %j', (input) => {
    expect(rupeesToPaise(input)).toBeNull();
  });

  it('formats paise as rupees', () => {
    expect(formatRupees(12_000)).toBe('₹120');
    expect(formatRupees(9_950)).toBe('₹99.50');
    expect(formatRupees(12_500_000)).toBe('₹1,25,000');
  });

  it('round-trips prices for editing', () => {
    expect(paiseToRupeesInput(12_000)).toBe('120');
    expect(paiseToRupeesInput(9_950)).toBe('99.50');
    expect(rupeesToPaise(paiseToRupeesInput(1_999))).toBe(1_999);
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-06T20:00:00Z');
  it('describes recent times', () => {
    expect(timeAgo('2026-10-06T19:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-06T19:55:00Z', now)).toBe('5 min ago');
    expect(timeAgo('2026-10-06T17:00:00Z', now)).toBe('3 h ago');
  });
});
