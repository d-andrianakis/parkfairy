import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  InviteAcceptedSchema,
  InvitePreviewSchema,
  LISTING_OWNERS_MAX,
  ListingOwnersSchema,
  SHARE_BPS_PER_PERCENT,
  type InviteAccepted,
  type InvitePreview,
  type ListingInviteInput,
  type ListingOwnerRole,
  type ListingOwners,
  type ListingSharesInput,
} from '@parkfairy/contracts';
import { hashInviteToken, schema, type Database } from '@parkfairy/database';
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB } from '../database/database.module.js';
import type { Reader } from '../parking/listing-data.js';
import { conflict, listingNotFound, primaryOnly } from './owner.errors.js';
import { OwnerProfileService } from './owner-profile.service.js';

const listing = schema.parkingLocations;
const owners = schema.listingOwners;
const invites = schema.listingInvites;
const profile = schema.ownerProfiles;
const users = schema.users;
const payout = schema.payoutAccounts;
const outbox = schema.emailOutbox;

const inviterProfile = alias(schema.ownerProfiles, 'inviter_profile');
const inviterUser = alias(schema.users, 'inviter_user');

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account asking, as the invite page needs it. */
export interface InviteReader {
  id: string;
  email: string;
  emailVerified: boolean;
}

interface Membership {
  listingId: string;
  /** The asker's owner profile. */
  ownerId: string;
  role: ListingOwnerRole;
}

function notFound(code: 'OWNER_NOT_FOUND' | 'INVITE_NOT_FOUND') {
  return new NotFoundException({ statusCode: 404, error: 'Not Found', message: code, code });
}

/** An invite still open: neither accepted nor withdrawn, and its link not past its time. */
const openInvite = and(
  isNull(invites.acceptedAt),
  isNull(invites.withdrawnAt),
  or(isNull(invites.expiresAt), gt(invites.expiresAt, sql`now()`)),
);

/**
 * Co-ownership of a listing (#53–#56). Every owner may see the owners and invite; only the primary
 * removes owners and sets the shares (#55). Each change to a listing's owners or invites is made
 * under the listing's row lock, so the shares always add up to 100% and the owners and open
 * invites never pass the limit, however many requests come at once.
 */
