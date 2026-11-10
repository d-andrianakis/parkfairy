import { randomInt } from 'node:crypto';
import { Client } from 'pg';

/** The database of a local or CI run; a deployed target's is out of the suite's reach. */
const DATABASE_URL = process.env.SMOKE_WEB_URL
  ? undefined
  : (process.env.DATABASE_URL ?? 'postgres://parkfairy:parkfairy@localhost:5434/parkfairy');

export const HAS_DATABASE = Boolean(DATABASE_URL);

async function run(sql: string, values: unknown[]): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql, values);
  } finally {
    await client.end();
  }
}

/** What staff do by hand until the admin screen (Phase 5); see GETTING_STARTED.md. */
export async function sendListingBack(id: string, note: string): Promise<void> {
  await run(
    `update parking_locations set status = 'changes_requested', review_note = $2 where id = $1`,
    [id, note],
  );
}

/** Staff approving a listing, by hand as above. */
export async function publishListing(id: string): Promise<void> {
  await run(`update parking_locations set status = 'published' where id = $1`, [id]);
}

/** Takes a smoke listing back out of the public catalogue, so a later run never meets it. */
export async function unpublishListing(id: string): Promise<void> {
  await run(`update parking_locations set status = 'draft', slug = 'draft-' || id where id = $1`, [
    id,
  ]);
}

const REFERENCE_LETTERS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const reference = () => {
  const four = () =>
    Array.from({ length: 4 }, () => REFERENCE_LETTERS[randomInt(REFERENCE_LETTERS.length)]).join(
      '',
    );
  return `${four()}-${four()}`;
};

/**
 * A busy listing for the owner's pages: `count` confirmed bookings on its first space, an hour
 * each, two hours apart from tomorrow, booked by the owner's own account (the API refuses that,
 * which is why they go straight in). They are left behind: the listing goes back to a draft after
 * the test, and the stays pass.
 */
export async function addBookings(listingId: string, count: number): Promise<void> {
  await run(
    `insert into bookings (reference, user_id, location_id, space_id, space_label, listing_name,
       listing_address, listing_locale, starts_at, ends_at, gap_minutes, blocked_until, status,
       hold_expires_at, total_minor, currency, cancellation_policy, vehicle_plate, confirmed_at)
     select r.reference, p.user_id, l.id, s.id, s.label, l.name, l.address, l.content_locale,
       date_trunc('hour', now()) + interval '1 day' + r.n * interval '2 hours',
       date_trunc('hour', now()) + interval '1 day' + r.n * interval '2 hours' + interval '1 hour',
       0,
       date_trunc('hour', now()) + interval '1 day' + r.n * interval '2 hours' + interval '1 hour',
       'confirmed', now(), 400, 'EUR', 'oneDay', 'IKB1234', now()
     from unnest($2::text[]) with ordinality as r(reference, n)
     join parking_locations l on l.id = $1
     join owner_profiles p on p.id = l.owner_id
     join lateral (
       select id, label from parking_spaces where location_id = l.id order by label limit 1
     ) s on true`,
    [listingId, Array.from({ length: count }, reference)],
  );
}
