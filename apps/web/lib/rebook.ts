import {
  addDays,
  type Booking,
  DEFAULT_TIME_ZONE,
  isoWeekday,
  zonedParts,
  zonedTimeToUtc,
} from '@parkfairy/contracts';

/**
 * The stay "Book again" asks for (5A.2): the same wall-clock start and the same length as the stay
 * that ended, on the next day with the same weekday after today in Athens. A commuter's stay is a
 * habit of the week, so Monday 09:00 to 17:00 comes back as the coming Monday; the listing's own
 * hours, prices and free spaces decide whether it can be had, as for any other stay. Null where
 * the time can't be built (it never is for a stay the API stored).
 */
export function rebookStay(
  start: string,
  end: string,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): { start: string; end: string } | null {
  const earlier = zonedParts(new Date(start), timeZone);
  const weekday = isoWeekday(earlier.date);
  const today = zonedParts(now, timeZone).date;
  let day = addDays(today, 1);
  while (isoWeekday(day) !== weekday) day = addDays(day, 1);
  const from = zonedTimeToUtc(day, earlier.time, timeZone);
  if (!from) return null;
  const length = new Date(end).getTime() - new Date(start).getTime();
  return { start: from.toISOString(), end: new Date(from.getTime() + length).toISOString() };
}

/** Whether a booking can be booked again: a confirmed stay that is over, in a space still there. */
export function canRebook(
  booking: Pick<Booking, 'status' | 'end' | 'spaceId'>,
  now: Date,
): boolean {
  return (
    booking.status === 'confirmed' &&
    booking.spaceId !== null &&
    Date.parse(booking.end) <= now.getTime()
  );
}
