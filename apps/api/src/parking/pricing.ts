import { BOOKING_STEP_MINUTES, MAX_BOOKING_DAYS, wallClockMs } from '@parkfairy/contracts';

const MINUTES_PER_DAY = 24 * 60;
const MINUTE_MS = 60_000;
const DAY_MS = MINUTES_PER_DAY * MINUTE_MS;
const STEP_MS = BOOKING_STEP_MINUTES * MINUTE_MS;
const STEPS_PER_DAY = MINUTES_PER_DAY / BOOKING_STEP_MINUTES;
const STEPS_PER_HOUR = 60 / BOOKING_STEP_MINUTES;

export interface Rates {
  hourlyRateMinor: number;
  /** Most one 24-hour period can cost; null when the owner sets no cap. */
  dailyMaxMinor: number | null;
}

export interface NightRate {
  rateMinor: number;
  /** Minutes after midnight on the wall clock; `to` before `from` runs across midnight. */
  fromMinute: number;
  toMinute: number;
}

export interface DatedRate {
  /** `YYYY-MM-DD` on the wall clock, both days included. */
  startsOn: string;
  endsOn: string;
  rateMinor: number;
}

export interface StayDiscount {
  minDays: number;
  percent: number;
}

/** What may replace the hourly rate, and what may come off a long stay (decision #17). */
export interface PriceRules {
  weekendRateMinor: number | null;
  night: NightRate | null;
  dated: DatedRate[];
  discounts: StayDiscount[];
}

export const NO_PRICE_RULES: PriceRules = {
  weekendRateMinor: null,
  night: null,
  dated: [],
  discounts: [],
};

export interface Stay {
  rates: Rates;
  rules: PriceRules;
  /** The space's own hourly rate, when it has one. */
  spaceRateMinor?: number | null;
  start: Date;
  end: Date;
  timeZone: string;
}

/**
 * Hourly rates over half hours become money only at the end, so rounding happens once per
 * period: `rate × half hours / 2`, up to the cent. `scale` carries a space's own rate.
 */
function toMoney(rateSum: number, scale: { numerator: number; denominator: number }): number {
  return Math.ceil((rateSum * scale.numerator) / (STEPS_PER_HOUR * scale.denominator));
}

/** Charged per 24 hours of the stay, the last one possibly shorter, each under the cap. */
function cappedTotal(
  dayRateSums: number[],
  capMinor: number | null,
  scale: { numerator: number; denominator: number },
): number {
  return dayRateSums.reduce((total, sum) => {
    const amount = toMoney(sum, scale);
    return total + (capMinor === null ? amount : Math.min(amount, capMinor));
  }, 0);
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** ISO weekday (Monday = 1) of a day counted from 1970-01-01, which was a Thursday. */
const weekdayOf = (day: number) => ((day + 3) % 7) + 1;

/** The rate of the half hour starting at `wallMs`: dated, then weekend, then night, then base. */
function rateLookup({ hourlyRateMinor }: Rates, rules: PriceRules) {
  const dated = rules.dated.map(({ startsOn, endsOn, rateMinor }) => ({
    from: dayNumber(startsOn),
    to: dayNumber(endsOn),
    rateMinor,
  }));
  return (wallMs: number): number => {
    const day = Math.floor(wallMs / DAY_MS);
    const match = dated.find(({ from, to }) => day >= from && day <= to);
    if (match) return match.rateMinor;
    if (rules.weekendRateMinor !== null && weekdayOf(day) >= 6) return rules.weekendRateMinor;
    if (rules.night) {
      const minute = (wallMs - day * DAY_MS) / MINUTE_MS;
      const { fromMinute, toMinute, rateMinor } = rules.night;
      const inside =
        fromMinute < toMinute
          ? minute >= fromMinute && minute < toMinute
          : minute >= fromMinute || minute < toMinute;
      if (inside) return rateMinor;
    }
    return hourlyRateMinor;
  };
}

const offsetAt = (instant: number, timeZone: string) =>
  wallClockMs(new Date(instant), timeZone) - instant;

/**
 * The first instant on the far side of a clock change inside `[start, end]`. Found by halving,
 * because asking `Intl` about each half hour of a month, for 50 results, is too slow. A stay is
 * under 32 days and clock changes are months apart, so there is at most one.
 */
function clockChange(start: number, end: number, startOffset: number, timeZone: string): number {
  let before = 0;
  let after = (end - start) / STEP_MS;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (offsetAt(start + middle * STEP_MS, timeZone) === startOffset) before = middle;
    else after = middle;
  }
  return start + after * STEP_MS;
}

