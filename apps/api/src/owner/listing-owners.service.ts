import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  INVITES_PER_ADDRESS_WEEK,
  INVITES_PER_DAY,
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
  type ListingHandoverInput,
  type ListingSharesInput,
  LISTING_HANDOVER_DAYS,
  OWNER_LISTINGS_MAX,
} from '@parkfairy/contracts';
import { hashInviteToken, schema, type Database } from '@parkfairy/database';
import { and, asc, eq, gt, inArray, isNull, or, sql, type AnyColumn } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB } from '../database/database.module.js';
import type { Reader } from '../parking/listing-data.js';
import { doneAccountSteps } from './onboarding-progress.js';
import { conflict, listingNotFound, primaryOnly } from './owner.errors.js';
import { OwnerProfileService, profileFacts } from './owner-profile.service.js';

const listing = schema.parkingLocations;
const owners = schema.listingOwners;
const invites = schema.listingInvites;
const profile = schema.ownerProfiles;
const users = schema.users;
const payout = schema.payoutAccounts;
const outbox = schema.emailOutbox;
const handovers = schema.listingHandovers;

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

function notFound(code: 'OWNER_NOT_FOUND' | 'INVITE_NOT_FOUND' | 'HANDOVER_NOT_FOUND') {
  return new NotFoundException({ statusCode: 404, error: 'Not Found', message: code, code });
}

