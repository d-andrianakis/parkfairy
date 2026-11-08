import { addDays, MAX_BOOKING_DAYS } from '@parkfairy/contracts';
import { schema } from '@parkfairy/database';
import { and, eq, gt, lt, or, type SQL } from 'drizzle-orm';
import { hoursExceptionsOf, openingHoursOf, utcDay, type Reader } from '../parking/listing-data.js';
import { isOpenThroughout, type DatedHours, type OpeningPeriod } from '../parking/opening-hours.js';

const booking = schema.bookings;
const listing = schema.parkingLocations;
const DAY_MS = 24 * 60 * 60_000;

/** A listing's hours as a save would leave them; what is left out is read as it is stored. */
export interface HoursChange {
  locationId: string;
  periods?: OpeningPeriod[];
  exceptions?: DatedHours[];
  /**
   * The local days (both ends included) whose hours the change touches, when only some do:
   * bookings elsewhere can't be stranded by it, so they aren't read. Left out, every day may change
   * (a new week); empty, none does.
   */
  days?: { startsOn: string; endsOn: string }[];
}

/** An instant a day before a local day begins, in any zone a listing may have. */
const dayBefore = (day: string) => new Date(`${addDays(day, -1)}T00:00:00Z`);

/**
 * How many confirmed bookings that haven't ended each listing's hours, as changed, would no longer
 * cover: closing time over a booking is refused until the owner cancels it (decision #27), so
 * nobody arrives at a closed gate. Listings with none are left out of the answer. The hours in
 * effect are what's checked, not just closures: dropping special hours or adding a closed part
 * strands a booking too. A booking under way is checked from now on: its past needs no hours.
 *
 * Call it under the listings' row locks, before writing: a hold or confirmation takes `FOR SHARE`
 * on the listing before it reads the hours, so the two can't both pass their checks. Those locks
 * are why it reads only what can matter: the days changed, never further back than a stay can last.
 * Queries run one after another, since `db` may be a transaction.
 */
export async function strandedBookings(
  db: Reader,
  changes: HoursChange[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const stranded = new Map<string, number>();
  const reach = changes.flatMap((change): SQL[] => {
    if (change.days?.length === 0) return [];
    const of = eq(booking.locationId, change.locationId);
    if (!change.days) return [of];
    const meeting = change.days.map(
      ({ startsOn, endsOn }) =>
        and(
          lt(booking.startsAt, dayBefore(addDays(endsOn, 3))),
          gt(booking.endsAt, dayBefore(startsOn)),
        ) ?? of,
    );
    return [and(of, or(...meeting)) ?? of];
  });
  if (reach.length === 0) return stranded;
  const booked = await db
    .select({
      locationId: booking.locationId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      timeZone: listing.timeZone,
    })
    .from(booking)
    .innerJoin(listing, eq(listing.id, booking.locationId))
    .where(
      and(
        or(...reach),
        eq(booking.status, 'confirmed'),
        gt(booking.endsAt, now),
        // A stay lasts 30 days at most: anything earlier has ended, and the index stops here.
        gt(booking.startsAt, new Date(now.getTime() - (MAX_BOOKING_DAYS + 1) * DAY_MS)),
      ),
    );
  if (booked.length === 0) return stranded;

  const bookedIds = new Set(booked.map((row) => row.locationId));
  const relevant = changes.filter((change) => bookedIds.has(change.locationId));
  const toRead = (pick: (change: HoursChange) => unknown) =>
    relevant.filter((change) => pick(change) === undefined).map((change) => change.locationId);
  const storedPeriods = await openingHoursOf(
    db,
    toRead((change) => change.periods),
  );
  // From the day before today in UTC: within a day of every zone's today.
  const storedExceptions = await hoursExceptionsOf(
    db,
    toRead((change) => change.exceptions),
    addDays(utcDay(now), -1),
  );

  const byId = new Map(relevant.map((change) => [change.locationId, change]));
  // A garage's bookings share a few stays (a day's slots); each is worked out once.
  const open = new Map<string, boolean>();
  for (const { locationId, startsAt, endsAt, timeZone } of booked) {
    const from = startsAt > now ? startsAt : now;
    const key = `${locationId} ${from.getTime()} ${endsAt.getTime()}`;
    let covered = open.get(key);
    if (covered === undefined) {
      const change = byId.get(locationId);
      const periods = change?.periods ?? storedPeriods.get(locationId) ?? [];
      const exceptions = change?.exceptions ?? storedExceptions.get(locationId) ?? [];
      covered = isOpenThroughout(periods, from, endsAt, timeZone, exceptions);
      open.set(key, covered);
    }
    if (!covered) stranded.set(locationId, (stranded.get(locationId) ?? 0) + 1);
  }
  return stranded;
}
