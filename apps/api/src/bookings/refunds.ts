import type { BookingCanceller, CancellationPolicy } from '@parkfairy/contracts';

const HOUR_MS = 60 * 60_000;

/**
 * What a driver gets back when a booking is called off `at`, under the policy it was booked with
 * (decisions #16, #27). The owner calling it off always refunds in full. "Until 24 hours before"
 * includes the 24th hour itself; half of an odd amount rounds in the driver's favour. Nothing once
 * the stay has started; a driver can't cancel then anyway.
 */
export function refundMinor({
  policy,
  totalMinor,
  start,
  at,
  by,
}: {
  policy: CancellationPolicy;
  totalMinor: number;
  start: Date;
  at: Date;
  by: BookingCanceller;
}): number {
  if (by === 'owner') return totalMinor;
  const ahead = start.getTime() - at.getTime();
  if (ahead <= 0) return 0;
  switch (policy) {
    case 'oneHour':
      return ahead >= HOUR_MS ? totalMinor : 0;
    case 'oneDay':
      return ahead >= 24 * HOUR_MS ? totalMinor : 0;
    case 'oneDayThenHalf':
      return ahead >= 24 * HOUR_MS ? totalMinor : Math.ceil(totalMinor / 2);
  }
}
