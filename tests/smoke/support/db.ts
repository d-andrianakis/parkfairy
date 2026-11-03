import { Client } from 'pg';

/** The database of a local or CI run; a deployed target's is out of the suite's reach. */
const DATABASE_URL = process.env.SMOKE_WEB_URL
  ? undefined
  : (process.env.DATABASE_URL ?? 'postgres://parkfairy:parkfairy@localhost:5434/parkfairy');

export const HAS_DATABASE = Boolean(DATABASE_URL);

/** What staff do by hand until the admin screen (Phase 5); see GETTING_STARTED.md. */
export async function sendListingBack(id: string, note: string): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `update parking_locations set status = 'changes_requested', review_note = $2 where id = $1`,
      [id, note],
    );
  } finally {
    await client.end();
  }
}
