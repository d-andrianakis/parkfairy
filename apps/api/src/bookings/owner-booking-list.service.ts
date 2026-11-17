import { Inject, Injectable } from '@nestjs/common';
import {
  type BookingCanceller,
  BOOKINGS_PAGE_SIZE,
  type BookingsCursor,
  bookingsCursor,
  type Locale,
  MAX_BOOKING_DAYS,
  NAME_MAX_LENGTH,
  OVERSTAY_REPORT_DAYS,
  type OverstayStatus,
  type OwnerBookingList,
  type OwnerBookingListQuery,
  OwnerBookingListSchema,
  type OwnerBookingState,
  ownerBookingsWindow,
  parseBookingsCursor,
} from '@parkfairy/contracts';
import { type Database, runsListing, schema } from '@parkfairy/database';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';

import { DB } from '../database/database.module.js';

const listing = schema.parkingLocations;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The listings the filter offers; an account with more has the rest by their address. */
const MINE_MAX = 100;

interface Row extends Record<string, unknown> {
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
  total_minor: number;
  currency: string;
  status: 'confirmed' | 'cancelled';
  cancelled_by: BookingCanceller | null;
  cancelled_at: string | null;
  overstay_at: string | null;
  overstay_status: OverstayStatus | null;
}

/**
 * Every booking of the listings the signed-in account runs, in one list (5.1), by status, listing
 * and the day a stay starts in its listing's own time zone. The account comes from the session: an
 * owner, a co-owner (#53) or a manager (#69) reads the bookings of the listings they are on, and a
 * `listing` that isn't theirs matches nothing, as one that doesn't exist. As on the listing's own
 * page, they read no stay that ended before they joined it (#35), and the driver's total is what the
 * driver paid, never a share.
 *
 * Keyset paging on a booking's start and id (`bookings_location_starts_id_idx`), in reading order:
 * soonest first for what is coming, latest first for what is over or called off. `past` and
 * `cancelled` always read a window of days (`ownerBookingsWindow`), so the list never scans a
 * garage's whole history.
 */
@Injectable()
export class OwnerBookingListService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async bookings(userId: string, query: OwnerBookingListQuery): Promise<OwnerBookingList> {
    const now = new Date();
    const { status } = query;
    const window = ownerBookingsWindow(status, query, now);
    const reading = status === 'upcoming' ? 'asc' : 'desc';
    const from = query.after ? parseBookingsCursor(query.after) : null;
    const to = query.before ? parseBookingsCursor(query.before) : null;
    const backwards = to !== null;
    const place = from ?? to;

    const what = (() => {
      if (status === 'cancelled') {
        // A hold is never cancelled (`bookings_confirmed_check`), so every cancelled booking was one.
        return sql`b.status = 'cancelled'`;
      }
      if (status === 'past')
        return sql`b.status = 'confirmed' and b.ends_at <= ${now.toISOString()}::timestamptz`;
      return sql`b.status = 'confirmed' and b.ends_at > ${now.toISOString()}::timestamptz
        -- Implied by the line above (a stay lasts 30 days at most), and what keeps the index
        -- from reading every booking the listings ever had.
        and b.starts_at > ${new Date(now.getTime() - (MAX_BOOKING_DAYS + 1) * DAY_MS).toISOString()}::timestamptz`;
    })();
    // The days are the listing's own: from the start of the first one to the start of the day after
    // the last, on its clock. Exact instants, so the index stops at them (a `to_char` of every row
    // cost a quarter more and bounded nothing).
    const days = sql`${
      window.from
        ? sql`and b.starts_at >= (${window.from}::date)::timestamp at time zone l.time_zone`
        : sql``
    } ${
      window.to
        ? sql`and b.starts_at < (${window.to}::date + 1)::timestamp at time zone l.time_zone`
        : sql``
    }`;

    // The place compares as a pair, so Postgres takes the bound on the start from it for the index.
    // After a place is further along the reading order; before it, the way we came from. `orAt`
    // counts the place itself. Each comparison is written out: nothing here is built from text.
    const pair = sql`(b.starts_at, b.id)`;
    const at = (point: BookingsCursor) =>
      sql`(${point.start.toISOString()}::timestamptz, ${point.id}::uuid)`;
    const later = (point: BookingsCursor, orAt: boolean) =>
      orAt ? sql`${pair} >= ${at(point)}` : sql`${pair} > ${at(point)}`;
    const earlier = (point: BookingsCursor, orAt: boolean) =>
      orAt ? sql`${pair} <= ${at(point)}` : sql`${pair} < ${at(point)}`;
    const ahead = reading === 'asc' ? later : earlier;
    const behind = reading === 'asc' ? earlier : later;

