import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { bookings } from './schema/bookings.js';

/** Per sweep, so one run never holds many row locks at once. */
const SWEEP_LIMIT = 500;

/**
 * Marks holds whose ten minutes ran out as `expired`, so the exclusion constraint stops counting
 * them (availability already ignores them by time). A hold a confirmation has in hand is skipped:
 * it is settled there, as booked or as expired. Returns how many went.
 */
export async function expireLapsedHolds(db: Database, now: Date): Promise<number> {
  const { rowCount } = await db.execute(sql`
    update ${bookings} set status = 'expired', updated_at = now()
    where id in (
      select id from ${bookings}
      where status = 'held' and hold_expires_at <= ${now.toISOString()}::timestamptz
      order by hold_expires_at
      limit ${SWEEP_LIMIT}
      for update skip locked
    )`);
  return rowCount ?? 0;
}

/**
 * Deletes holds that never became bookings, once settled before `before`: a lapsed or released hold
 * still says who looked at which space when, and nobody needs that (GDPR). Bookings, confirmed or
 * cancelled, are records and stay, and so does a hold a payment was asked for (Phase 4): money may
 * still arrive for it, or have been refunded. One whose payment was called off at Stripe can go.
 * Batch after batch until one comes back short, so a busy day's holds (every second press of Book
 * lets one go) never pile up; `maxBatches` caps one run. Returns how many went.
 */
export async function deleteStaleHolds(
  db: Database,
  before: Date,
  maxBatches = 20,
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const { rowCount } = await db.execute(sql`
      delete from ${bookings}
      where id in (
        select id from ${bookings}
        where status in ('expired', 'released') and updated_at < ${before.toISOString()}::timestamptz
          and (payment_intent_id is null or payment_status = 'canceled')
          -- Never one with money entered: its ledger keeps it (and would refuse the whole batch).
          and not exists (select 1 from ledger_entries e where e.booking_id = ${bookings}.id)
        limit ${SWEEP_LIMIT}
        for update skip locked
      )`);
    deleted += rowCount ?? 0;
    if ((rowCount ?? 0) < SWEEP_LIMIT) break;
  }
  return deleted;
}

/**
 * Forgets Stripe events handled before `before`, a batch at a time. Stripe retries a delivery
 * for three days at most, so a week on nobody will send one again; the record only spared work.
 */
export async function purgeStripeEvents(
  db: Database,
  before: Date,
  maxBatches = 20,
): Promise<number> {
  let purged = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const { rowCount } = await db.execute(sql`
      delete from stripe_events
      where id in (
        select id from stripe_events
        where handled_at < ${before.toISOString()}::timestamptz
        limit ${SWEEP_LIMIT}
      )`);
    purged += rowCount ?? 0;
    if ((rowCount ?? 0) < SWEEP_LIMIT) break;
  }
  return purged;
}
