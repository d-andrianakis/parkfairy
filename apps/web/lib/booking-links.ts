import { DEFAULT_TIME_ZONE, zonedParts } from '@parkfairy/contracts';

/**
 * The listing page with the booking's stay filled in, in the wall-clock fields search writes, so
 * a driver whose space was taken picks another for the same times.
 */
export function listingStayHref(slug: string, start: string, end: string): string {
  const from = zonedParts(new Date(start), DEFAULT_TIME_ZONE);
  const until = zonedParts(new Date(end), DEFAULT_TIME_ZONE);
  const query = new URLSearchParams({
    startDate: from.date,
    startTime: from.time,
    endDate: until.date,
    endTime: until.time,
  });
  return `/parking/${slug}?${query.toString()}`;
}
