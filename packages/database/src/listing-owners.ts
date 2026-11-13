import { createHash, randomBytes } from 'node:crypto';
import { LISTING_INVITE_DAYS } from '@parkfairy/contracts';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { bookingPayees, listingInvites, listingOwners } from './schema/listing-owners.js';

/**
 * Co-ownership in SQL (#53–#56), shared by the API (bookability, the hold) and the worker (an
 * invite's email). The fragments name `parking_locations` itself, so they hold in a query whose
 * listing isn't aliased; Drizzle's lone-table selects leave columns unqualified (memory.md).
 */

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Someone is paid for it, and every owner with a share can be paid (#54): drivers can book, and
 * pay, only then. A listing without owners (the demo's) pays nobody, so it can't be booked.
 */
export const payableListing = sql`exists (
  select 1 from listing_owners lo
  where lo.location_id = parking_locations.id and lo.share_bps > 0
) and not exists (
  select 1 from listing_owners lo
  left join payout_accounts lopa on lopa.owner_id = lo.owner_id
  where lo.location_id = parking_locations.id and lo.share_bps > 0
    and lopa.status is distinct from 'active'
)`;

/** The account is one of the listing's owners, primary or co-owner. */
export const ownedByUser = (userId: string) => sql`exists (
  select 1 from listing_owners lo
  join owner_profiles lop on lop.id = lo.owner_id
  where lo.location_id = parking_locations.id and lop.user_id = ${userId}
)`;

/**
 * A booking's payees, as the listing's owners with a share are now (#54): copied in the
 * transaction that confirms it, so later changes to the shares only reach bookings made after,
 * and a hold that never books has none (it is deleted like any lapsed hold). Twice, nothing more.
 */
export async function copyPayees(
  tx: Transaction | Database,
  bookingId: string,
  locationId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into ${bookingPayees} (booking_id, owner_id, share_bps)
    select ${bookingId}, owner_id, share_bps from ${listingOwners}
    where location_id = ${locationId} and share_bps > 0
    on conflict (booking_id, owner_id) do nothing
  `);
}

/** How an invite's token is kept: its SHA-256, so a leaked table opens nothing. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A fresh link for an open invite, made as its email is sent (no live link waits in the outbox):
 * the token, and when it stops working. A token made before is replaced, so only the last email's
 * link works. Null if the invite was accepted or withdrawn meanwhile: nothing to send.
 */
export async function mintInviteToken(
  db: Database,
  inviteId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date } | null> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + LISTING_INVITE_DAYS * DAY_MS);
  const [row] = await db
    .update(listingInvites)
    .set({ tokenHash: hashInviteToken(token), expiresAt })
    .where(
      and(
        eq(listingInvites.id, inviteId),
        isNull(listingInvites.acceptedAt),
        isNull(listingInvites.withdrawnAt),
      ),
    )
    .returning({ id: listingInvites.id });
  return row ? { token, expiresAt } : null;
}

/**
 * Invites settled or lapsed before `before` go: they hold an address that may be no account's
 * (GDPR), and nobody needs them a month on. Their outbox rows go with them.
 */
export async function purgeListingInvites(db: Database, before: Date): Promise<number> {
  const { rowCount } = await db.delete(listingInvites).where(
    or(
      lt(listingInvites.acceptedAt, before),
      lt(listingInvites.withdrawnAt, before),
      lt(listingInvites.expiresAt, before),
      // Never sent (its email failed for good): a month on, it's gone too.
      and(isNull(listingInvites.expiresAt), lt(listingInvites.createdAt, before)),
    ),
  );
  return rowCount ?? 0;
}
