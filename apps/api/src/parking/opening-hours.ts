import {
  addDays,
  daysBetween,
  isoWeekday,
  MAX_BOOKING_DAYS,
  zonedParts,
} from '@parkfairy/contracts';

const MINUTES_PER_DAY = 24 * 60;

/** `[opensMinute, closesMinute)` after local midnight on an ISO weekday (Monday = 1). */
export interface OpeningPeriod {
  weekday: number;
  opensMinute: number;
  closesMinute: number;
}

/**
 * Days (`YYYY-MM-DD`, both ends included) whose hours differ from the week's: open
 * `[opensMinute, closesMinute)` instead, or the week's hours less
 * `[closedFromMinute, closedToMinute)`, or with neither closed all day.
 */
export interface DatedHours {
  startsOn: string;
  endsOn: string;
  opensMinute: number | null;
  closesMinute: number | null;
  closedFromMinute: number | null;
  closedToMinute: number | null;
}

type Period = Pick<OpeningPeriod, 'opensMinute' | 'closesMinute'>;

/** Whether the periods cover `[from, to)` minutes of one day (touching periods join up). */
function covers(periods: Period[], from: number, to: number): boolean {
  let reached = from;
  for (const period of [...periods].sort((a, b) => a.opensMinute - b.opensMinute)) {
    if (period.opensMinute > reached) break;
    reached = Math.max(reached, period.closesMinute);
    if (reached >= to) return true;
  }
  return reached >= to;
}

/** The periods of one day: the week's, unless a closure or special hours cover it. */
function periodsOn(
  day: string,
  weekly: OpeningPeriod[],
  exceptions: readonly DatedHours[],
): Period[] {
  const weekday = isoWeekday(day);
  const week = weekly.filter((period) => period.weekday === weekday);
  const special = exceptions.find(({ startsOn, endsOn }) => startsOn <= day && day <= endsOn);
  if (!special) return week;
  const { opensMinute, closesMinute, closedFromMinute: from, closedToMinute: to } = special;
  if (from !== null && to !== null) {
    // The week's periods with `[from, to)` cut out: what's left either side of it.
    return week.flatMap(({ opensMinute: opens, closesMinute: closes }) => [
      ...(opens < from ? [{ opensMinute: opens, closesMinute: Math.min(closes, from) }] : []),
      ...(closes > to ? [{ opensMinute: Math.max(opens, to), closesMinute: closes }] : []),
    ]);
  }
  return opensMinute === null || closesMinute === null ? [] : [{ opensMinute, closesMinute }];
}

/**
 * Whether a listing is open for the whole of `[start, end)`. The window is read on the
 * listing's wall clock, day by day, so a day lasting 23 or 25 hours (DST) is handled like
 * any other: opening hours are wall-clock times. Midnight joins consecutive days, so
 * `…–24:00` followed by `00:00–…` is continuous. A day with a closure or special hours uses
 * those instead of the week's.
 */
export function isOpenThroughout(
  periods: OpeningPeriod[],
  start: Date,
  end: Date,
  timeZone: string,
  exceptions: readonly DatedHours[] = [],
): boolean {
  if (end <= start) return false;
  const first = zonedParts(start, timeZone);
  const last = zonedParts(end, timeZone);
  const span = daysBetween(first.date, last.date);
  // Contracts cap stays at 30 days; refuse anything else rather than walk an unbounded range.
  if (!Number.isInteger(span) || span < 0 || span > MAX_BOOKING_DAYS + 1) return false;
  for (let offset = 0; offset <= span; offset++) {
    const day = addDays(first.date, offset);
    const from = offset === 0 ? first.minuteOfDay : 0;
    const to = offset === span ? last.minuteOfDay : MINUTES_PER_DAY;
    if (to <= from) continue; // the window ends exactly at this day's midnight
    if (!covers(periodsOn(day, periods, exceptions), from, to)) return false;
  }
  return true;
}

/** `HH:MM` for a minute of the day; 1440 is `24:00`. */
export function wallTime(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** A dated entry's minutes as the contracts write them: `HH:MM`, `24:00` the end of the day. */
export function hoursOf({
  opensMinute,
  closesMinute,
  closedFromMinute,
  closedToMinute,
}: DatedHours) {
  return {
    hours:
      opensMinute === null || closesMinute === null
        ? null
        : { opens: wallTime(opensMinute), closes: wallTime(closesMinute) },
    closedHours:
      closedFromMinute === null || closedToMinute === null
        ? null
        : { from: wallTime(closedFromMinute), to: wallTime(closedToMinute) },
  };
}
