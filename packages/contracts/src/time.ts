/**
 * Wall-clock ↔ instant conversion for a fixed IANA time zone, DST-safe, without a date
 * library. Instants are UTC `Date`s; wall-clock values are `YYYY-MM-DD` and `HH:MM` strings.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

export interface ZonedParts {
  /** `YYYY-MM-DD` on the local calendar. */
  date: string;
  /** `HH:MM`, 24-hour. */
  time: string;
  /** ISO weekday: Monday = 1 … Sunday = 7. */
  isoWeekday: number;
  /** Minutes since local midnight (0–1439). */
  minuteOfDay: number;
}

/** What a wall clock in `timeZone` shows at `instant`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date,
    time: `${parts.hour}:${parts.minute}`,
    isoWeekday: isoWeekday(date),
    minuteOfDay: hour * 60 + minute,
  };
}

/** ISO weekday (Monday = 1) of a `YYYY-MM-DD` calendar date. */
export function isoWeekday(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The calendar date `days` after `date` (`YYYY-MM-DD`, years 0000–9999 only). */
export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = next.getUTCFullYear();
  // toISOString() writes +010000-… past 9999, which breaks string comparison of dates.
  if (nextYear < 0 || nextYear > 9999) throw new RangeError(`Date out of range: ${date} + ${days}`);
  return next.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `instant` read on the wall clock of `timeZone`, as if that wall time were UTC (ms). */
export function wallClockMs(instant: Date, timeZone: string): number {
  const { date, minuteOfDay } = zonedParts(instant, timeZone);
  return Date.parse(`${date}T00:00:00Z`) + minuteOfDay * 60_000;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Local time minus UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const { date, minuteOfDay } = zonedParts(new Date(instant), timeZone);
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day) + minuteOfDay * 60_000;
  return wallAsUtc - Math.floor(instant / 60_000) * 60_000;
}

/**
 * The instant at which a wall clock in `timeZone` shows `date` `time`, or null for input
 * that is not a real date/time. Around DST changes: a time skipped by the spring-forward
 * gap resolves to the same distance past the gap (03:30 → 04:30 in Athens), and a time
 * that occurs twice in autumn resolves to the earlier of the two instants.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date | null {
  const d = DATE.exec(date);
  const t = TIME.exec(time);
  if (!d || !t) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const wallAsUtc = Date.UTC(year, month - 1, day, Number(t[1]), Number(t[2]));
  // Reject dates that roll over (2026-02-30 → March 2).
  if (new Date(wallAsUtc).toISOString().slice(0, 10) !== date) return null;

  const before = offsetAt(wallAsUtc - 86_400_000, timeZone);
  const after = offsetAt(wallAsUtc + 86_400_000, timeZone);
  const matches = [wallAsUtc - before, wallAsUtc - after].filter((instant) => {
    const parts = zonedParts(new Date(instant), timeZone);
    return parts.date === date && parts.time === time;
  });
  // In a gap neither offset reproduces the wall time; the pre-transition offset lands past it.
  return new Date(matches.length > 0 ? Math.min(...matches) : wallAsUtc - before);
}
