import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export interface CreateDatabaseOptions {
  connectionString: string;
  /** Maximum pooled connections for this process. */
  max?: number;
  applicationName?: string;
}

export function createDatabase({
  connectionString,
  max = 10,
  applicationName = 'parkfairy',
}: CreateDatabaseOptions): DatabaseConnection {
  const pool = new pg.Pool({ connectionString, max, application_name: applicationName });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}