    // Each listing gives its own first page, in reading order, from its own index; only those few
    // rows are sorted again and joined to their drivers. Joining first and limiting after read every
    // booking of every listing in the window: seconds for an account with a hundred listings.
    const read = (extra: SQL | undefined, reverse: boolean, limit: number) => {
      const order = (reading === 'asc') !== reverse ? sql`asc` : sql`desc`;
      return this.db.execute<Row>(sql`
        select top.id, top.reference, top.listing_id, top.name, top.content_locale, top.time_zone,
          top.space_label, top.starts_at::text as starts_at, top.ends_at::text as ends_at,
          left(u.name, ${NAME_MAX_LENGTH}) as driver_name, top.vehicle_plate,
          top.total_minor, top.currency, top.status, top.cancelled_by,
          top.cancelled_at::text as cancelled_at,
          o.reported_at::text as overstay_at, o.status as overstay_status
        from (
          select b.id, b.reference, l.id as listing_id, l.name, l.content_locale, l.time_zone,
            b.space_label, b.starts_at, b.ends_at, b.user_id, b.vehicle_plate, b.total_minor,
            b.currency, b.status, b.cancelled_by, b.cancelled_at
          from (
            -- The account's own listings, with the day they joined each: an owner's, or a manager's
            -- (#69).
            select location_id, min(created_at) as created_at from (
              select lo.location_id, lo.created_at from listing_owners lo
                join owner_profiles p on p.id = lo.owner_id and p.user_id = ${userId}
              union all
              select lm.location_id, lm.created_at from listing_managers lm
                where lm.user_id = ${userId}
            ) mine group by location_id
          ) joined
          join parking_locations l on l.id = joined.location_id
          cross join lateral (
            select b.id, b.reference, b.space_label, b.starts_at, b.ends_at, b.user_id,
              b.vehicle_plate, b.total_minor, b.currency, b.status, b.cancelled_by, b.cancelled_at
            from bookings b
            where b.location_id = l.id
              and ${what}
              -- Stays that ended before this account joined the listing stay unseen by them, and
              -- so do bookings called off before then, whenever their stay would have been: a
              -- booking is over once it is cancelled.
              and (case when b.status = 'cancelled' then least(b.ends_at, b.cancelled_at)
                else b.ends_at end) > joined.created_at
              ${days}
              ${extra ? sql`and ${extra}` : sql``}
            order by b.starts_at ${order}, b.id ${order}
            limit ${limit}
          ) b
          ${query.listing ? sql`where l.id = ${query.listing}::uuid` : sql``}
          order by b.starts_at ${order}, b.id ${order}
          limit ${limit}
        ) top
        join users u on u.id = top.user_id
        left join overstay_reports o on o.booking_id = top.id
        order by top.starts_at ${order}, top.id ${order}
      `);
    };

    // At most two at once: the pool is ten, and a list is not worth a quarter of it.
    const mine = await this.db
      .select({ id: listing.id, name: listing.name, contentLocale: listing.contentLocale })
      .from(listing)
      .where(runsListing(userId))
      .orderBy(asc(listing.name), asc(listing.id))
      .limit(MINE_MAX);
    // Whether the listing asked for is the account's, however many listings they run.
    const owned = query.listing
      ? mine.length < MINE_MAX
        ? mine.filter((found) => found.id === query.listing)
        : await this.db
            .select({ id: listing.id })
            .from(listing)
            .where(and(eq(listing.id, query.listing), runsListing(userId)))
      : [];
    const [found, beyond] = await Promise.all([
      read(
        place ? (backwards ? behind : ahead)(place, false) : undefined,
        backwards,
        BOOKINGS_PAGE_SIZE + 1,
      ),
      // Is there a page on the side we came from? Bookings there may have ended or been called off.
      // Ordered from the place outwards: unordered, `limit 1` is planned as a scan of everything.
      place
        ? read((backwards ? ahead : behind)(place, true), !backwards, 1)
        : Promise.resolve({ rows: [] as Row[] }),
    ]);

    const more = found.rows.length > BOOKINGS_PAGE_SIZE;
    const rows = found.rows.slice(0, BOOKINGS_PAGE_SIZE);
    if (backwards) rows.reverse();
    const cursor = (row: Row | undefined) =>
      row ? bookingsCursor({ start: new Date(row.starts_at), id: row.id }) : null;
    const state = (row: Row): OwnerBookingState => {
      if (row.status === 'cancelled') return 'cancelled';
      if (new Date(row.ends_at) <= now) return 'ended';
      return new Date(row.starts_at) <= now ? 'underWay' : 'upcoming';
    };
    return OwnerBookingListSchema.parse({
      status,
      listing: query.listing && owned.length > 0 ? query.listing : null,
      from: window.from,
      to: window.to,
      listings: mine,
      bookings: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        listing: { id: row.listing_id, name: row.name, contentLocale: row.content_locale },
        timeZone: row.time_zone,
        spaceLabel: row.space_label,
        start: new Date(row.starts_at).toISOString(),
        end: new Date(row.ends_at).toISOString(),
        driverName: row.driver_name,
        // A confirmed or cancelled booking always has one (`bookings_confirmed_check`).
        vehiclePlate: row.vehicle_plate ?? '',
        total: { amountMinor: row.total_minor, currency: row.currency.trim() },
        state: state(row),
        cancelledBy: row.status === 'cancelled' ? row.cancelled_by : null,
        cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
        overstay:
          row.overstay_at && row.overstay_status
            ? { reportedAt: new Date(row.overstay_at).toISOString(), status: row.overstay_status }
            : null,
        // Over, not yet reported, and still within the days staff can look into it (5.2c4).
        canReportOverstay:
          state(row) === 'ended' &&
          row.overstay_at === null &&
          now.getTime() - new Date(row.ends_at).getTime() <= OVERSTAY_REPORT_DAYS * DAY_MS,
      })),
      previous: (backwards ? more : beyond.rows.length > 0) ? cursor(rows[0]) : null,
      next: (backwards ? beyond.rows.length > 0 : more) ? cursor(rows.at(-1)) : null,
    });
  }
}
