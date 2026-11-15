/**
 * Co-ownership (#53–#56): a listing's owners, the primary (the listing's `owner_id`) and
 * co-owners, each with a share of the owners' payouts; invites to join; and each booking's payees,
 * copied from the owners when it is confirmed.
 */
import {
  LISTING_OWNER_ROLES,
  SUPPORTED_LOCALES,
  TRANSFER_STATUSES,
  type ListingOwnerRole,
  type Locale,
  type TransferStatus,
} from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookings } from './bookings.js';
import { ownerProfiles } from './owners.js';
import { parkingLocations } from './parking.js';

/** `'a', 'b'` list for CHECK constraints built from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const instant = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Who owns a listing, and their share of what its owners are paid, in basis points (whole
 * percents: 100 = 1%). The shares of a listing add up to 10000, kept so by the API under the
 * listing's lock. A deleted (draft) listing takes its owners with it; profiles never cascade.
 */
export const listingOwners = pgTable(
  'listing_owners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => ownerProfiles.id, { onDelete: 'restrict' }),
    role: text('role').$type<ListingOwnerRole>().notNull(),
    shareBps: integer('share_bps').notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('listing_owners_listing_owner_idx').on(t.locationId, t.ownerId),
    uniqueIndex('listing_owners_one_primary_idx')
      .on(t.locationId)
      .where(sql`${t.role} = 'primary'`),
    // An owner's listings: the dashboard, and every ownership check.
    index('listing_owners_owner_idx').on(t.ownerId),
    check('listing_owners_role_check', sql`${t.role} in (${sqlList(LISTING_OWNER_ROLES)})`),
    check(
      'listing_owners_share_check',
      sql`${t.shareBps} between 0 and 10000 and ${t.shareBps} % 100 = 0`,
    ),
  ],
);

/**
 * An invite to own a listing with its owners (#56), by email. The link's token is made by the
 * worker as it sends the email and only its hash kept here, with when it stops working, so no live
 * link waits anywhere. Accepted or withdrawn, an invite is a record for a while, then purged (it
 * holds an address that may be no account's).
 */
export const listingInvites = pgTable(
  'listing_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'cascade' }),
    /** The owner who sent it; null once they have left the listing's owners for good. */
    invitedBy: uuid('invited_by').references(() => ownerProfiles.id, { onDelete: 'set null' }),
    /** Lower-cased, as accounts' addresses are compared. */
    email: text('email').notNull(),
    /** The language its email is written in: the inviter's. */
    locale: text('locale').$type<Locale>().notNull(),
    tokenHash: text('token_hash').unique(),
    expiresAt: instant('expires_at'),
    acceptedAt: instant('accepted_at'),
    withdrawnAt: instant('withdrawn_at'),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (t) => [
    // One open invite per address per listing.
    uniqueIndex('listing_invites_open_idx')
      .on(t.locationId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.withdrawnAt} is null`),
    // The purge of old ones.
    index('listing_invites_created_idx').on(t.createdAt),
    // The limits: invites to one address from a listing in a week, by one inviter in a day. They
    // serve the cascade from the listing and the SET NULL from the profile too.
    index('listing_invites_listing_email_idx').on(t.locationId, t.email, t.createdAt),
    index('listing_invites_inviter_idx').on(t.invitedBy, t.createdAt),
    check('listing_invites_email_check', sql`${t.email} = lower(${t.email})`),
    check('listing_invites_locale_check', sql`${t.locale} in (${sqlList(SUPPORTED_LOCALES)})`),
    check(
      'listing_invites_token_check',
      sql`(${t.tokenHash} is null) = (${t.expiresAt} is null) and (${t.tokenHash} is null or ${t.tokenHash} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      'listing_invites_settled_check',
      sql`${t.acceptedAt} is null or ${t.withdrawnAt} is null`,
    ),
  ],
);

/**
 * An offer to hand a listing's primary role to one of its co-owners, who must accept (two steps).
 * Nothing changes until then: the old primary becomes a co-owner, the new one the listing's
 * `owner_id`. One open offer per listing; withdrawn by the primary, declined by the co-owner, or
 * lapsed after seven days. Holds profile ids only, so nothing personal.
 */
export const listingHandovers = pgTable(
  'listing_handovers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'cascade' }),
    fromOwnerId: uuid('from_owner_id')
      .notNull()
      .references(() => ownerProfiles.id, { onDelete: 'restrict' }),
    toOwnerId: uuid('to_owner_id')
      .notNull()
      .references(() => ownerProfiles.id, { onDelete: 'restrict' }),
    expiresAt: instant('expires_at').notNull(),
    acceptedAt: instant('accepted_at'),
    withdrawnAt: instant('withdrawn_at'),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (t) => [
    // One open offer per listing.
    uniqueIndex('listing_handovers_open_idx')
      .on(t.locationId)
      .where(sql`${t.acceptedAt} is null and ${t.withdrawnAt} is null`),
    // The listing's offers, settled ones too: its deletion cascades here (the partial index above
    // can't serve a delete that must find them all).
    index('listing_handovers_location_idx').on(t.locationId, t.createdAt),
    // The owners a profile's removal or leaving must close offers of, and the RESTRICT checks.
    index('listing_handovers_to_idx').on(t.toOwnerId),
    index('listing_handovers_from_idx').on(t.fromOwnerId),
    check('listing_handovers_distinct_check', sql`${t.fromOwnerId} <> ${t.toOwnerId}`),
    check(
      'listing_handovers_settled_check',
      sql`${t.acceptedAt} is null or ${t.withdrawnAt} is null`,
    ),
  ],
);

/**
 * Who a booking's owners' share goes to, copied from the listing's owners with a share when the
 * booking is confirmed (#54): a share changed, or an owner joining or leaving later, changes only
 * bookings made after, and a hold that never books has none.
 * Each payee is paid on their own, 24 hours after the stay (#4); one whose account Stripe has
 * restricted waits alone (#52). A financial record: nothing cascades into it.
 */
export const bookingPayees = pgTable(
  'booking_payees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => ownerProfiles.id, { onDelete: 'restrict' }),
    shareBps: integer('share_bps').notNull(),
    /** Their part of the owners' share, worked out with the booking's transfer (`sending`). */
    transferMinor: integer('transfer_minor'),
    transferStatus: text('transfer_status').$type<TransferStatus>(),
    stripeTransferId: text('stripe_transfer_id'),
    transferredAt: instant('transferred_at'),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('booking_payees_booking_owner_idx').on(t.bookingId, t.ownerId),
    index('booking_payees_owner_idx').on(t.ownerId),
    check('booking_payees_share_check', sql`${t.shareBps} between 1 and 10000`),
    // Worked out, then sent: by Stripe with its id, or nothing to send (a part rounded to 0).
    check(
      'booking_payees_transfer_check',
      sql`${t.transferStatus} is null or (${t.transferStatus} in (${sqlList(TRANSFER_STATUSES)}) and ${t.transferMinor} is not null and ${t.transferMinor} >= 0 and (${t.transferStatus} = 'sent') = (${t.transferredAt} is not null) and (${t.stripeTransferId} is not null) = (${t.transferStatus} = 'sent' and ${t.transferMinor} > 0))`,
    ),
  ],
);