@Injectable()
export class ListingOwnersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly profiles: OwnerProfileService,
  ) {}

  /** The listing's owners, shares, payouts and open invites, as one of its owners sees them. */
  async list(userId: string, listingId: string): Promise<ListingOwners> {
    const me = await this.membership(this.db, userId, listingId);
    return this.read(this.db, me, userId);
  }

  /**
   * Invites an address to own the listing with its owners (#56). The email goes through the
   * outbox in this transaction; the worker makes its link as it sends it. An invite to an address
   * whose earlier invite lapsed replaces it.
   */
  async invite(
    userId: string,
    listingId: string,
    { email, locale }: ListingInviteInput,
  ): Promise<ListingOwners> {
    const address = email.trim().toLowerCase();
    return this.change(userId, listingId, async (tx, me, row) => {
      const [owner] = await tx
        .select({ id: owners.id })
        .from(owners)
        .innerJoin(profile, eq(profile.id, owners.ownerId))
        .innerJoin(users, eq(users.id, profile.userId))
        .where(and(eq(owners.locationId, listingId), sql`lower(${users.email}) = ${address}`));
      if (owner) throw conflict('ALREADY_OWNER');
      const [earlier] = await tx
        .select({ id: invites.id, expiresAt: invites.expiresAt })
        .from(invites)
        .where(
          and(
            eq(invites.locationId, listingId),
            eq(invites.email, address),
            isNull(invites.acceptedAt),
            isNull(invites.withdrawnAt),
          ),
        );
      if (earlier) {
        if (!earlier.expiresAt || earlier.expiresAt > new Date()) throw conflict('ALREADY_INVITED');
        await tx.update(invites).set({ withdrawnAt: new Date() }).where(eq(invites.id, earlier.id));
      }
      if ((await this.taken(tx, listingId)) >= LISTING_OWNERS_MAX) {
        throw conflict('TOO_MANY_OWNERS');
      }
      const [made] = await tx
        .insert(invites)
        .values({ locationId: listingId, invitedBy: me.ownerId, email: address, locale })
        .returning({ id: invites.id });
      if (!made) throw new Error('Invite not inserted');
      const [inviter] = await tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, userId));
      await tx.insert(outbox).values({
        kind: 'listing-invite',
        inviteId: made.id,
        payload: {
          listingName: row.name ?? undefined,
          contentLocale: row.contentLocale,
          inviterName: inviter?.name,
        },
        dedupeKey: `listing-invite:${made.id}`,
      });
    });
  }

  /** Withdraws an open invite: the inviter's own, or any if the primary asks. */
  async withdraw(userId: string, listingId: string, inviteId: string): Promise<ListingOwners> {
    if (!UUID.test(inviteId)) throw notFound('INVITE_NOT_FOUND');
    return this.change(userId, listingId, async (tx, me) => {
      const [invite] = await tx
        .select({ id: invites.id, invitedBy: invites.invitedBy })
        .from(invites)
        .where(
          and(
            eq(invites.id, inviteId),
            eq(invites.locationId, listingId),
            isNull(invites.acceptedAt),
            isNull(invites.withdrawnAt),
          ),
        );
      if (!invite) throw notFound('INVITE_NOT_FOUND');
      if (me.role !== 'primary' && invite.invitedBy !== me.ownerId) throw primaryOnly();
      await tx.update(invites).set({ withdrawnAt: new Date() }).where(eq(invites.id, inviteId));
    });
  }

  /**
   * Sets every owner's share at once (#54), whole percents adding up to 100: the primary only.
   * The owners named must be exactly the listing's. Bookings already made keep theirs.
   */
  async setShares(
    userId: string,
    listingId: string,
    { shares }: ListingSharesInput,
  ): Promise<ListingOwners> {
    return this.change(userId, listingId, async (tx, me) => {
      if (me.role !== 'primary') throw primaryOnly();
      const current = await tx
        .select({ ownerId: owners.ownerId })
        .from(owners)
        .where(eq(owners.locationId, listingId));
      const named = new Set(shares.map((share) => share.ownerId));
      if (current.length !== shares.length || current.some((owner) => !named.has(owner.ownerId))) {
        throw conflict('SHARES_MISMATCH');
      }
      for (const share of shares) {
        await tx
          .update(owners)
          .set({ shareBps: share.percent * SHARE_BPS_PER_PERCENT })
          .where(and(eq(owners.locationId, listingId), eq(owners.ownerId, share.ownerId)));
      }
    });
  }

  /** The primary removes a co-owner; their share goes back to the primary. */
  async removeOwner(userId: string, listingId: string, ownerId: string): Promise<ListingOwners> {
    if (!UUID.test(ownerId)) throw notFound('OWNER_NOT_FOUND');
    return this.change(userId, listingId, async (tx, me) => {
      if (me.role !== 'primary') throw primaryOnly();
      if (ownerId === me.ownerId) throw conflict('PRIMARY_CANNOT_LEAVE');
      await this.drop(tx, listingId, ownerId);
    });
  }

  /** A co-owner leaves; their share goes back to the primary, who can't leave their own listing. */
  async leave(userId: string, listingId: string): Promise<void> {
    await this.change(userId, listingId, async (tx, me) => {
      if (me.role === 'primary') throw conflict('PRIMARY_CANNOT_LEAVE');
      await this.drop(tx, listingId, me.ownerId);
    });
  }

  /**
   * What the invite page shows before accepting: the listing's name and who invited, and whether
   * the account asking is the one invited. Nothing about the listing's owners or its address.
   */
  async preview(reader: InviteReader, token: string): Promise<InvitePreview> {
    const [found] = await this.db
      .select({
        email: invites.email,
        expiresAt: invites.expiresAt,
        acceptedAt: invites.acceptedAt,
        withdrawnAt: invites.withdrawnAt,
        listingName: listing.name,
        contentLocale: listing.contentLocale,
        invitedBy: inviterUser.name,
      })
      .from(invites)
      .innerJoin(listing, eq(listing.id, invites.locationId))
      .leftJoin(inviterProfile, eq(inviterProfile.id, invites.invitedBy))
      .leftJoin(inviterUser, eq(inviterUser.id, inviterProfile.userId))
      .where(eq(invites.tokenHash, hashInviteToken(token)));
    if (!found) throw notFound('INVITE_NOT_FOUND');
    return InvitePreviewSchema.parse({
      state:
        found.acceptedAt || found.withdrawnAt
          ? 'used'
          : found.expiresAt && found.expiresAt <= new Date()
            ? 'expired'
            : 'open',
      listingName: found.listingName,
      contentLocale: found.contentLocale,
      invitedBy: found.invitedBy,
      forYou: invitedIs(reader, found.email),
    });
  }

  /**
   * Accepts an invite: only the account with the invited address, confirmed (#56), so a forwarded
   * link is no use to anyone else. An owner profile is made if the account has none; the new
   * co-owner joins at 0%, until the primary gives them a share. Asked again, the same answer.
   */
  async accept(reader: InviteReader, token: string): Promise<InviteAccepted> {
    const hash = hashInviteToken(token);
    const [found] = await this.db
      .select({ locationId: invites.locationId })
      .from(invites)
      .where(eq(invites.tokenHash, hash));
    if (!found) throw notFound('INVITE_NOT_FOUND');
    const owner = await this.profiles.ensure(reader.id);
    return this.db.transaction(async (tx) => {
      // The listing's lock first, as every change to its owners takes it; then the invite.
      await tx
        .select({ id: listing.id })
        .from(listing)
        .where(eq(listing.id, found.locationId))
        .for('update');
      const [invite] = await tx
        .select()
        .from(invites)
        .where(eq(invites.tokenHash, hash))
        .for('update');
      if (!invite || invite.withdrawnAt) throw notFound('INVITE_NOT_FOUND');
      if (!invitedIs(reader, invite.email)) throw conflict('INVITE_FOR_ANOTHER_ACCOUNT');
      const [already] = await tx
        .select({ id: owners.id })
        .from(owners)
        .where(and(eq(owners.locationId, invite.locationId), eq(owners.ownerId, owner.id)));
      if (invite.acceptedAt || already) {
        // Accepted before (a second press, the email's link again): as it is.
        if (!already) throw notFound('INVITE_NOT_FOUND');
        return InviteAcceptedSchema.parse({ listingId: invite.locationId });
      }
      if (invite.expiresAt && invite.expiresAt <= new Date()) throw conflict('INVITE_EXPIRED');
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(owners)
        .where(eq(owners.locationId, invite.locationId));
      if (count >= LISTING_OWNERS_MAX) throw conflict('TOO_MANY_OWNERS');
      await tx.insert(owners).values({
        locationId: invite.locationId,
        ownerId: owner.id,
        role: 'co_owner',
        shareBps: 0,
      });
      await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
      return InviteAcceptedSchema.parse({ listingId: invite.locationId });
    });
  }

  /** The asker's place among the listing's owners; anything else is the same 404 (#55). */
  private async membership(db: Reader, userId: string, listingId: string): Promise<Membership> {
    if (!UUID.test(listingId)) throw listingNotFound();
    const [me] = await db
      .select({ ownerId: owners.ownerId, role: owners.role })
      .from(owners)
      .innerJoin(profile, eq(profile.id, owners.ownerId))
      .where(and(eq(owners.locationId, listingId), eq(profile.userId, userId)));
    if (!me) throw listingNotFound();
    return { listingId, ...me };
  }

  /** A change to the listing's owners or invites, under its lock; answers the owners after. */
  private async change(
    userId: string,
    listingId: string,
    work: (
      tx: Transaction,
      me: Membership,
      row: { name: string | null; contentLocale: 'el' | 'en' },
    ) => Promise<void>,
  ): Promise<ListingOwners> {
    if (!UUID.test(listingId)) throw listingNotFound();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ name: listing.name, contentLocale: listing.contentLocale })
        .from(listing)
        .where(eq(listing.id, listingId))
        .for('update');
      if (!row) throw listingNotFound();
      const me = await this.membership(tx, userId, listingId);
      await work(tx, me, row);
      // Still one of its owners after (not if they just left): the owners as they are now.
      const still = await tx
        .select({ id: owners.id })
        .from(owners)
        .where(and(eq(owners.locationId, listingId), eq(owners.ownerId, me.ownerId)));
      return still.length > 0
        ? this.read(tx, me, userId)
        : ListingOwnersSchema.parse({
            listingId,
            name: row.name,
            contentLocale: row.contentLocale,
            role: me.role,
            owners: [],
            invites: [],
            payable: false,
            room: 0,
          });
    });
  }

  /** A co-owner out: their share to the primary, so the shares still add up to 100%. */
  private async drop(tx: Transaction, listingId: string, ownerId: string): Promise<void> {
    const [gone] = await tx
      .delete(owners)
      .where(
        and(
          eq(owners.locationId, listingId),
          eq(owners.ownerId, ownerId),
          eq(owners.role, 'co_owner'),
        ),
      )
      .returning({ shareBps: owners.shareBps });
    if (!gone) throw notFound('OWNER_NOT_FOUND');
    if (gone.shareBps > 0) {
      await tx
        .update(owners)
        .set({ shareBps: sql`${owners.shareBps} + ${gone.shareBps}` })
        .where(and(eq(owners.locationId, listingId), eq(owners.role, 'primary')));
    }
  }

  /** Owners and open invites: what counts against LISTING_OWNERS_MAX. */
  private async taken(db: Reader, listingId: string): Promise<number> {
    const [row] = await db
      .select({
        count: sql<number>`(select count(*) from ${owners} where ${owners.locationId} = ${listingId})
          + (select count(*) from ${invites} where ${invites.locationId} = ${listingId}
            and ${invites.acceptedAt} is null and ${invites.withdrawnAt} is null
            and (${invites.expiresAt} is null or ${invites.expiresAt} > now()))`,
      })
      .from(listing)
      .where(eq(listing.id, listingId));
    return Number(row?.count ?? 0);
  }

  private async read(db: Reader, me: Membership, userId: string): Promise<ListingOwners> {
    const [info, rows, open] = await Promise.all([
      db
        .select({ name: listing.name, contentLocale: listing.contentLocale })
        .from(listing)
        .where(eq(listing.id, me.listingId)),
      db
        .select({
          id: owners.ownerId,
          role: owners.role,
          shareBps: owners.shareBps,
          name: users.name,
          email: users.email,
          userId: users.id,
          payouts: payout.status,
        })
        .from(owners)
        .innerJoin(profile, eq(profile.id, owners.ownerId))
        .innerJoin(users, eq(users.id, profile.userId))
        .leftJoin(payout, eq(payout.ownerId, owners.ownerId))
        .where(eq(owners.locationId, me.listingId))
        .orderBy(sql`${owners.role} = 'primary' desc`, asc(owners.createdAt)),
      db
        .select({
          id: invites.id,
          email: invites.email,
          invitedById: invites.invitedBy,
          invitedBy: inviterUser.name,
          expiresAt: invites.expiresAt,
        })
        .from(invites)
        .leftJoin(inviterProfile, eq(inviterProfile.id, invites.invitedBy))
        .leftJoin(inviterUser, eq(inviterUser.id, inviterProfile.userId))
        .where(and(eq(invites.locationId, me.listingId), openInvite))
        .orderBy(asc(invites.createdAt)),
    ]);
    const [row] = info;
    if (!row) throw listingNotFound();
    return ListingOwnersSchema.parse({
      listingId: me.listingId,
      name: row.name,
      contentLocale: row.contentLocale,
      role: me.role,
      owners: rows.map((owner) => ({
        id: owner.id,
        name: owner.name,
        email: owner.email,
        role: owner.role,
        sharePercent: owner.shareBps / SHARE_BPS_PER_PERCENT,
        payouts: owner.payouts ?? 'none',
        you: owner.userId === userId,
      })),
      invites: open.map((invite) => ({
        id: invite.id,
        email: invite.email,
        invitedBy: invite.invitedBy,
        expiresAt: invite.expiresAt?.toISOString() ?? null,
        canWithdraw: me.role === 'primary' || invite.invitedById === me.ownerId,
      })),
      payable: rows.every((owner) => owner.shareBps === 0 || owner.payouts === 'active'),
      room: Math.max(0, LISTING_OWNERS_MAX - rows.length - open.length),
    });
  }
}

/** The account invited: its address, confirmed. */
function invitedIs(reader: InviteReader, email: string): boolean {
  return reader.emailVerified && reader.email.trim().toLowerCase() === email;
}
