/**
 * Seeds a local database: `node dist/seed/main.js` (run via `pnpm db:seed`).
 */
import { createDatabase } from '@parkfairy/database';
import { DEMO_ACCOUNT, DEMO_LISTINGS } from './demo-data.js';
import {
  assertLocalDatabase,
  assertMarkedLocal,
  ensureDemoAccount,
  upsertListing,
} from './seed.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
assertLocalDatabase(databaseUrl);

const connection = createDatabase({
  connectionString: databaseUrl,
  applicationName: 'parkfairy-seed',
});
try {
  await assertMarkedLocal(connection.db);
  for (const listing of DEMO_LISTINGS) await upsertListing(connection.db, listing);
  const account = await ensureDemoAccount(connection.db);
  console.log(
    `Seeded ${DEMO_LISTINGS.length} demo listings; demo account ${account}: ${DEMO_ACCOUNT.email}`,
  );
} finally {
  await connection.close();
}
