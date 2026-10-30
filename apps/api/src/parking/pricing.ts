import { BOOKING_STEP_MINUTES } from '@parkfairy/contracts';

const MINUTES_PER_DAY = 24 * 60;

export interface Rates {
  hourlyRateMinor: number;
  /** Most one 24-hour period can cost; null when the owner sets no cap. */
  dailyMaxMinor: number | null;
}

/**
 * Total for a stay of `minutes` (a whole number of half hours) in integer minor units: the
 * hourly rate pro rata per half hour, rounded up to the cent, each full 24 hours and the
 * remainder capped at the daily maximum.
 */
export function quoteTotalMinor(
  { hourlyRateMinor, dailyMaxMinor }: Rates,
  minutes: number,
): number {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes % BOOKING_STEP_MINUTES !== 0) {
    throw new RangeError(`Stay must be a whole number of ${BOOKING_STEP_MINUTES}-minute steps`);
  }
  const forMinutes = (m: number) => Math.ceil((hourlyRateMinor * m) / 60);
  const cap = (amount: number) =>
    dailyMaxMinor === null ? amount : Math.min(amount, dailyMaxMinor);
  const fullDays = Math.floor(minutes / MINUTES_PER_DAY);
  const rest = minutes % MINUTES_PER_DAY;
  return fullDays * cap(forMinutes(MINUTES_PER_DAY)) + cap(forMinutes(rest));
}
