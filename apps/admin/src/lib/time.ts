/** Backend weekday: 1 = Monday … 7 = Sunday (Asia/Kolkata). */
export const WEEKDAYS = [
  { weekday: 1, label: 'Monday' },
  { weekday: 2, label: 'Tuesday' },
  { weekday: 3, label: 'Wednesday' },
  { weekday: 4, label: 'Thursday' },
  { weekday: 5, label: 'Friday' },
  { weekday: 6, label: 'Saturday' },
  { weekday: 7, label: 'Sunday' },
] as const;

export type DayPeriod = 'AM' | 'PM';

export function minutesToParts(minutes: number): {
  hour12: number;
  minute: number;
  period: DayPeriod;
} {
  const clamped = Math.min(1439, Math.max(0, Math.trunc(minutes)));
  const hour24 = Math.floor(clamped / 60);
  return {
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: clamped % 60,
    period: hour24 >= 12 ? 'PM' : 'AM',
  };
}

export function partsToMinutes(hour12: number, minute: number, period: DayPeriod): number {
  let hour24 = hour12 % 12;
  if (period === 'PM') hour24 += 12;
  return hour24 * 60 + minute;
}

/** 12-hour clock, e.g. "9:00 PM". */
export function formatMinutes12(minutes: number): string {
  const { hour12, minute, period } = minutesToParts(minutes);
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function isOvernight(opensAtMinutes: number, closesAtMinutes: number): boolean {
  return closesAtMinutes < opensAtMinutes;
}

export function formatWindow(opensAtMinutes: number, closesAtMinutes: number): string {
  const label = `${formatMinutes12(opensAtMinutes)} – ${formatMinutes12(closesAtMinutes)}`;
  return isOvernight(opensAtMinutes, closesAtMinutes) ? `${label} (overnight)` : label;
}
