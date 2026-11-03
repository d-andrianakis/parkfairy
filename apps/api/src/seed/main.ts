/**
 * Seeds a local database: `node dist/seed/main.js` (run via `pnpm db:seed`).
 */
import { createDatabase } from '@parkfairy/database';
import { DEFAULT_OBJECT_STORE_DIR } from '../config/env.js';
import { fileObjectStore } from '../storage/object-store.js';
import { DEMO_ACCOUNT, DEMO_LISTINGS } from './demo-data.js';
import { DEMO_PHOTOS } from './demo-photos.js';
import {
  assertLocalDatabase,
  assertMarkedLocal,
  ensureDemoAccount,
  seedPhotos,
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
  const store = fileObjectStore(process.env.OBJECT_STORE_DIR || DEFAULT_OBJECT_STORE_DIR);
  for (const listing of DEMO_LISTINGS) {
    await upsertListing(connection.db, listing);
    await seedPhotos(connection.db, store, listing.slug, DEMO_PHOTOS[listing.slug] ?? []);
  }
  const account = await ensureDemoAccount(connection.db);
  console.log(
    `Seeded ${DEMO_LISTINGS.length} demo listings; demo account ${account}: ${DEMO_ACCOUNT.email}`,
  );
} finally {
  await connection.close();
}