/** An offer of the primary role not yet settled: neither accepted nor withdrawn (it may have lapsed). */
const unsettledHandover = and(isNull(handovers.acceptedAt), isNull(handovers.withdrawnAt));
/** An offer still open: unsettled and not past its seven days. */
const openHandover = and(unsettledHandover, gt(handovers.expiresAt, sql`now()`));
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
    const refusal: { code: 'ALREADY_OWNER' | 'ALREADY_INVITED' | null } = { code: null };
    const answer = await this.change(userId, listingId, async (tx, me) => {
      // The inviter's row: their day's count spans their listings, each under its own lock.
      await tx
        .select({ id: profile.id })
        .from(profile)
        .where(eq(profile.id, me.ownerId))
        .for('update');
      const primary = me.role === 'primary';
      // A co-owner sees the others' names, not their addresses: each of their tries counts, so
      // asking whether an address is an owner's costs what an invite does.
      if (!primary) await this.withinCaps(tx, listingId, me.ownerId, address);
      const [owner] = await tx
        .select({ id: owners.id })
        .from(owners)
        .innerJoin(profile, eq(profile.id, owners.ownerId))
        .innerJoin(users, eq(users.id, profile.userId))
        .where(and(eq(owners.locationId, listingId), sql`lower(${users.email}) = ${address}`));
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
      const open = earlier && (!earlier.expiresAt || earlier.expiresAt > new Date());
      if (owner || open) {
        refusal.code = owner ? 'ALREADY_OWNER' : 'ALREADY_INVITED';
        if (primary) return;
        // Kept, withdrawn and sending nothing, so the try counts against the caps.
        await tx.insert(invites).values({
          locationId: listingId,
          invitedBy: me.ownerId,
          email: address,
          locale,
          withdrawnAt: new Date(),
        });
        return;
      }
      if (earlier) {
        await tx.update(invites).set({ withdrawnAt: new Date() }).where(eq(invites.id, earlier.id));
      }
      if ((await this.taken(tx, listingId)) >= LISTING_OWNERS_MAX) {
        throw conflict('TOO_MANY_OWNERS');
      }
      if (primary) await this.withinCaps(tx, listingId, me.ownerId, address);
      const [made] = await tx
        .insert(invites)
        .values({ locationId: listingId, invitedBy: me.ownerId, email: address, locale })
        .returning({ id: invites.id });
      if (!made) throw new Error('Invite not inserted');
      // Nothing typed by an owner in it, not even the listing's name: a draft's name is anyone's
      // free text, which would go out from our address to someone who never asked (#56).
      await tx.insert(outbox).values({
        kind: 'listing-invite',
        inviteId: made.id,
        payload: {},
        dedupeKey: `listing-invite:${made.id}`,
      });
    });
    if (refusal.code) throw conflict(refusal.code);
    return answer;
  }

  /**
   * Invites send emails to addresses that may be no one's: a person's few, never a loop of invite
   * and withdraw at one address, nor a list. Says which cap was met.
   */
  private async withinCaps(
    tx: Transaction,
    listingId: string,
    inviterId: string,
    address: string,
  ): Promise<void> {
    // One inbox, whatever tag is on the address: `a+1@x` and `a+2@x` fill the same one.
    const inbox = inboxOfAddress(address);
    const [recent] = await tx
      .select({
        toAddress: sql<number>`count(*) filter (where ${invites.locationId} = ${listingId}
          and ${inboxOf(invites.email)} = ${inbox}
          and ${invites.createdAt} > now() - interval '7 days')::int`,
        byInviter: sql<number>`count(*) filter (where ${invites.invitedBy} = ${inviterId}
          and ${invites.createdAt} > now() - interval '1 day')::int`,
      })
      .from(invites)
      // Each side bounded by its window too, so each index reads only that window's rows.
      .where(
        or(
          and(
            eq(invites.locationId, listingId),
            sql`${inboxOf(invites.email)} = ${inbox}`,
            sql`${invites.createdAt} > now() - interval '7 days'`,
          ),
          and(
            eq(invites.invitedBy, inviterId),
            sql`${invites.createdAt} > now() - interval '1 day'`,
          ),
        ),
      );
    if ((recent?.byInviter ?? 0) >= INVITES_PER_DAY) {
      throw conflict('TOO_MANY_INVITES', { limit: 'day' });
    }
    if ((recent?.toAddress ?? 0) >= INVITES_PER_ADDRESS_WEEK) {
      throw conflict('TOO_MANY_INVITES', { limit: 'address' });
    }
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
      // Paid means reported (#22): a share only for an owner whose details and tax are in. The
      // answer names them, so the form can say whose share waits.
      const paid = shares.filter((share) => share.percent > 0).map((share) => share.ownerId);
      const missing = await unreported(tx, paid);
      if (missing.length > 0) throw conflict('OWNER_DETAILS_MISSING', { owners: missing });
      for (const share of shares) {
        await tx
          .update(owners)
          .set({ shareBps: share.percent * SHARE_BPS_PER_PERCENT })
          .where(and(eq(owners.locationId, listingId), eq(owners.ownerId, share.ownerId)));
      }
      // Paid now, on a listing that may already be live: theirs for staff to verify, as a
      // submission makes it (in id order, as a submission takes them).
      if (paid.length > 0) {
        await tx
          .update(profile)
          .set({ verification: 'pending' })
          .where(and(inArray(profile.id, paid), eq(profile.verification, 'unverified')));
      }
    });
  }

  /**
   * Offers the primary role to a co-owner, who must accept (two steps). Nothing changes until
   * they do. The co-owner must be ready to lead (see `readyToLead`); an earlier open offer is
   * replaced. Only the primary offers it.
   */
  async offerHandover(
    userId: string,
    listingId: string,
    { ownerId }: ListingHandoverInput,
  ): Promise<ListingOwners> {
    return this.change(userId, listingId, async (tx, me) => {
      if (me.role !== 'primary') throw primaryOnly();
      const [target] = await tx
        .select({ id: owners.id })
        .from(owners)
        .where(
          and(
            eq(owners.locationId, listingId),
            eq(owners.ownerId, ownerId),
            eq(owners.role, 'co_owner'),
          ),
        );
      if (!target) throw notFound('OWNER_NOT_FOUND');
      await this.readyToLead(tx, ownerId);
      await tx
        .update(handovers)
        .set({ withdrawnAt: new Date() })
        .where(and(eq(handovers.locationId, listingId), unsettledHandover));
      await tx.insert(handovers).values({
        locationId: listingId,
        fromOwnerId: me.ownerId,
        toOwnerId: ownerId,
        expiresAt: new Date(Date.now() + LISTING_HANDOVER_DAYS * 24 * 60 * 60 * 1000),
      });
    });
  }

  /** Takes the offer back (the primary) or declines it (the co-owner offered the role). */
  async withdrawHandover(userId: string, listingId: string): Promise<ListingOwners> {
    return this.change(userId, listingId, async (tx, me) => {
      const [offer] = await tx
        .select({ id: handovers.id, toOwnerId: handovers.toOwnerId })
        .from(handovers)
        .where(and(eq(handovers.locationId, listingId), openHandover));
      if (!offer) throw notFound('HANDOVER_NOT_FOUND');
      if (me.role !== 'primary' && offer.toOwnerId !== me.ownerId) throw primaryOnly();
      await tx.update(handovers).set({ withdrawnAt: new Date() }).where(eq(handovers.id, offer.id));
    });
  }

  /**
   * The co-owner offered the role accepts: they become the primary (the listing's `owner_id`, who
   * removes owners, sets shares, opens the deeds and gets the status emails), the old primary a
   * co-owner with their share as it was. Everything is checked again under the listing's lock.
   */
  async acceptHandover(userId: string, listingId: string): Promise<ListingOwners> {
    return this.change(userId, listingId, async (tx, me) => {
      const [offer] = await tx
        .select()
        .from(handovers)
        .where(
          and(
            eq(handovers.locationId, listingId),
            eq(handovers.toOwnerId, me.ownerId),
            isNull(handovers.acceptedAt),
            isNull(handovers.withdrawnAt),
          ),
        );
      if (!offer) throw notFound('HANDOVER_NOT_FOUND');
      if (offer.expiresAt <= new Date()) throw conflict('HANDOVER_EXPIRED');
      // Still the one who offered it (a stale offer is no offer).
      const [from] = await tx
        .select({ id: owners.id })
        .from(owners)
        .where(
          and(
            eq(owners.locationId, listingId),
            eq(owners.ownerId, offer.fromOwnerId),
            eq(owners.role, 'primary'),
          ),
        );
      if (!from) throw notFound('HANDOVER_NOT_FOUND');
      await this.readyToLead(tx, me.ownerId, listingId);
      // The old primary first: only one primary at a time.
      await tx
        .update(owners)
        .set({ role: 'co_owner' })
        .where(and(eq(owners.locationId, listingId), eq(owners.ownerId, offer.fromOwnerId)));
      await tx
        .update(owners)
        .set({ role: 'primary' })
        .where(and(eq(owners.locationId, listingId), eq(owners.ownerId, me.ownerId)));
      await tx.update(listing).set({ ownerId: me.ownerId }).where(eq(listing.id, listingId));
      // The primary of a listing with staff is theirs to verify, as a share or a submission makes it.
      await tx
        .update(profile)
        .set({ verification: 'pending' })
        .where(and(eq(profile.id, me.ownerId), eq(profile.verification, 'unverified')));
      await tx.update(handovers).set({ acceptedAt: new Date() }).where(eq(handovers.id, offer.id));
      me.role = 'primary';
    });
  }

  /**
   * What the primary must be: their details and tax in (#22), an active payout account (the
   * listing stays bookable), and room for one more listing of their own. Names who is missing.
   */
  private async readyToLead(tx: Transaction, ownerId: string, listingId?: string): Promise<void> {
    const missing = await unreported(tx, [ownerId]);
    if (missing.length > 0) throw conflict('OWNER_DETAILS_MISSING', { owners: missing });
    const [account] = await tx
      .select({ status: payout.status })
      .from(payout)
      .where(eq(payout.ownerId, ownerId));
    if (account?.status !== 'active') throw conflict('PAYOUTS_NOT_ACTIVE');
    // Their own listings count against the limit that applies to a primary owner.
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(listing)
      .where(
        and(
          eq(listing.ownerId, ownerId),
          listingId ? sql`${listing.id} <> ${listingId}` : sql`true`,
        ),
      );
    if (count >= OWNER_LISTINGS_MAX) throw conflict('TOO_MANY_LISTINGS');
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
      if (!invite.acceptedAt && invite.expiresAt && invite.expiresAt <= new Date()) {
        throw conflict('INVITE_EXPIRED');
      }
      // This account's to accept: only now an owner profile, if it has none.
      await tx.insert(profile).values({ userId: reader.id }).onConflictDoNothing();
      const [owner] = await tx
        .select({ id: profile.id })
        .from(profile)
        .where(eq(profile.userId, reader.id));
      if (!owner) throw new Error('Owner profile missing right after insert');
      const [already] = await tx
        .select({ id: owners.id })
        .from(owners)
        .where(and(eq(owners.locationId, invite.locationId), eq(owners.ownerId, owner.id)));
      if (invite.acceptedAt || already) {
        // Accepted before (a second press, the email's link again): as it is.
        if (!already) throw notFound('INVITE_NOT_FOUND');
        return InviteAcceptedSchema.parse({ listingId: invite.locationId });
      }
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
            handover: null,
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
    // An offer of the primary role to them goes with them.
    await tx
      .update(handovers)
      .set({ withdrawnAt: new Date() })
      .where(
        and(
          eq(handovers.locationId, listingId),
          eq(handovers.toOwnerId, ownerId),
          isNull(handovers.acceptedAt),
          isNull(handovers.withdrawnAt),
        ),
      );
    // Their open invites go with them: a removed owner can't come back through one.
    await tx
      .update(invites)
      .set({ withdrawnAt: new Date() })
      .where(
        and(
          eq(invites.locationId, listingId),
          eq(invites.invitedBy, ownerId),
          isNull(invites.acceptedAt),
          isNull(invites.withdrawnAt),
        ),
      );
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
    const [info, rows, open, offers] = await Promise.all([
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
      db
        .select({ toOwnerId: handovers.toOwnerId, expiresAt: handovers.expiresAt })
        .from(handovers)
        .where(and(eq(handovers.locationId, me.listingId), openHandover)),
    ]);
    const [offer] = offers;
    const [row] = info;
    if (!row) throw listingNotFound();
    const primary = me.role === 'primary';
    return ListingOwnersSchema.parse({
      listingId: me.listingId,
      name: row.name,
      contentLocale: row.contentLocale,
      role: me.role,
      owners: rows.map((owner) => {
        const you = owner.userId === userId;
        // Each co-owner sees the others' names: addresses and Stripe's state are the primary's.
        const shown = primary || you;
        return {
          id: owner.id,
          name: owner.name,
          email: shown ? owner.email : null,
          role: owner.role,
          sharePercent: owner.shareBps / SHARE_BPS_PER_PERCENT,
          payouts: shown ? (owner.payouts ?? 'none') : null,
          you,
        };
      }),
      invites: open.map((invite) => {
        const theirs = primary || invite.invitedById === me.ownerId;
        return {
          id: invite.id,
          email: theirs ? invite.email : null,
          invitedBy: invite.invitedBy,
          expiresAt: invite.expiresAt?.toISOString() ?? null,
          canWithdraw: theirs,
        };
      }),
      handover: offer
        ? {
            toOwnerId: offer.toOwnerId,
            expiresAt: offer.expiresAt.toISOString(),
            canAccept: offer.toOwnerId === me.ownerId,
            canWithdraw: primary || offer.toOwnerId === me.ownerId,
          }
        : null,
      payable: rows.every((owner) => owner.shareBps === 0 || owner.payouts === 'active'),
      room: Math.max(0, LISTING_OWNERS_MAX - rows.length - open.length),
    });
  }
}

