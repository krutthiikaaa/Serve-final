import { describe, expect, it } from 'vitest';
import {
  effectiveTarget,
  inWindow,
  isValidTimezone,
  localMinutes,
  nextScheduledTransition,
  scheduledTarget,
  validateAreaSchedule,
  type AreaScheduleFields,
  type AreaScheduleInput,
} from '../../src/modules/canteens/area-schedule.js';
import { evaluateServiceAvailability } from '../../src/modules/canteens/availability.js';

/** 2026-11-16 at hh:mm in Asia/Kolkata (UTC+05:30). */
const ist = (hours: number, minutes = 0, day = 16) =>
  new Date(Date.UTC(2026, 10, day, hours, minutes) - (5 * 60 + 30) * 60_000);
const hm = (hours: number, minutes = 0) => hours * 60 + minutes;

// Day 07:00–17:00, Night 18:00–06:00 (crosses midnight); gaps 06–07 and 17–18.
const area = (patch: Partial<AreaScheduleFields> = {}): AreaScheduleFields => ({
  autoSwitchEnabled: true,
  timezone: 'Asia/Kolkata',
  dayOpensAtMinutes: hm(7),
  dayClosesAtMinutes: hm(17),
  nightOpensAtMinutes: hm(18),
  nightClosesAtMinutes: hm(6),
  overrideTarget: null,
  overrideUntil: null,
  overrideSetAt: null,
  ...patch,
});

describe('schedule windows', () => {
  it('handles same-day and overnight windows, with exclusive close', () => {
    expect(inWindow(hm(7), hm(7), hm(17))).toBe(true);
    expect(inWindow(hm(17), hm(7), hm(17))).toBe(false);
    expect(inWindow(hm(23, 59), hm(18), hm(6))).toBe(true);
    expect(inWindow(hm(0), hm(18), hm(6))).toBe(true);
    expect(inWindow(hm(6), hm(18), hm(6))).toBe(false);
    expect(inWindow(hm(12), hm(12), hm(12))).toBe(false);
  });

  it('reads local time in the area time zone, not the server zone', () => {
    expect(localMinutes(ist(9, 15), 'Asia/Kolkata')).toBe(hm(9, 15));
    expect(localMinutes(ist(9, 15), 'UTC')).toBe(hm(3, 45));
  });

  it('picks Day, Night or neither at each boundary', () => {
    expect(scheduledTarget(area(), ist(6, 59))).toBe('NONE');
    expect(scheduledTarget(area(), ist(7))).toBe('DAY');
    expect(scheduledTarget(area(), ist(16, 59))).toBe('DAY');
    expect(scheduledTarget(area(), ist(17))).toBe('NONE');
    expect(scheduledTarget(area(), ist(18))).toBe('NIGHT');
    expect(scheduledTarget(area(), ist(2))).toBe('NIGHT');
    expect(scheduledTarget(area(), ist(6))).toBe('NONE');
  });

  it('finds the next transition, across midnight', () => {
    expect(nextScheduledTransition(area(), ist(12))).toEqual({ at: ist(17), target: 'NONE' });
    expect(nextScheduledTransition(area(), ist(17, 30))).toEqual({
      at: ist(18),
      target: 'NIGHT',
    });
    expect(nextScheduledTransition(area(), ist(23))).toEqual({
      at: ist(6, 0, 17),
      target: 'NONE',
    });
  });

  it('back-to-back windows produce one transition, not two', () => {
    const tight = area({ dayClosesAtMinutes: hm(18), nightClosesAtMinutes: hm(7) });
    expect(nextScheduledTransition(tight, ist(12))).toEqual({ at: ist(18), target: 'NIGHT' });
    expect(nextScheduledTransition(tight, ist(20))).toEqual({
      at: ist(7, 0, 17),
      target: 'DAY',
    });
  });

  it('computes transitions correctly across a daylight-saving change', () => {
    // America/New_York leaves DST on 2026-11-01 (02:00 EDT → 01:00 EST).
    const ny = area({ timezone: 'America/New_York' });
    const saturdayNoon = new Date('2026-10-31T16:00:00Z'); // 12:00 EDT
    expect(scheduledTarget(ny, saturdayNoon)).toBe('DAY');
    const sundayMorning = nextScheduledTransition(ny, new Date('2026-11-01T03:00:00Z'));
    // 06:00 EST on 2026-11-01 is 11:00 UTC.
    expect(sundayMorning).toEqual({ at: new Date('2026-11-01T11:00:00Z'), target: 'NONE' });
  });
});