function hasTimedRates({ weekendRateMinor, night, dated }: PriceRules): boolean {
  return weekendRateMinor !== null || night !== null || dated.length > 0;
}

/** Half-hour rates added up per 24 hours of real time since the start. */
function dayRateSums(stay: Stay, startOffset: number, endOffset: number): number[] {
  const start = stay.start.getTime();
  const end = stay.end.getTime();
  const steps = (end - start) / STEP_MS;
  const fullDays = Math.floor(steps / STEPS_PER_DAY);
  const rest = steps % STEPS_PER_DAY;
  if (!hasTimedRates(stay.rules)) {
    const rate = stay.rates.hourlyRateMinor;
    const days = Array.from({ length: fullDays }, () => rate * STEPS_PER_DAY);
    return rest > 0 ? [...days, rate * rest] : days;
  }

  const rateAt = rateLookup(stay.rates, stay.rules);
  const change =
    startOffset === endOffset ? Infinity : clockChange(start, end, startOffset, stay.timeZone);
  const sums = new Array<number>(fullDays + (rest > 0 ? 1 : 0)).fill(0);
  for (let step = 0; step < steps; step++) {
    const instant = start + step * STEP_MS;
    const wall = instant + (instant < change ? startOffset : endOffset);
    const day = Math.floor(step / STEPS_PER_DAY);
    sums[day] = (sums[day] ?? 0) + rateAt(wall);
  }
  return sums;
}

/** The largest discount the stay reaches; length is read on the wall clock, like the 30-day limit. */
function discountPercent(discounts: StayDiscount[], wallMinutes: number): number {
  return discounts.reduce(
    (best, { minDays, percent }) =>
      wallMinutes >= minDays * MINUTES_PER_DAY ? Math.max(best, percent) : best,
    0,
  );
}

/**
 * Total for a stay, in integer minor units. For each half hour the most specific price wins:
 * dated, then weekend, then night, then the hourly rate, read on the listing's wall clock, while
 * the length is real elapsed time (decision #7). Each full 24 hours and the remainder are capped
 * at the daily maximum. A long-stay discount never stacks with the cap: it comes off the uncapped
 * total, and the driver pays whichever is lower.
 *
 * A space's own rate scales everything else in proportion, cap included, so a space that costs
 * 20% more does so at night too.
 */
export function quoteStayMinor(stay: Stay): number {
  const { rates, rules, start, end, timeZone } = stay;
  const minutes = (end.getTime() - start.getTime()) / MINUTE_MS;
  if (
    !Number.isInteger(minutes) ||
    minutes < 0 ||
    minutes % BOOKING_STEP_MINUTES !== 0 ||
    minutes > (MAX_BOOKING_DAYS + 1) * MINUTES_PER_DAY
  ) {
    throw new RangeError(`Stay must be a whole number of ${BOOKING_STEP_MINUTES}-minute steps`);
  }
  const startOffset = offsetAt(start.getTime(), timeZone);
  const endOffset = offsetAt(end.getTime(), timeZone);
  const scale = {
    numerator: stay.spaceRateMinor ?? rates.hourlyRateMinor,
    denominator: rates.hourlyRateMinor,
  };
  const capMinor =
    rates.dailyMaxMinor === null
      ? null
      : Math.ceil((rates.dailyMaxMinor * scale.numerator) / scale.denominator);

  const sums = dayRateSums(stay, startOffset, endOffset);
  const capped = cappedTotal(sums, capMinor, scale);
  const percent = discountPercent(rules.discounts, minutes + (endOffset - startOffset) / MINUTE_MS);
  if (percent === 0) return capped;
  const uncapped = toMoney(
    sums.reduce((total, sum) => total + sum, 0),
    scale,
  );
  return Math.min(capped, Math.ceil((uncapped * (100 - percent)) / 100));
}
