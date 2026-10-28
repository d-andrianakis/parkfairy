/**
 * CLI entry point: `node dist/migrate.js [connection-string]`.
 * Falls back to DATABASE_URL. Used locally, in CI, and as the release step in deploys.
 */
import { runMigrations } from './migrations.js';

const connectionString = process.argv[2] ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set and no connection string was passed.');
  process.exit(1);
}

const target = new URL(connectionString);
console.log(`Applying migrations to ${target.host}${target.pathname} ...`);
await runMigrations(connectionString);
console.log('Migrations applied.');
