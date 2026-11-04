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
