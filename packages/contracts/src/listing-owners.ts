import { z } from 'zod';
import { LocaleSchema } from './i18n.js';
import { PayoutStatusSchema } from './payments.js';
import { contractsRegistry } from './registry.js';
import { message } from './validation.js';

/**
 * Co-ownership of a listing (#53–#56): the primary owner (the listing's `owner_id`) and co-owners,
 * each with a share of the owners' payouts, and email invites to join.
 */
export const LISTING_OWNER_ROLES = ['primary', 'co_owner'] as const;
export const ListingOwnerRoleSchema = z.enum(LISTING_OWNER_ROLES).register(contractsRegistry, {
  id: 'ListingOwnerRole',
});
export type ListingOwnerRole = z.infer<typeof ListingOwnerRoleSchema>;

/**
 * A manager runs a listing day to day (#69–#71): the calendar and bookings (and cancelling them),
 * closures and special hours. No share, no payouts, no earnings, no edits to the listing, no
 * invites, no proofs. Added and removed by the primary owner, by the same emailed invite.
 */
export const LISTING_INVITE_ROLES = ['co_owner', 'manager'] as const;
export const ListingInviteRoleSchema = z.enum(LISTING_INVITE_ROLES).register(contractsRegistry, {
  id: 'ListingInviteRole',
});
export type ListingInviteRole = z.infer<typeof ListingInviteRoleSchema>;
/** Managers and their pending invites together, per listing. */
export const LISTING_MANAGERS_MAX = 5;

/** Owners and pending invites together, per listing. */
export const LISTING_OWNERS_MAX = 10;
/** Invites one account may send in a day, over all its listings: a person's need, not a list's. */
export const INVITES_PER_DAY = 20;
/** Invites to one address from one listing in a week, withdrawn ones too: no invite-withdraw loop. */
export const INVITES_PER_ADDRESS_WEEK = 2;
/** How long an invite's link works, from when it was sent (#56). */
export const LISTING_INVITE_DAYS = 7;
/** How long an offer of the primary role stays open, from when it was made. */
export const LISTING_HANDOVER_DAYS = 7;
/** Shares are whole percentages; stored as basis points (100 = 1%). */
export const SHARE_BPS_PER_PERCENT = 100;

/** An invite link's token: 32 random bytes, base64url. Only its hash is kept. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const ListingOwnerSchema = z
  .object({
    /** The owner's profile id: what shares and removal refer to. */
    id: z.uuid(),
    name: z.string().nullable(),
    /** Seen by the primary, and by each owner of their own: co-owners see each other's names. */
    email: z.string().nullable(),
    role: ListingOwnerRoleSchema,
    /** Their share of the owners' payouts, in whole percent. */
    sharePercent: z.number().int().min(0).max(100),
    /**
     * Whether Stripe can pay them: one with a share and no active account keeps bookings shut.
     * Seen by the primary, and by each owner of their own.
     */
    payouts: PayoutStatusSchema.nullable(),
    /** The account asking. */
    you: z.boolean(),
  })
  .register(contractsRegistry, { id: 'ListingOwner' });
export type ListingOwner = z.infer<typeof ListingOwnerSchema>;

export const ListingInviteSchema = z
  .object({
    id: z.uuid(),
    /** Seen by the primary and by whoever sent it. */
    email: z.string().nullable(),
    /** Who sent it, by name; null if they have since left. */
    invitedBy: z.string().nullable(),
    /** Until when its link works; null while the email is still on its way. */
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    /** The asking owner may withdraw it: theirs, or any if they're the primary. */
    canWithdraw: z.boolean(),
    /** To own the listing with its owners, or to manage it. */
    role: ListingInviteRoleSchema,
  })
  .register(contractsRegistry, { id: 'ListingInvite' });
export type ListingInvite = z.infer<typeof ListingInviteSchema>;

/** Someone who manages the listing (#69): seen by every owner by name, by the primary with the address. */
export const ListingManagerSchema = z
  .object({
    /** The manager row's id: what removal refers to. */
    id: z.uuid(),
    name: z.string().nullable(),
    /** Seen by the primary. */
    email: z.string().nullable(),
  })
  .register(contractsRegistry, { id: 'ListingManager' });
export type ListingManager = z.infer<typeof ListingManagerSchema>;

/** An open offer of the primary role to a co-owner: seen by every owner, by name only. */
export const ListingHandoverSchema = z
  .object({
    /** The co-owner offered the role (their profile id, as in `owners`). */
    toOwnerId: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }),
    /** The asking owner is the one offered it. */
    canAccept: z.boolean(),
    /** The asking owner may take it back: the primary, or the one offered it (declining). */
    canWithdraw: z.boolean(),
  })
  .register(contractsRegistry, { id: 'ListingHandover' });
export type ListingHandover = z.infer<typeof ListingHandoverSchema>;

export const ListingOwnersSchema = z
  .object({
    listingId: z.uuid(),
    name: z.string().nullable(),
    contentLocale: LocaleSchema,
    /** The asking owner's role: only the primary removes owners and sets shares (#55). */
    role: ListingOwnerRoleSchema,
    owners: z.array(ListingOwnerSchema),
    managers: z.array(ListingManagerSchema),
    invites: z.array(ListingInviteSchema),
    /** The open offer of the primary role, if any. */
    handover: ListingHandoverSchema.nullable(),
    /** Every owner with a share can be paid, so drivers can book (#54). */
    payable: z.boolean(),
    /** Owners and pending invites left before the limit. */
    room: z.number().int().min(0),
    /** Managers and pending invites to manage left before their limit. */
    managersRoom: z.number().int().min(0),
  })
  .register(contractsRegistry, { id: 'ListingOwners' });
