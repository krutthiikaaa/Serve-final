import { ValidationError } from '../../lib/errors.js';

/**
 * Day/Night schedule of one service area. Pure functions: no database, no
 * clock of their own — `now` is always passed in (server clock, never a
 * device clock).
 *
 * Times are minutes from local midnight in the area's IANA time zone. A
 * window may cross midnight (closes < opens). The Day and Night windows of
 * an area never overlap (validated), so at any instant at most one of them
 * is scheduled.
 */

export type AreaTarget = 'DAY' | 'NIGHT' | 'NONE';
export type AreaMode = 'AUTOMATIC' | 'MANUAL_OVERRIDE' | 'MANUAL';

export interface AreaScheduleFields {
  autoSwitchEnabled: boolean;
  timezone: string;
  dayOpensAtMinutes: number | null;
  dayClosesAtMinutes: number | null;
  nightOpensAtMinutes: number | null;
  nightClosesAtMinutes: number | null;
  overrideTarget: AreaTarget | null;
  overrideUntil: Date | null;
  overrideSetAt: Date | null;
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const MINUTE_MS = 60_000;

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Local wall-clock parts of an instant in `timezone`. */
function localParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    minutes: get('hour') * 60 + get('minute'),
  };
}

export function localMinutes(now: Date, timezone: string): number {
  return localParts(now, timezone).minutes;
}

/** UTC instant of local `minutes` on the local date of `day` (handles any offset). */
function zonedInstant(
  day: { year: number; month: number; day: number },
  minutes: number,
  timezone: string,
): Date {
  const naive = Date.UTC(day.year, day.month - 1, day.day, Math.floor(minutes / 60), minutes % 60);
  // Offset of the zone near that instant; refined once for DST edges.
  let guess = naive;
  for (let i = 0; i < 2; i += 1) {
    const local = localParts(new Date(guess), timezone);
    const asUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      Math.floor(local.minutes / 60),
      local.minutes % 60,
    );
    guess = naive - (asUtc - guess);
  }
  return new Date(guess);
}

export function inWindow(minutes: number, opens: number, closes: number): boolean {
  if (opens === closes) return false;
  if (opens < closes) return minutes >= opens && minutes < closes;
  return minutes >= opens || minutes < closes;
}

function window(area: AreaScheduleFields, type: 'DAY' | 'NIGHT') {
  const opens = type === 'DAY' ? area.dayOpensAtMinutes : area.nightOpensAtMinutes;
  const closes = type === 'DAY' ? area.dayClosesAtMinutes : area.nightClosesAtMinutes;
  return opens === null || closes === null ? null : { opens, closes };
}

/** Which canteen the schedule alone wants at `now`. */
export function scheduledTarget(area: AreaScheduleFields, now: Date): AreaTarget {
  const minutes = localMinutes(now, area.timezone);
  const day = window(area, 'DAY');
  if (day && inWindow(minutes, day.opens, day.closes)) return 'DAY';
  const night = window(area, 'NIGHT');
  if (night && inWindow(minutes, night.opens, night.closes)) return 'NIGHT';
  return 'NONE';
}

/** The next instant after `now` at which the scheduled target changes. */
export function nextScheduledTransition(
  area: AreaScheduleFields,
  now: Date,
): { at: Date; target: AreaTarget } | null {
  const boundaries = [
    area.dayOpensAtMinutes,
    area.dayClosesAtMinutes,
    area.nightOpensAtMinutes,
    area.nightClosesAtMinutes,
  ].filter((value): value is number => value !== null);
  if (boundaries.length === 0) return null;
  const current = scheduledTarget(area, now);
  const today = localParts(now, area.timezone);
  const candidates: Date[] = [];
  for (let offset = 0; offset <= 2; offset += 1) {
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const day = {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
    };
    for (const minutes of boundaries) {
      const at = zonedInstant(day, minutes, area.timezone);
      if (at.getTime() > now.getTime()) candidates.push(at);
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  for (const at of candidates) {
    const target = scheduledTarget(area, at);
    if (target !== current) return { at, target };
  }
  return null;
}

/** An override is in force while it has no expiry or has not expired yet. */
export function overrideActive(area: AreaScheduleFields, now: Date): boolean {
  if (!area.overrideTarget) return false;
  return area.overrideUntil === null || area.overrideUntil.getTime() > now.getTime();
}

/**
 * The canteen that should serve the area now, and why:
 *   MANUAL_OVERRIDE  an admin's override is in force (until its expiry)
 *   AUTOMATIC        automatic switching follows the schedule
 *   MANUAL           automatic switching is off: the last manual choice stands
 *                    (`target` null = leave the current state unchanged)
 */
export function effectiveTarget(
  area: AreaScheduleFields,
  now: Date,
): { mode: AreaMode; target: AreaTarget | null } {
  if (overrideActive(area, now)) return { mode: 'MANUAL_OVERRIDE', target: area.overrideTarget };
  if (area.autoSwitchEnabled) return { mode: 'AUTOMATIC', target: scheduledTarget(area, now) };
  return { mode: 'MANUAL', target: null };
}

export interface AreaScheduleInput {
  autoSwitchEnabled: boolean;
  timezone: string;
  dayOpensAtMinutes: number | null;
  dayClosesAtMinutes: number | null;
  nightOpensAtMinutes: number | null;
  nightClosesAtMinutes: number | null;
}

/** Throws 422 INVALID_AREA_SCHEDULE with a field-level message. */
export function validateAreaSchedule(input: AreaScheduleInput): void {
  const fail = (field: string, message: string): never => {
    // Same shape as request-validation errors, so forms show it on the field.
    throw new ValidationError(message, [{ path: field, message }], 'INVALID_AREA_SCHEDULE');
  };
  if (!isValidTimezone(input.timezone)) fail('timezone', 'Choose a valid time zone.');
  for (const type of ['day', 'night'] as const) {
    const opens = input[`${type}OpensAtMinutes`];
    const closes = input[`${type}ClosesAtMinutes`];
    const label = type === 'day' ? 'Day' : 'Night';
    if ((opens === null) !== (closes === null)) {
      fail(`${type}OpensAtMinutes`, `Set both the ${label} opening and closing time, or neither.`);
    }
    for (const value of [opens, closes]) {
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 1439)) {
        fail(`${type}OpensAtMinutes`, `${label} times must be between 00:00 and 23:59.`);
      }
    }
    if (opens !== null && opens === closes) {
      fail(`${type}ClosesAtMinutes`, `${label} opening and closing times must differ.`);
    }
  }
  const { dayOpensAtMinutes: d1, dayClosesAtMinutes: d2 } = input;
  const { nightOpensAtMinutes: n1, nightClosesAtMinutes: n2 } = input;
  if (d1 !== null && d2 !== null && n1 !== null && n2 !== null) {
    for (let minute = 0; minute < 1440; minute += 1) {
      if (inWindow(minute, d1, d2) && inWindow(minute, n1, n2)) {
        fail('nightOpensAtMinutes', 'Day and Night hours overlap. One canteen serves at a time.');
      }
    }
  }
  if (input.autoSwitchEnabled && [d1, n1].every((value) => value === null)) {
    fail('autoSwitchEnabled', 'Set Day or Night hours before turning on automatic switching.');
  }
}

export const minutesToClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export { MINUTE_MS };
