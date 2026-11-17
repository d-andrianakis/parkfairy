import { and, eq, lt } from 'drizzle-orm';

import type { Database } from './client.js';
import { sessions, users, verifications } from './schema/auth.js';

/** Ends what a user's verification rows still allow: reset links, pending two-factor, devices. */
export async function deleteUserVerifications(db: Database, userId: string): Promise<void> {
  await db.delete(verifications).where(eq(verifications.value, userId));
}

/** Ends every session of an account: one that opened in the instant it was suspended. */
export async function endSessionsOf(db: Database, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Staff suspended this account (5.2c, #79): it gets no session, and the API turns it away. */
export async function isAccountSuspended(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId));
  return row?.suspendedAt != null;
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
