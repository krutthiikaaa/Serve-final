import { describe, expect, it } from 'vitest';
import { fromIst } from '../../src/lib/time.js';
import {
  isWithinOperatingWindow,
  operatingSchedulesOverlap,
  validateOperatingSchedules,
} from '../../src/modules/canteens/schedule.js';
import { evaluateServiceAvailability } from '../../src/modules/canteens/availability.js';

/** Monday 2 Nov 2026, Tuesday 3 Nov, Sunday 8 Nov. */
const monday = (hours: number, minutes = 0, seconds = 0) =>
  fromIst({ year: 2026, month: 11, day: 2, hours, minutes, seconds });
const tuesday = (hours: number, minutes = 0) =>
  fromIst({ year: 2026, month: 11, day: 3, hours, minutes });
const sunday = (hours: number, minutes = 0) =>
  fromIst({ year: 2026, month: 11, day: 8, hours, minutes });

const overnightMon = {
  weekday: 1,
  opensAtMinutes: 21 * 60,
  closesAtMinutes: 3 * 60,
};
const overnightSun = {
  weekday: 7,
  opensAtMinutes: 21 * 60,
  closesAtMinutes: 3 * 60,
};
const overnightTue = {
  weekday: 2,
  opensAtMinutes: 21 * 60,
  closesAtMinutes: 3 * 60,
};

describe('overnight weekday evaluation', () => {
  it('keeps Monday 21:00–03:00 open through Tuesday 01:00 and closed at 03:00', () => {
    const rows = [overnightMon];
    expect(isWithinOperatingWindow(rows, monday(21, 0))).toBe(true);
    expect(isWithinOperatingWindow(rows, monday(23, 59))).toBe(true);
    expect(isWithinOperatingWindow(rows, tuesday(0, 0))).toBe(true);
    expect(isWithinOperatingWindow(rows, tuesday(1, 0))).toBe(true);
    expect(isWithinOperatingWindow(rows, tuesday(3, 0))).toBe(false);
    expect(isWithinOperatingWindow(rows, tuesday(3, 1))).toBe(false);
    expect(isWithinOperatingWindow(rows, monday(20, 59))).toBe(false);
  });

  it('uses Sunday’s overnight window on Monday morning', () => {
    const rows = [overnightSun];
    expect(isWithinOperatingWindow(rows, sunday(21, 0))).toBe(true);
    expect(isWithinOperatingWindow(rows, monday(1, 0))).toBe(true);
    expect(isWithinOperatingWindow(rows, monday(3, 0))).toBe(false);
  });

  it('does not treat Tuesday evening as leftover from Monday overnight', () => {
    const onlyMonday = [overnightMon];
    expect(isWithinOperatingWindow(onlyMonday, tuesday(21, 0))).toBe(false);
    expect(isWithinOperatingWindow(onlyMonday, tuesday(4, 0))).toBe(false);

    const both = [overnightMon, overnightTue];
    expect(isWithinOperatingWindow(both, tuesday(1, 0))).toBe(true);
    expect(isWithinOperatingWindow(both, tuesday(3, 0))).toBe(false);
    expect(isWithinOperatingWindow(both, tuesday(21, 0))).toBe(true);
  });

  it('treats closing time as exclusive', () => {
    const daytime = [{ weekday: 1, opensAtMinutes: 8 * 60, closesAtMinutes: 14 * 60 }];
    expect(isWithinOperatingWindow(daytime, monday(8, 0))).toBe(true);
    expect(isWithinOperatingWindow(daytime, monday(13, 59))).toBe(true);
    expect(isWithinOperatingWindow(daytime, monday(14, 0))).toBe(false);
  });
});

describe('schedule validation', () => {
  it('rejects weekdays outside 1–7, minutes outside 0–1439, and equal open/close', () => {
    expect(() =>
      validateOperatingSchedules([{ weekday: 0, opensAtMinutes: 0, closesAtMinutes: 60 }]),
    ).toThrow(/weekday/i);
    expect(() =>
      validateOperatingSchedules([{ weekday: 8, opensAtMinutes: 0, closesAtMinutes: 60 }]),
    ).toThrow(/weekday/i);
    expect(() =>
      validateOperatingSchedules([{ weekday: 1, opensAtMinutes: 1440, closesAtMinutes: 0 }]),
    ).toThrow(/minutes/i);
    expect(() =>
      validateOperatingSchedules([{ weekday: 1, opensAtMinutes: 0, closesAtMinutes: 1440 }]),
    ).toThrow(/minutes/i);
    expect(() =>
      validateOperatingSchedules([{ weekday: 1, opensAtMinutes: 600, closesAtMinutes: 600 }]),
    ).toThrow(/equal|zero|same/i);
  });

  it('rejects duplicate weekdays', () => {
    expect(() =>
      validateOperatingSchedules([
        { weekday: 1, opensAtMinutes: 8 * 60, closesAtMinutes: 12 * 60 },
        { weekday: 1, opensAtMinutes: 13 * 60, closesAtMinutes: 18 * 60 },
      ]),
    ).toThrow(/duplicate/i);
  });

  it('allows Monday overnight meeting Tuesday at 03:00 and rejects overlaps', () => {
    expect(() =>
      validateOperatingSchedules([
        overnightMon,
        { weekday: 2, opensAtMinutes: 3 * 60, closesAtMinutes: 14 * 60 },
      ]),
    ).not.toThrow();

    expect(() =>
      validateOperatingSchedules([
        overnightMon,
        { weekday: 2, opensAtMinutes: 2 * 60, closesAtMinutes: 14 * 60 },
      ]),
    ).toThrow(/overlap/i);

    expect(() =>
      validateOperatingSchedules([
        overnightMon,
        { weekday: 2, opensAtMinutes: 1 * 60, closesAtMinutes: 4 * 60 },
      ]),
    ).toThrow(/overlap/i);
  });

  it('allows missing weekdays and overlapping DAY vs NIGHT on separate services', () => {
    expect(() => validateOperatingSchedules([overnightMon])).not.toThrow();
    const day = [{ weekday: 1, opensAtMinutes: 0, closesAtMinutes: 14 * 60 }];
    const night = [overnightMon];
    expect(() => validateOperatingSchedules(day)).not.toThrow();
    expect(() => validateOperatingSchedules(night)).not.toThrow();
  });
});

