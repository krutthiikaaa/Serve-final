/** India Standard Time is UTC+05:30 all year (no daylight saving). */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** Interpret a civil date/time as Asia/Kolkata and return the UTC Date. */
export function fromIst(parts: {
  year: number;
  month: number;
  day: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}): Date {
  const utcAsIfIst = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hours ?? 0,
    parts.minutes ?? 0,
    parts.seconds ?? 0,
  );
  return new Date(utcAsIfIst - IST_OFFSET_MS);
}

/** IST wall-clock fields of a UTC instant. Weekday is ISO: 1 = Monday … 7 = Sunday. */
export function istParts(now: Date): { weekday: number; minutes: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const jsDay = shifted.getUTCDay();
  return {
    weekday: jsDay === 0 ? 7 : jsDay,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Start of the current calendar day in IST, as a UTC Date. */
export function startOfIstDay(now: Date = new Date()): Date {
  const shifted = now.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}
