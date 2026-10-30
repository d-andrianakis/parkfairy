import { and, eq, lt } from 'drizzle-orm';
import type { Database } from './client.js';
import { users, verifications } from './schema/auth.js';

/** Ends what a user's verification rows still allow: reset links, pending two-factor, devices. */
export async function deleteUserVerifications(db: Database, userId: string): Promise<void> {
  await db.delete(verifications).where(eq(verifications.value, userId));
}

/**
 * Deletes accounts whose address was never confirmed, older than `before`. Sessions and
 * credentials go with them (foreign keys). Returns how many went.
 */
export async function deleteUnconfirmedAccounts(db: Database, before: Date): Promise<number> {
  const { rowCount } = await db
    .delete(users)
    .where(and(eq(users.emailVerified, false), lt(users.createdAt, before)));
  return rowCount ?? 0;
}