const accepting = { isActive: true, isAcceptingOrders: true };
const enabledOpen = { isEnabled: true, override: 'FORCE_OPEN' as const };
const enabledAuto = { isEnabled: true, override: 'AUTO' as const };

describe('availability priority', () => {
  it('rejects inactive canteens before every other check', () => {
    const result = evaluateServiceAvailability({
      canteen: { isActive: false, isAcceptingOrders: true },
      service: { isEnabled: true, override: 'FORCE_OPEN' },
      schedules: [overnightMon],
      now: monday(22),
    });
    expect(result).toMatchObject({ open: false, code: 'CANTEEN_INACTIVE' });
  });

  it('rejects a global pause even when the service is FORCE_OPEN', () => {
    const result = evaluateServiceAvailability({
      canteen: { isActive: true, isAcceptingOrders: false },
      service: { isEnabled: true, override: 'FORCE_OPEN' },
      schedules: [],
      now: monday(12),
    });
    expect(result).toMatchObject({ open: false, code: 'CANTEEN_NOT_ACCEPTING_ORDERS' });
  });

  it('rejects a disabled service even when FORCE_OPEN and a schedule would be open', () => {
    const result = evaluateServiceAvailability({
      canteen: accepting,
      service: { isEnabled: false, override: 'FORCE_OPEN' },
      schedules: [overnightMon],
      now: monday(22),
    });
    expect(result).toMatchObject({ open: false, code: 'SERVICE_DISABLED' });
  });

  it('rejects FORCE_CLOSED after the first three checks pass', () => {
    const result = evaluateServiceAvailability({
      canteen: accepting,
      service: { isEnabled: true, override: 'FORCE_CLOSED' },
      schedules: [overnightMon],
      now: monday(22),
    });
    expect(result).toMatchObject({ open: false, code: 'SERVICE_CLOSED' });
  });

  it('allows FORCE_OPEN without a schedule when the canteen and service are enabled', () => {
    const result = evaluateServiceAvailability({
      canteen: accepting,
      service: enabledOpen,
      schedules: [],
      now: monday(12),
    });
    expect(result).toMatchObject({ open: true, code: 'OPEN' });
  });

  it('fails closed for AUTO without a schedule', () => {
    const result = evaluateServiceAvailability({
      canteen: accepting,
      service: enabledAuto,
      schedules: [],
      now: monday(22),
    });
    expect(result).toMatchObject({ open: false, code: 'SERVICE_SCHEDULE_NOT_CONFIGURED' });
    expect(result.warnings).toContain('AUTO_WITHOUT_SCHEDULE');
  });

  it('allows AUTO inside hours and rejects AUTO outside hours', () => {
    const inside = evaluateServiceAvailability({
      canteen: accepting,
      service: enabledAuto,
      schedules: [overnightMon],
      now: tuesday(1),
    });
    expect(inside).toMatchObject({ open: true, code: 'OPEN' });

    const outside = evaluateServiceAvailability({
      canteen: accepting,
      service: enabledAuto,
      schedules: [overnightMon],
      now: tuesday(3),
    });
    expect(outside).toMatchObject({ open: false, code: 'SERVICE_CLOSED' });
  });

  it('fails closed when stored AUTO schedules are invalid', () => {
    const result = evaluateServiceAvailability({
      canteen: accepting,
      service: enabledAuto,
      schedules: [
        overnightMon,
        { weekday: 2, opensAtMinutes: 2 * 60, closesAtMinutes: 14 * 60 },
      ],
      now: tuesday(1),
    });
    expect(result).toMatchObject({ open: false, code: 'SERVICE_SCHEDULE_NOT_CONFIGURED' });
    expect(result.warnings).toContain('INVALID_SCHEDULE');
  });

  it('detects overlapping DAY and NIGHT windows and allows adjacent meetings', () => {
    const day = [{ weekday: 1, opensAtMinutes: 8 * 60, closesAtMinutes: 16 * 60 }];
    const overlappingNight = [{ weekday: 1, opensAtMinutes: 12 * 60, closesAtMinutes: 20 * 60 }];
    const adjacentNight = [{ weekday: 1, opensAtMinutes: 16 * 60, closesAtMinutes: 22 * 60 }];
    expect(operatingSchedulesOverlap(day, overlappingNight)).toBe(true);
    expect(operatingSchedulesOverlap(day, adjacentNight)).toBe(false);
  });

  it('treats a missing service as disabled', () => {
    const result = evaluateServiceAvailability({
      canteen: accepting,
      service: null,
      schedules: [],
      now: monday(22),
    });
    expect(result).toMatchObject({ open: false, code: 'SERVICE_DISABLED' });
  });
});
