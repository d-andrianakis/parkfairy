import { BOOKING_REMINDER_MINUTES } from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';

import type { Database } from './client.js';

/** Per sweep, so one run never holds locks on much of a table. */
const SWEEP_LIMIT = 200;

/**
 * Queues the drivers' reminders (5A.3): "starting soon" for a confirmed stay that begins within
 * BOOKING_REMINDER_MINUTES.starting, "ending soon" for one under way that ends within
 * `.ending`. Once each per booking (the dedupe key), only for a driver who kept the reminders on, and
 * only for a stay confirmed before the reminder's time: booked closer than that, it is the
 * confirmation's job. The sweep runs often, so each reads a short window of the table by the partial
 * indexes on confirmed bookings, and a booking already queued is left out before the limit counts it.
 * The email carries no plate and no way in: the pass page, signed in, has those.
 */
export async function enqueueBookingReminders(db: Database): Promise<number> {
  const { starting, ending } = BOOKING_REMINDER_MINUTES;
  const queue = (
    kind: 'booking-starting-soon' | 'booking-ending-soon',
    due: ReturnType<typeof sql>,
    // The column the window is on, so the statement reads the index that serves it in order.
    order: 'starts_at' | 'ends_at',
  ) =>
    db.execute(sql`
      insert into email_outbox (kind, user_id, payload, dedupe_key)
      select ${kind}, b.user_id,
        jsonb_build_object(
          'listingName', b.listing_name,
          'contentLocale', b.listing_locale,
          'booking', jsonb_build_object(
            'id', b.id,
            'listingId', b.location_id,
            'reference', b.reference,
            'address', b.listing_address,
            'contentLocale', b.listing_locale,
            'spaceLabel', b.space_label,
            'start', to_char(b.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'end', to_char(b.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'timeZone', l.time_zone,
            'totalMinor', b.total_minor,
            'currency', b.currency
          )
        ),
        concat(${kind}::text, ':', b.id)
      from bookings b
      join users u on u.id = b.user_id
      join parking_locations l on l.id = b.location_id
      where b.status = 'confirmed'
        and u.reminder_emails and u.suspended_at is null
        and ${due}
        and not exists (
          select 1 from email_outbox o where o.dedupe_key = concat(${kind}::text, ':', b.id)
        )
      order by b.${sql.raw(order)}
      limit ${SWEEP_LIMIT}
      on conflict (dedupe_key) do nothing
    `);
  const [soon, over] = await Promise.all([
    queue(
      'booking-starting-soon',
      sql`b.starts_at > now() and b.starts_at <= now() + make_interval(mins => ${starting})
        and b.confirmed_at <= b.starts_at - make_interval(mins => ${starting})`,
      'starts_at',
    ),
    queue(
      'booking-ending-soon',
      sql`b.starts_at <= now() and b.ends_at > now()
        and b.ends_at <= now() + make_interval(mins => ${ending})
        and b.confirmed_at <= b.ends_at - make_interval(mins => ${ending})`,
      'ends_at',
    ),
  ]);
  return (soon.rowCount ?? 0) + (over.rowCount ?? 0);
}

/**
 * Whether a reminder is still worth sending when its turn comes (5A.3): the booking still stands, and
 * the moment it was about has not passed. The outbox can hold a row for a while (a provider's outage
 * backs it off), and "starting soon" after the stay began, or for a booking since called off, is worse
 * than none. Anything but the two reminder kinds is always due.
 */
export async function reminderStillDue(
  db: Database,
  kind: string,
  bookingId: string | undefined,
): Promise<boolean> {
  if (kind !== 'booking-starting-soon' && kind !== 'booking-ending-soon') return true;
  if (!bookingId) return false;
  const column = kind === 'booking-starting-soon' ? sql.raw('starts_at') : sql.raw('ends_at');
  const { rows } = await db.execute(
    sql`select 1 from bookings where id = ${bookingId} and status = 'confirmed' and ${column} > now()`,
  );
  return rows.length > 0;
}