/** An address without its `+tag`, which mail providers deliver to the same inbox. */
export function inboxOfAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 0) return address;
  return `${address.slice(0, at).split('+')[0]}${address.slice(at)}`;
}

/** The same in SQL, for an address already stored (lower case, as invites keep them). */
const inboxOf = (email: AnyColumn) =>
  sql`(split_part(split_part(${email}, '@', 1), '+', 1) || '@' || split_part(${email}, '@', 2))`;

/** The account invited: its address, confirmed. */
function invitedIs(reader: InviteReader, email: string): boolean {
  return reader.emailVerified && reader.email.trim().toLowerCase() === email;
}

/**
 * Whether every one of these owners has filled in their details and tax (#22): what a payee, or
 * an owner of a listing sent in, must have.
 */
export async function everyoneReported(db: Reader, ownerIds: readonly string[]): Promise<boolean> {
  return (await unreported(db, ownerIds)).length === 0;
}

/** Those of these owners who haven't (each once, as asked). */
export async function unreported(db: Reader, ownerIds: readonly string[]): Promise<string[]> {
  const asked = [...new Set(ownerIds)];
  if (asked.length === 0) return [];
  // Row locks, in id order: a profile save that would leave an owner's details incomplete waits
  // for this transaction, then sees the share it would be breaking (`OwnerProfileService.patch`).
  // 'no key update', not 'share': both callers go on to update these rows (`verification`), and
  // upgrading a shared lock is how two of them deadlock. The order keeps two apart.
  const rows = await db
    .select()
    .from(profile)
    .where(inArray(profile.id, asked))
    .orderBy(profile.id)
    .for('no key update');
  const done = new Set(
    rows.filter((row) => doneAccountSteps(profileFacts(row)).length === 2).map((row) => row.id),
  );
  return asked.filter((id) => !done.has(id));
}
