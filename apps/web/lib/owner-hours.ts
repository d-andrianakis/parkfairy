import type { OpeningPeriod } from '@parkfairy/contracts';

/** What the form shows for one day. A `closes` at or before `opens` runs past midnight. */
export interface DayHours {
  open: boolean;
  opens: string;
  closes: string;
}

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

/** One row per day, Monday first, for the periods the API keeps. */
export function periodsToDays(periods: OpeningPeriod[]): DayHours[] {
  const on = (weekday: number) =>
    periods
      .filter((period) => period.weekday === weekday)
      .sort((a, b) => a.opens.localeCompare(b.opens));
  /** Open past midnight: the evening's period runs to 24:00 and started later than 00:00. */
  const runsOvernight = (weekday: number) =>
    on(weekday).some(({ opens, closes }) => closes === END_OF_DAY && opens !== MIDNIGHT);

  return WEEKDAYS.map((weekday) => {
    // The small hours belong to the evening before.
    const own = on(weekday).filter(
      ({ opens, closes }) =>
        !(opens === MIDNIGHT && closes !== END_OF_DAY && runsOvernight(previousDay(weekday))),
    );
    const main = own.at(-1);
    if (!main) return { ...CLOSED };
    const tail = on(nextDay(weekday)).find(
      ({ opens, closes }) => opens === MIDNIGHT && closes !== END_OF_DAY,
    );
    const overnight = main.closes === END_OF_DAY && main.opens !== MIDNIGHT;
    return { open: true, opens: main.opens, closes: overnight && tail ? tail.closes : main.closes };
  });
}

/** The periods for what the form shows. Past midnight becomes two, one on each day. */
export function daysToPeriods(days: DayHours[]): OpeningPeriod[] {
  const periods = days.flatMap(({ open, opens, closes }, index): OpeningPeriod[] => {
    if (!open) return [];
    const weekday = WEEKDAYS[index] ?? 1;
    if (closes > opens) return [{ weekday, opens, closes }];
    const evening = { weekday, opens, closes: END_OF_DAY };
    return closes === MIDNIGHT
      ? [evening]
      : [evening, { weekday: nextDay(weekday), opens: MIDNIGHT, closes }];
  });
  return periods.sort((a, b) => a.weekday - b.weekday || a.opens.localeCompare(b.opens));
}
