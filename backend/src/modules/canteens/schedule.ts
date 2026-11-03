import { ValidationError } from '../../lib/errors.js';
import { istParts } from '../../lib/time.js';

export interface OperatingScheduleRow {
  weekday: number;
  opensAtMinutes: number;
  closesAtMinutes: number;
}

export type ScheduleIssueCode =
  | 'INVALID_WEEKDAY'
  | 'INVALID_MINUTES'
  | 'ZERO_LENGTH_WINDOW'
  | 'DUPLICATE_WEEKDAY'
  | 'OVERLAPPING_SCHEDULE';

export interface ScheduleIssue {
  code: ScheduleIssueCode;
  message: string;
  weekday?: number;
}

export function isOvernight(row: Pick<OperatingScheduleRow, 'opensAtMinutes' | 'closesAtMinutes'>) {
  return row.closesAtMinutes < row.opensAtMinutes;
}

function nextWeekday(weekday: number) {
  return weekday === 7 ? 1 : weekday + 1;
}

export function inspectOperatingSchedules(rows: readonly OperatingScheduleRow[]): {
  ok: boolean;
  issues: ScheduleIssue[];
} {
  const issues: ScheduleIssue[] = [];
  const seen = new Map<number, OperatingScheduleRow>();

  for (const row of rows) {
    if (!Number.isInteger(row.weekday) || row.weekday < 1 || row.weekday > 7) {
      issues.push({
        code: 'INVALID_WEEKDAY',
        message: 'Weekday must be between 1 (Monday) and 7 (Sunday).',
        weekday: row.weekday,
      });
      continue;
    }
    const minutesOk =
      Number.isInteger(row.opensAtMinutes) &&
      Number.isInteger(row.closesAtMinutes) &&
      row.opensAtMinutes >= 0 &&
      row.opensAtMinutes <= 1439 &&
      row.closesAtMinutes >= 0 &&
      row.closesAtMinutes <= 1439;
    if (!minutesOk) {
      issues.push({
        code: 'INVALID_MINUTES',
        message: 'Opening and closing times must be minutes from midnight between 0 and 1439.',
        weekday: row.weekday,
      });
      continue;
    }
    if (row.opensAtMinutes === row.closesAtMinutes) {
      issues.push({
        code: 'ZERO_LENGTH_WINDOW',
        message: 'Opening and closing times must not be equal.',
        weekday: row.weekday,
      });
      continue;
    }
    if (seen.has(row.weekday)) {
      issues.push({
        code: 'DUPLICATE_WEEKDAY',
        message: 'Duplicate weekday: each weekday may have only one operating window per service.',
        weekday: row.weekday,
      });
      continue;
    }
    seen.set(row.weekday, row);
  }

  for (const row of seen.values()) {
    if (!isOvernight(row)) continue;
    const next = seen.get(nextWeekday(row.weekday));
    if (next && next.opensAtMinutes < row.closesAtMinutes) {
      issues.push({
        code: 'OVERLAPPING_SCHEDULE',
        message:
          'This overnight window overlaps the next day’s opening time. Adjacent days may meet at the closing minute but must not overlap.',
        weekday: row.weekday,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Throws 422 INVALID_SCHEDULE. Used by Admin configuration APIs (Phase 3). */
export function validateOperatingSchedules(rows: readonly OperatingScheduleRow[]): void {
  const { ok, issues } = inspectOperatingSchedules(rows);
  if (ok) return;
  const first = issues[0]!;
  throw new ValidationError(first.message, { issues }, 'INVALID_SCHEDULE');
}

/** Half-open [start, end) minute ranges per weekday, splitting overnight windows. */
export function expandOperatingWindows(
  rows: readonly OperatingScheduleRow[],
): { weekday: number; start: number; end: number }[] {
  const windows: { weekday: number; start: number; end: number }[] = [];
  for (const row of rows) {
    if (isOvernight(row)) {
      windows.push({ weekday: row.weekday, start: row.opensAtMinutes, end: 1440 });
      windows.push({ weekday: nextWeekday(row.weekday), start: 0, end: row.closesAtMinutes });
    } else {
      windows.push({
        weekday: row.weekday,
        start: row.opensAtMinutes,
        end: row.closesAtMinutes,
      });
    }
  }
  return windows;
}

/**
 * True when two schedule sets occupy overlapping minutes on the same weekday.
 * Adjacent meetings (one closes at the minute the other opens) are not overlaps.
 */
export function operatingSchedulesOverlap(
  left: readonly OperatingScheduleRow[],
  right: readonly OperatingScheduleRow[],
): boolean {
  const a = expandOperatingWindows(left);
  const b = expandOperatingWindows(right);
  for (const x of a) {
    for (const y of b) {
      if (x.weekday === y.weekday && x.start < y.end && y.start < x.end) return true;
    }
  }
  return false;
}

/**
 * True when `now` (UTC instant, evaluated in Asia/Kolkata) falls inside a
 * valid operating window. Close is exclusive. Overnight windows are stored on
 * the starting weekday and remain active until the next morning’s close.
 *
 * Callers must fail closed themselves when `inspectOperatingSchedules` is not ok.
 */
export function isWithinOperatingWindow(
  rows: readonly OperatingScheduleRow[],
  now: Date,
): boolean {
  const { weekday, minutes } = istParts(now);
  const byWeekday = new Map(rows.map((row) => [row.weekday, row]));
  const today = byWeekday.get(weekday);
  const yesterday = byWeekday.get(weekday === 1 ? 7 : weekday - 1);

  if (today) {
    if (isOvernight(today)) {
      if (minutes >= today.opensAtMinutes) return true;
    } else if (today.opensAtMinutes <= minutes && minutes < today.closesAtMinutes) {
      return true;
    }
  }

  if (yesterday && isOvernight(yesterday) && minutes < yesterday.closesAtMinutes) {
    return true;
  }

  return false;
}
