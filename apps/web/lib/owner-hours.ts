import type { OpeningPeriod } from '@parkfairy/contracts';

/** What the form shows for one day. A `closes` at or before `opens` runs past midnight. */
export interface DayHours {
  open: boolean;
  opens: string;
  closes: string;
  /** Closed for part of the day (decision #28): inside the hours, and over before midnight. */
  closedPart?: { from: string; to: string };
}

/** The usual lunch break, offered when an owner first asks for one. */
export const DEFAULT_CLOSED_PART = { from: '14:00', to: '17:00' };

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const MIDNIGHT = '00:00';
const END_OF_DAY = '24:00';
const CLOSED: DayHours = { open: false, opens: '08:00', closes: '20:00' };

const nextDay = (weekday: number) => (weekday === 7 ? 1 : weekday + 1);
const previousDay = (weekday: number) => (weekday === 1 ? 7 : weekday - 1);

export const ALL_WEEK: DayHours[] = WEEKDAYS.map(() => ({
  open: true,
  opens: MIDNIGHT,
  closes: END_OF_DAY,
}));

export const WORKING_WEEK: DayHours[] = WEEKDAYS.map((weekday) => ({
  open: weekday <= 5,
  opens: '08:00',
  closes: '20:00',
}));

/** What is wrong with a day's closed part, and on which of its two times to say so. */
export interface ClosedPartProblem {
  field: 'from' | 'to';
  reason: 'order' | 'outside';
}

/**
 * Null when a day's closed part ends after it starts and lies inside the day's hours, with open
 * time either side, before midnight. Otherwise the time to change: the end when the part runs
 * backwards or past closing, the start when it begins at or before opening.
 */
export function closedPartProblem({
  opens,
  closes,
  closedPart,
}: DayHours): ClosedPartProblem | null {
  if (!closedPart) return null;
  const end = closes > opens ? closes : END_OF_DAY;
  if (closedPart.from >= closedPart.to) return { field: 'to', reason: 'order' };
  if (closedPart.from <= opens) return { field: 'from', reason: 'outside' };
  if (closedPart.to >= end) return { field: 'to', reason: 'outside' };
  return null;
}

/** One row per day, Monday first, for the periods the API keeps. */
export function periodsToDays(periods: OpeningPeriod[]): DayHours[] {
  const on = (weekday: number) =>
    periods
      .filter((period) => period.weekday === weekday)
      .sort((a, b) => a.opens.localeCompare(b.opens));
  /**
   * The next morning's small hours, when they carry on this day's night: the evening runs to 24:00
   * from later than 00:00, and they end by the time this day opens. Ending later, "closes before
   * it opens" couldn't say so, and reading them as the night's would drop the next day's hours.
   */
  const tailOf = (weekday: number) => {
    const periods = on(weekday);
    const evening = periods.some(
      ({ opens, closes }) => closes === END_OF_DAY && opens !== MIDNIGHT,
    );
    const dayOpens = periods.find(({ opens }) => opens !== MIDNIGHT)?.opens;
    if (!evening || dayOpens === undefined) return undefined;
    return on(nextDay(weekday)).find(
      ({ opens, closes }) => opens === MIDNIGHT && closes !== END_OF_DAY && closes <= dayOpens,
    );
  };

  return WEEKDAYS.map((weekday) => {
    // The small hours belong to the evening before.
    const before = tailOf(previousDay(weekday));
    const own = on(weekday).filter(
      (period) => !(before && period.opens === before.opens && period.closes === before.closes),
    );
    const first = own[0];
    const main = own.at(-1);
    if (!first || !main) return { ...CLOSED };
    const tail = tailOf(weekday);
    const overnight = main.closes === END_OF_DAY && main.opens !== MIDNIGHT;
    const day: DayHours = {
      open: true,
      opens: first.opens,
      closes: overnight && tail ? tail.closes : main.closes,
    };
    // Two periods of the day's own are its hours with a closed part between them.
    return first !== main && first.closes < main.opens
      ? { ...day, closedPart: { from: first.closes, to: main.opens } }
      : day;
  });
}

/** The periods for what the form shows. Past midnight becomes two, one on each day. */
export function daysToPeriods(days: DayHours[]): OpeningPeriod[] {
  const periods = days.flatMap(({ open, opens, closes, closedPart }, index): OpeningPeriod[] => {
    if (!open) return [];
    const weekday = WEEKDAYS[index] ?? 1;
    // The closed part comes out of the first period; `closedPartProblem` has kept it there.
    const before = closedPart ? [{ weekday, opens, closes: closedPart.from }] : [];
    const from = closedPart?.to ?? opens;
    if (closes > opens) return [...before, { weekday, opens: from, closes }];
    const evening = { weekday, opens: from, closes: END_OF_DAY };
    return closes === MIDNIGHT
      ? [...before, evening]
      : [...before, evening, { weekday: nextDay(weekday), opens: MIDNIGHT, closes }];
  });
  return periods.sort((a, b) => a.weekday - b.weekday || a.opens.localeCompare(b.opens));
}
