import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

/** Absolute path to the versioned SQL migrations shipped with this package. */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies all pending migrations. Safe to run repeatedly; Drizzle tracks applied files. */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, close } = createDatabase({
    connectionString,
    max: 1,
    applicationName: 'parkfairy-migrate',
  });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
