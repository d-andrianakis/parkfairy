import { schema } from '@parkfairy/database';
import { sql, type Column, type SQL } from 'drizzle-orm';

const booking = schema.bookings;

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
  return sql`b.status in ('held', 'confirmed')
    and (b.status = 'confirmed' or b.hold_expires_at > now())
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
