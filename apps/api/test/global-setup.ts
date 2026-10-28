import { runMigrations } from '@parkfairy/database/migrations';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL must point at a dedicated test database.');
  }
  await runMigrations(url);
}
