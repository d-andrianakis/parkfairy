import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  addMonths,
  CALENDAR_BOOKINGS_MAX,
  CALENDAR_MONTHS_AWAY,
  currentMonth,
  monthsBetween,
  NAME_MAX_LENGTH,
  type Locale,
  OwnerCalendarSchema,
  type OwnerCalendar,
  type OwnerCalendarQuery,
} from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';

const listing = schema.parkingLocations;
const owners = schema.listingOwners;
const profile = schema.ownerProfiles;

/**
 * The owner's calendar (5.1): confirmed bookings of the listings the signed-in user owns, as a
 * co-owner too (#53), by the day they start in their listing's own time zone. The user comes from
 * the session; a `listing` that isn't theirs matches nothing, as a listing that doesn't exist.
 */
@Injectable()
export class OwnerCalendarService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async calendar(userId: string, query: OwnerCalendarQuery): Promise<OwnerCalendar> {
    const here = currentMonth();
    const month = query.month ?? here;
    // The month's days in UTC, a day wider each way than any zone shifts them: the index's bound.
    // The exact month is the listing's own clock, read below.
    const from = new Date(`${addDays(`${month}-01`, -1)}T00:00:00Z`);
    const to = new Date(`${addDays(`${addMonths(month, 1)}-01`, 1)}T00:00:00Z`);

    const [mine, found, owned] = await Promise.all([
      this.db
        .select({ id: listing.id, name: listing.name, contentLocale: listing.contentLocale })
        .from(listing)
        .innerJoin(owners, eq(owners.locationId, listing.id))
        .innerJoin(profile, eq(profile.id, owners.ownerId))
        .where(eq(profile.userId, userId))
        .orderBy(asc(listing.name), asc(listing.id))
        .limit(100),
      this.db.execute<{
        id: string;
        reference: string;
        listing_id: string;
        name: string | null;
        content_locale: Locale;
        time_zone: string;
        space_label: string;
        starts_at: string;
        ends_at: string;
        driver_name: string;
        vehicle_plate: string | null;
        day: string;
      }>(sql`
        select b.id, b.reference, l.id as listing_id, l.name, l.content_locale, l.time_zone,
          b.space_label, b.starts_at::text as starts_at, b.ends_at::text as ends_at,
          left(u.name, ${NAME_MAX_LENGTH}) as driver_name, b.vehicle_plate,
          to_char(b.starts_at at time zone l.time_zone, 'YYYY-MM-DD') as day
        from bookings b
        join parking_locations l on l.id = b.location_id
        join listing_owners lo on lo.location_id = l.id
        join owner_profiles p on p.id = lo.owner_id and p.user_id = ${userId}
        join users u on u.id = b.user_id
        where b.status = 'confirmed'
          -- Drivers of stays that ended before this owner joined the listing stay unseen by them
          -- (data minimisation: a new co-owner reads no history).
          and b.ends_at > lo.created_at
          and b.starts_at >= ${from.toISOString()}::timestamptz
          and b.starts_at < ${to.toISOString()}::timestamptz
          and to_char(b.starts_at at time zone l.time_zone, 'YYYY-MM') = ${month}
          ${query.listing ? sql`and l.id = ${query.listing}` : sql``}
        order by b.starts_at, b.id
        limit ${CALENDAR_BOOKINGS_MAX + 1}
      `),
      // Whether the listing asked for is the user's, however many listings they have.
      query.listing
        ? this.db
            .select({ id: owners.locationId })
            .from(owners)
            .innerJoin(profile, eq(profile.id, owners.ownerId))
            .where(and(eq(owners.locationId, query.listing), eq(profile.userId, userId)))
        : Promise.resolve([]),
    ]);

    const rows = found.rows.slice(0, CALENDAR_BOOKINGS_MAX);
    const days = new Map<string, OwnerCalendar['days'][number]['bookings']>();
    for (const row of rows) {
      const booking = {
        id: row.id,
        reference: row.reference,
        listing: { id: row.listing_id, name: row.name, contentLocale: row.content_locale },
        spaceLabel: row.space_label,
        start: new Date(row.starts_at).toISOString(),
        end: new Date(row.ends_at).toISOString(),
        timeZone: row.time_zone,
        driverName: row.driver_name,
        // A confirmed booking always has one (`bookings_confirmed_check`).
        vehiclePlate: row.vehicle_plate ?? '',
      };
      const day = days.get(row.day);
      if (day) day.push(booking);
      else days.set(row.day, [booking]);
    }
    // Days come in the listings' own clocks, which can differ: sorted by the date, not by arrival.
    const ordered = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
    return OwnerCalendarSchema.parse({
      month,
      previous: monthsBetween(here, month) > -CALENDAR_MONTHS_AWAY ? addMonths(month, -1) : null,
      next: monthsBetween(here, month) < CALENDAR_MONTHS_AWAY ? addMonths(month, 1) : null,
      listing: query.listing && owned.length > 0 ? query.listing : null,
      listings: mine,
      days: ordered.map(([date, bookings]) => ({ date, bookings })),
      truncated: found.rows.length > CALENDAR_BOOKINGS_MAX,
    });
  }
}