export type ListingOwners = z.infer<typeof ListingOwnersSchema>;

export const ListingInviteInputSchema = z
  .object({
    email: z.email(message('emailInvalid')).max(254, message('emailInvalid')),
    /** The language the invite email is written in: the inviter's, as they write it. */
    locale: LocaleSchema,
    /** To co-own it, or to manage it (the primary only). Co-owning when left out. */
    role: ListingInviteRoleSchema.default('co_owner'),
  })
  .register(contractsRegistry, { id: 'ListingInviteInput' });
export type ListingInviteInput = z.infer<typeof ListingInviteInputSchema>;

export const ListingHandoverInputSchema = z
  .object({ ownerId: z.uuid() })
  .register(contractsRegistry, { id: 'ListingHandoverInput' });
export type ListingHandoverInput = z.infer<typeof ListingHandoverInputSchema>;

export const ListingSharesInputSchema = z
  .object({
    shares: z
      .array(
        z.object({
          ownerId: z.uuid(),
          percent: z
            .number(message('shareInvalid'))
            .int(message('shareInvalid'))
            .min(0, message('shareInvalid'))
            .max(100, message('shareInvalid')),
        }),
      )
      .min(1)
      .max(LISTING_OWNERS_MAX)
      .refine(
        (shares) => new Set(shares.map((share) => share.ownerId)).size === shares.length,
        message('invalid'),
      )
      .refine(
        (shares) => shares.reduce((sum, share) => sum + share.percent, 0) === 100,
        message('sharesTotal'),
      ),
  })
  .register(contractsRegistry, { id: 'ListingSharesInput' });
export type ListingSharesInput = z.infer<typeof ListingSharesInputSchema>;

export const InviteTokenInputSchema = z
  .object({ token: z.string().regex(INVITE_TOKEN_PATTERN) })
  .register(contractsRegistry, { id: 'InviteTokenInput' });
export type InviteTokenInput = z.infer<typeof InviteTokenInputSchema>;

/** What the invite page shows before accepting: never the listing's owners or its address. */
export const INVITE_STATES = ['open', 'expired', 'used'] as const;
export const InvitePreviewSchema = z
  .object({
    state: z.enum(INVITE_STATES),
    listingName: z.string().nullable(),
    contentLocale: LocaleSchema,
    invitedBy: z.string().nullable(),
    /** Whether the signed-in account is the one invited (its verified address). */
    forYou: z.boolean(),
    /** What it invites them to be. */
    role: ListingInviteRoleSchema,
  })
  .register(contractsRegistry, { id: 'InvitePreview' });
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

export const InviteAcceptedSchema = z
  .object({ listingId: z.uuid() })
  .register(contractsRegistry, { id: 'InviteAccepted' });
export type InviteAccepted = z.infer<typeof InviteAcceptedSchema>;

/** A listing the signed-in account manages (#69): what the dashboard links to. */
export const ManagedListingSchema = z
  .object({
    id: z.uuid(),
    name: z.string().nullable(),
    contentLocale: LocaleSchema,
  })
  .register(contractsRegistry, { id: 'ManagedListing' });
export type ManagedListing = z.infer<typeof ManagedListingSchema>;

export const ManagedListingsSchema = z
  .object({ listings: z.array(ManagedListingSchema).max(100) })
  .register(contractsRegistry, { id: 'ManagedListings' });
export type ManagedListings = z.infer<typeof ManagedListingsSchema>;

/** Every `code` a co-ownership route answers with, for clients to translate. */
export const LISTING_OWNER_ERROR_CODES = [
  'LISTING_NOT_FOUND',
  /** Only the primary owner may do this (#55). */
  'PRIMARY_ONLY',
  /** The primary can't leave their own listing. */
  'PRIMARY_CANNOT_LEAVE',
  'TOO_MANY_OWNERS',
  /** Already an owner, or already invited and the invite still open. */
  'ALREADY_OWNER',
  'ALREADY_INVITED',
  /** Already manages the listing. */
  'ALREADY_MANAGER',
  /** Managers and open manager invites are at their limit. */
  'TOO_MANY_MANAGERS',
  'MANAGER_NOT_FOUND',
  'OWNER_NOT_FOUND',
  'INVITE_NOT_FOUND',
  'INVITE_EXPIRED',
  /** Signed in with another address than the one invited, or one not confirmed yet. */
  'INVITE_FOR_ANOTHER_ACCOUNT',
  /** The shares named aren't the listing's owners, each once. */
  'SHARES_MISMATCH',
  /** More invites than a day (or a week, to one address) allows. */
  'TOO_MANY_INVITES',
  /** An owner given a share, or one of a listing sent in, hasn't filled in their details and tax. */
  'OWNER_DETAILS_MISSING',
  /** An owner with a share can't leave their details incomplete: the primary takes the share back first. */
  'PROFILE_HAS_SHARE',
  /** No open offer of the primary role (for this owner), or it was taken back. */
  'HANDOVER_NOT_FOUND',
  /** The offer's seven days have passed: the primary offers it again. */
  'HANDOVER_EXPIRED',
  /** The co-owner offered the role has no active payout account yet. */
  'PAYOUTS_NOT_ACTIVE',
] as const;
export type ListingOwnerErrorCode = (typeof LISTING_OWNER_ERROR_CODES)[number];
