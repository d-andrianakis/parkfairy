import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { parkingHoursExceptions, parkingLocations } from './schema/parking.js';

/**
 * Deletes closures and special hours that ended before `now`'s day on each listing's own
 * calendar. Nobody sees them again, and the note on one is the owner's free text, which may say
 * more about them than a parking listing needs to keep (GDPR): it lasts as long as its entry.
 * Returns how many went.
 */
export async function deleteEndedHoursExceptions(db: Database, now: Date): Promise<number> {
  const { rowCount } = await db.execute(sql`
    delete from ${parkingHoursExceptions} e
    using ${parkingLocations} l
    where l.id = e.location_id
      and e.ends_on < (${now.toISOString()}::timestamptz at time zone l.time_zone)::date`);
  return rowCount ?? 0;
}
