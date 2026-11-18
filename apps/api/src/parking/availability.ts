import { BLOCKING_STATUSES, LAPSING_STATUSES } from '@parkfairy/contracts';
import { schema } from '@parkfairy/database';
import { type Column, type SQL, sql } from 'drizzle-orm';

const booking = schema.bookings;

/** `'a', 'b'` for a SQL `in (…)`, from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

export interface Stay {
  start: Date;
  end: Date;
}

/**
 * The bookings and running holds a stay meets: `[start, end + gap)` against each row's own
 * `[starts_at, blocked_until)`, the exclusion constraint's test (migration 0015) asked of a stay not
 * booked yet, the listing's gap after it included (decision #10). A hold past its time doesn't count
 * here, though the constraint sees it until it is marked expired: the hold transaction marks the
 * space's first. `status in (…)` and the range repeat the indexes' own, so they serve.
 */
function meets({ start, end }: Stay, gapMinutes: Column | SQL): SQL {
  // The statuses are `BLOCKING_STATUSES`, and the same list as the constraint's and the index's (a
  // test holds the migrations to it): a status that lapses stops counting at its hold time.
  return sql`b.status in (${sqlList(BLOCKING_STATUSES)})
    and (b.status not in (${sqlList(LAPSING_STATUSES)}) or b.hold_expires_at > now())
    and tstzrange(b.starts_at, b.blocked_until, '[)') && tstzrange(${start.toISOString()}::timestamptz,
      ${end.toISOString()}::timestamptz + make_interval(mins => ${gapMinutes}::int), '[)')`;
}

/**
 * The ids of the listing's spaces the stay meets, in one probe of `bookings_taken_by_listing_idx`
 * (migration 0017) rather than one per space: a garage has hundreds. A space whose row is gone has
 * nothing to take.
 */
export function takenSpaceIds(locationId: Column | SQL, stay: Stay, gapMinutes: Column | SQL): SQL {
  return sql`select b.space_id from ${booking} b where b.location_id = ${locationId}
    and b.space_id is not null and ${meets(stay, gapMinutes)}`;
}
