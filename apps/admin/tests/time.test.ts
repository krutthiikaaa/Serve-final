import { describe, expect, it } from 'vitest';
import { formatMinutes12, formatWindow, minutesToParts, partsToMinutes } from '../src/lib/time';

describe('admin time conversion', () => {
  it('round-trips minutes through a 12-hour clock', () => {
    expect(partsToMinutes(9, 0, 'PM')).toBe(21 * 60);
    expect(minutesToParts(21 * 60)).toEqual({ hour12: 9, minute: 0, period: 'PM' });
    expect(formatMinutes12(0)).toBe('12:00 AM');
    expect(formatMinutes12(12 * 60)).toBe('12:00 PM');
    expect(formatWindow(21 * 60, 3 * 60)).toBe('9:00 PM – 3:00 AM (overnight)');
  });
});