describe('effective target', () => {
  it('follows the schedule when automatic', () => {
    expect(effectiveTarget(area(), ist(10))).toEqual({ mode: 'AUTOMATIC', target: 'DAY' });
  });

  it('leaves the state alone when automatic switching is off', () => {
    expect(effectiveTarget(area({ autoSwitchEnabled: false }), ist(10))).toEqual({
      mode: 'MANUAL',
      target: null,
    });
  });

  it('honours an override until it expires, then the schedule again', () => {
    const overridden = area({
      overrideTarget: 'NIGHT',
      overrideUntil: ist(17),
      overrideSetAt: ist(9),
    });
    expect(effectiveTarget(overridden, ist(16, 59))).toEqual({
      mode: 'MANUAL_OVERRIDE',
      target: 'NIGHT',
    });
    expect(effectiveTarget(overridden, ist(17))).toEqual({ mode: 'AUTOMATIC', target: 'NONE' });
  });

  it('keeps an override with no expiry until it is cleared', () => {
    const held = area({ overrideTarget: 'NONE', overrideUntil: null, overrideSetAt: ist(9) });
    expect(effectiveTarget(held, ist(10, 0, 20))).toEqual({
      mode: 'MANUAL_OVERRIDE',
      target: 'NONE',
    });
  });
});

describe('schedule validation', () => {
  const input: AreaScheduleInput = {
    autoSwitchEnabled: true,
    timezone: 'Asia/Kolkata',
    dayOpensAtMinutes: hm(7),
    dayClosesAtMinutes: hm(17),
    nightOpensAtMinutes: hm(18),
    nightClosesAtMinutes: hm(6),
  };
  const code = (patch: Partial<AreaScheduleInput>) => {
    try {
      validateAreaSchedule({ ...input, ...patch });
      return null;
    } catch (err) {
      const { details } = err as { details: { path: string; message: string }[] };
      return Object.fromEntries(details.map((issue) => [issue.path, issue.message]));
    }
  };

  it('accepts a valid schedule and Day-only / Night-only schedules', () => {
    expect(code({})).toBeNull();
    expect(code({ nightOpensAtMinutes: null, nightClosesAtMinutes: null })).toBeNull();
    expect(code({ dayOpensAtMinutes: null, dayClosesAtMinutes: null })).toBeNull();
  });

  it('rejects overlapping Day and Night hours', () => {
    expect(code({ nightOpensAtMinutes: hm(16) })).toHaveProperty('nightOpensAtMinutes');
    expect(code({ nightClosesAtMinutes: hm(8) })).toHaveProperty('nightOpensAtMinutes');
  });

  it('rejects half-set windows, equal times, out-of-range minutes and bad time zones', () => {
    expect(code({ dayClosesAtMinutes: null })).toHaveProperty('dayOpensAtMinutes');
    expect(code({ dayClosesAtMinutes: hm(7) })).toHaveProperty('dayClosesAtMinutes');
    expect(code({ dayOpensAtMinutes: 1440 })).toHaveProperty('dayOpensAtMinutes');
    expect(code({ timezone: 'Mars/Olympus' })).toHaveProperty('timezone');
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
  });

  it('requires hours before automatic switching can be turned on', () => {
    expect(
      code({
        dayOpensAtMinutes: null,
        dayClosesAtMinutes: null,
        nightOpensAtMinutes: null,
        nightClosesAtMinutes: null,
      }),
    ).toHaveProperty('autoSwitchEnabled');
  });
});

describe('pause is separate from being on duty', () => {
  it('an on-duty canteen that is paused takes no orders', () => {
    const result = evaluateServiceAvailability({
      canteen: { isActive: true, isAcceptingOrders: true, isPaused: true },
      service: { isEnabled: true, override: 'FORCE_OPEN' },
      schedules: [],
      now: ist(12),
    });
    expect(result).toMatchObject({ open: false, code: 'CANTEEN_NOT_ACCEPTING_ORDERS' });
  });
});
