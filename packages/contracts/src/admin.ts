import { z } from 'zod';

import { AreaIdSchema } from './areas.js';
import {
  BOOKING_REFERENCE_PATTERN,
  BookingCancellerSchema,
  bookingsCursor,
  BookingStatusSchema,
  parseBookingsCursor,
} from './bookings.js';
import { LocaleSchema } from './i18n.js';
import { ListingOwnerRoleSchema } from './listing-owners.js';
import {
  OWNER_LIMITS,
  OwnerKindSchema,
  OwnerVerificationSchema,
  ProofKindSchema,
} from './owner.js';
import { ListingStatusSchema, MoneySchema } from './parking.js';
import {
  DISPUTE_DECISIONS,
  DISPUTE_STATUSES,
  PaymentStatusSchema,
  REFUND_STATUSES,
  TRANSFER_STATUSES,
} from './payments.js';
import { contractsRegistry } from './registry.js';
import { UserRoleSchema } from './users.js';
import { message } from './validation.js';

/**
 * What staff do (Phase 5.2, #66–#68): review a listing a person sent in, and the record of it. The
 * admin screens are a separate app on their own origin; the API is the one in `apps/api`, every
 * route `@Roles('admin')` and, for an admin, behind a second factor. Each action is written to the
 * audit log in its own transaction, which the database refuses to change or delete (#68).
 */

/** Everything staff do that is kept, one name each: what the log's filter offers. */
export const AUDIT_ACTIONS = [
  'listing.approved',
  'listing.changes_requested',
  /** A proof of the right to rent opened: a deed or a lease names people and their tax numbers. */
  'listing.proof_opened',
  /** Support took an account's second factor off after an identity check (#13). */
  'user.two_factor_removed',
  /** Someone on the staff opened an account's page: its name and address are personal data. */
  'user.viewed',
  /** A live listing taken off the site, with a note its owners read (#78, #79). */
  'listing.suspended',
  'listing.reinstated',
  /** An account that can no longer sign in; its note is for the log alone (#79, #80). */
  'user.suspended',
  'user.reinstated',
  /** Someone on the staff opened a booking: the driver's name, email and plate are on it (#85). */
  'booking.viewed',
  /** Support called a booking off with a full refund (#82). */
  'booking.cancelled',
  /** A failed refund asked of Stripe again, or marked settled another way (#84). */
  'booking.refund_retried',
  'booking.refund_settled',
  /** Who bears a lost dispute, decided (#83). */
  'dispute.decided',
  /** An owner's report of a car left past its booking, looked into and closed (#11, #76). */
  'overstay.resolved',
] as const;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS).register(contractsRegistry, {
  id: 'AuditAction',
});
export type AuditAction = z.infer<typeof AuditActionSchema>;

/** What an action was done to. */
export const AUDIT_TARGETS = ['listing', 'user', 'booking', 'dispute'] as const;

/** Staff see this many to a page, in the queue and in the log. */
export const ADMIN_PAGE_SIZE = 25;

/** Where a page of the queue or the log starts: after a place a page gave out. */
const cursor = z
  .string(message('invalid'))
  .refine((place) => parseBookingsCursor(place) !== null, message('invalid'));

/** The place after an item whose time and id are these, as `bookingsCursor` writes it. */
export const adminCursor = (at: Date, id: string) => bookingsCursor({ start: at, id });

/** Listings waiting for a decision are the queue; the rest of a listing's life can be browsed. */
export const ADMIN_LISTING_STATUSES = [
  'in_review',
  'changes_requested',
  'published',
  'suspended',
] as const;

export const AdminQueueQuerySchema = z
  .object({
    status: z.enum(ADMIN_LISTING_STATUSES, message('invalid')).default('in_review'),
    after: cursor.optional(),
  })
  .register(contractsRegistry, { id: 'AdminQueueQuery' });
export type AdminQueueQuery = z.infer<typeof AdminQueueQuerySchema>;

export const AdminQueueItemSchema = z
  .object({
    id: z.uuid(),
    status: ListingStatusSchema,
    /** The owner's own words, in the language they wrote them (`contentLocale`). */
    name: z.string().nullable(),
    address: z.string().nullable(),
    contentLocale: LocaleSchema,
    /** The primary owner's account name. */
    owner: z.string().nullable(),
    /** When it was sent in: what the queue is ordered by, oldest first. */
    submittedAt: z.iso.datetime().nullable(),
  })
  .register(contractsRegistry, { id: 'AdminQueueItem' });
export type AdminQueueItem = z.infer<typeof AdminQueueItemSchema>;

export const AdminQueueSchema = z
  .object({
    listings: z.array(AdminQueueItemSchema).max(ADMIN_PAGE_SIZE),
    /** `after` for the page that follows, null on the last. */
    next: z.string().nullable(),
  })
  .register(contractsRegistry, { id: 'AdminQueue' });
export type AdminQueue = z.infer<typeof AdminQueueSchema>;

/**
 * An owner as staff see them to judge a listing: who they are, never the tax values whole (#67):
 * the last three characters, as the owner sees them. No phone and no address: not what a decision
 * needs (minimisation).
 */
export const AdminOwnerSchema = z
  .object({
    role: ListingOwnerRoleSchema,
    /** The account's name. */
    accountName: z.string(),
    kind: OwnerKindSchema.nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    legalName: z.string().nullable(),
    country: z.string().nullable(),
    taxCountry: z.string(),
    taxIdEnding: z.string().max(3).nullable(),
    vatIdEnding: z.string().max(3).nullable(),
    registrationEnding: z.string().max(3).nullable(),
    verification: OwnerVerificationSchema,
    /** Their share of the owners' payouts, in whole percent. */
    sharePercent: z.number().int().min(0).max(100),
    /** The account's own page of details and tax is complete (#22). */
    detailsComplete: z.boolean(),
  })
  .register(contractsRegistry, { id: 'AdminOwner' });
export type AdminOwner = z.infer<typeof AdminOwnerSchema>;

export const AdminProofSchema = z
  .object({
    id: z.uuid(),
    kind: ProofKindSchema,
    fileName: z.string(),
    contentType: z.string(),
    sizeBytes: z.int().positive(),
    createdAt: z.iso.datetime(),
  })
  .register(contractsRegistry, { id: 'AdminProof' });
export type AdminProof = z.infer<typeof AdminProofSchema>;

/** A listing as staff review it: what it says, who is behind it, and what proves the right to rent. */
export const AdminListingReviewSchema = z
  .object({
    id: z.uuid(),
    status: ListingStatusSchema,
    name: z.string().nullable(),
    description: z.string().nullable(),
    address: z.string().nullable(),
    areaId: AreaIdSchema.nullable(),
    contentLocale: LocaleSchema,
    landRegistrationNumber: z.string().nullable(),
    hourlyRate: MoneySchema.nullable(),
    spaces: z.array(z.string()),
    photos: z.int().nonnegative(),
    submittedAt: z.iso.datetime().nullable(),
    /** What staff last asked to have changed, while the listing is with its owner. */
    reviewNote: z.string().nullable(),
    owners: z.array(AdminOwnerSchema),
    proofs: z.array(AdminProofSchema),
    /** It is waiting for a decision. */
    canDecide: z.boolean(),
    /** It is live, and staff may take it down (#78). Never their own. */
    canSuspend: z.boolean(),
    /** It is suspended, and staff may bring it back. Never their own. */
    canReinstate: z.boolean(),
    /** Confirmed bookings that haven't started: what suspending may cancel. */
    upcomingBookings: z.int().nonnegative(),
    /** The reader owns or manages it: they decide others' listings, never their own. */
    own: z.boolean(),
  })
  .register(contractsRegistry, { id: 'AdminListingReview' });
export type AdminListingReview = z.infer<typeof AdminListingReviewSchema>;

/**
 * A note staff write: plain words (new lines and tabs, no other control or format characters, no
 * default-ignorable ones such as the Hangul fillers, which covers every bidi, zero-width and
 * invisible one, and no line or paragraph separators, which would read differently from what is
 * written), in one Unicode form, not empty, at most `max`.
 */
export const staffNote = (max: number) =>
  z
    .string(message('invalid'))
    .trim()
    .normalize('NFC')
    .regex(
      /^(?:[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]|[\t\n\r])*$/u,
      message('invalid'),
    )
    .min(1, message('invalid'))
    .max(max, message('textTooLong'));

/**
 * Why a listing is suspended, as its owners read it (#79), and whether its upcoming bookings go
 * with it (#78): the drivers are refunded in full and told. Said each time, never assumed.
 */
export const AdminSuspendListingInputSchema = z
  .object({
    note: staffNote(OWNER_LIMITS.reviewNote),
    cancelBookings: z.boolean(message('invalid')),
  })
  .strict()
  .register(contractsRegistry, { id: 'AdminSuspendListingInput' });
export type AdminSuspendListingInput = z.infer<typeof AdminSuspendListingInputSchema>;

/** The longest note kept for the log alone: a reference and a few words, not a story (#81). */
export const ADMIN_REASON_NOTE_MAX = 100;

/**
 * A note for the audit log alone (#79, #81): why an account was suspended, or why a listing or an
 * account was reinstated. The person is never shown it, and nothing can erase it, so a ticket
 * reference and a few words.
 */
export const AdminReasonInputSchema = z
  .object({ note: staffNote(ADMIN_REASON_NOTE_MAX) })
  .strict()
  .register(contractsRegistry, { id: 'AdminReasonInput' });
export type AdminReasonInput = z.infer<typeof AdminReasonInputSchema>;

/** What staff asked to have changed: shown to the owner, so in plain words, and not empty. */
export const AdminChangesInputSchema = z
  .object({ note: staffNote(OWNER_LIMITS.reviewNote) })
  .strict()
  .register(contractsRegistry, { id: 'AdminChangesInput' });
export type AdminChangesInput = z.infer<typeof AdminChangesInputSchema>;

/**
 * The longest note on how an identity was checked. It stays in the audit log for good, which nothing
 * can erase, so it is a ticket reference and the kind of check, never names or document details.
 */
export const ADMIN_IDENTITY_NOTE_MAX = 100;

/**
 * Looking an account up: by its whole email address and no other way, so staff find the person who
 * is asking for help and can't browse everyone's addresses (minimisation). Emails are stored in
 * lower case, so the lookup is too. Sent in a body, never in a URL: an address in a query string
 * would reach every access log on the way.
 */
export const AdminUserLookupSchema = z
  .object({
    email: z
      .string(message('invalid'))
      .trim()
      .toLowerCase()
      .pipe(z.email(message('invalid')).max(254, message('invalid'))),
  })
  .strict()
  .register(contractsRegistry, { id: 'AdminUserLookup' });
export type AdminUserLookup = z.infer<typeof AdminUserLookupSchema>;

/**
 * An account as support sees it to help its person: who it is and how it is secured. No phone, no
 * address, no owner details, and never a secret or a backup code.
 */
export const AdminUserSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    role: UserRoleSchema,
    locale: LocaleSchema,
    emailVerified: z.boolean(),
    twoFactorEnabled: z.boolean(),
    createdAt: z.iso.datetime(),
    /** The reader is this account: staff never act on their own. */
    own: z.boolean(),
    /** Support can remove its second factor: it has one, and the account is not staff's. */
    canRemoveTwoFactor: z.boolean(),
    /** Suspended: it can't sign in, and nothing it holds is touched (#80). */
    suspended: z.boolean(),
    /** Staff may suspend it: an ordinary account, not the reader's, not already. */
    canSuspend: z.boolean(),
    /** Staff may reinstate it: it is suspended. */
    canReinstate: z.boolean(),
    /** Live listings it is the primary owner of: they stay live if it is suspended (#80). */
    liveListings: z.int().nonnegative(),
  })
  .register(contractsRegistry, { id: 'AdminUser' });
export type AdminUser = z.infer<typeof AdminUserSchema>;

/**
 * The account an address belongs to, or none: only its id, which opens its page. The page is what
 * shows the account's name and address, and what is written to the audit log.
 */
export const AdminUserLookupResultSchema = z
  .object({ id: z.uuid().nullable() })
  .register(contractsRegistry, { id: 'AdminUserLookupResult' });
export type AdminUserLookupResult = z.infer<typeof AdminUserLookupResultSchema>;

/**
 * Removing an account's second factor after an identity check (#13). The note says how the person
 * was identified (a ticket, a call), in words that stay in the audit log.
 */
export const AdminRemoveTwoFactorInputSchema = z
  .object({ note: staffNote(ADMIN_IDENTITY_NOTE_MAX) })
  .strict()
  .register(contractsRegistry, { id: 'AdminRemoveTwoFactorInput' });
export type AdminRemoveTwoFactorInput = z.infer<typeof AdminRemoveTwoFactorInputSchema>;

export const AdminAuditQuerySchema = z
  .object({ action: AuditActionSchema.optional(), after: cursor.optional() })
  .register(contractsRegistry, { id: 'AdminAuditQuery' });
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;

export const AuditEntrySchema = z
  .object({
    id: z.uuid(),
    at: z.iso.datetime(),
    action: AuditActionSchema,
    actor: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
    targetType: z.enum(AUDIT_TARGETS),
    targetId: z.uuid(),
    /** What it was, in ids and short words: never a document, a tax value or an address. */
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .register(contractsRegistry, { id: 'AuditEntry' });
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditLogSchema = z
  .object({
    entries: z.array(AuditEntrySchema).max(ADMIN_PAGE_SIZE),
    next: z.string().nullable(),
  })
  .register(contractsRegistry, { id: 'AuditLog' });
export type AuditLog = z.infer<typeof AuditLogSchema>;

/**
 * A booking by its reference, the one the driver quotes: sent in a body, so no reference is in a URL
 * or a log, and the answer is the booking's id (what opening its page then logs, #85).
 */
export const AdminBookingLookupSchema = z
  .object({
    reference: z
      .string(message('invalid'))
      .trim()
      .toUpperCase()
      .regex(BOOKING_REFERENCE_PATTERN, message('invalid')),
  })
  .strict()
  .register(contractsRegistry, { id: 'AdminBookingLookup' });
export type AdminBookingLookup = z.infer<typeof AdminBookingLookupSchema>;

export const AdminBookingLookupResultSchema = z
  .object({ id: z.uuid().nullable() })
  .register(contractsRegistry, { id: 'AdminBookingLookupResult' });
export type AdminBookingLookupResult = z.infer<typeof AdminBookingLookupResultSchema>;

/** A dispute of a booking's payment as staff see it (#57, #83). */
export const AdminDisputeSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(DISPUTE_STATUSES),
    /** Stripe's category (`fraudulent`, …): its own words, shown as written. */
    reason: z.string(),
    amount: MoneySchema,
    dueBy: z.iso.datetime().nullable(),
    /** How many responses went to the bank: none, and support must act in Stripe. */
    submissions: z.int().nonnegative(),
    decision: z.enum(DISPUTE_DECISIONS).nullable(),
    decidedAt: z.iso.datetime().nullable(),
    /** It is lost and nobody has decided who bears it: staff's to decide. */
    canDecide: z.boolean(),
    /**
     * The owners' payout for the booking is still to come, so either decision means something. When
     * it was paid already, or nothing was kept, only "Parkfairy bears it" can be recorded.
     */
    payoutHeld: z.boolean(),
  })
  .register(contractsRegistry, { id: 'AdminDispute' });
export type AdminDispute = z.infer<typeof AdminDisputeSchema>;

/**
 * A booking as support sees it (#82, #85): what was booked and by whom, what was paid and what
 * went back, and where its payout and any dispute stand. The driver's name, email and plate are on
 * it, so opening it is a line of the audit log.
 */
export const AdminBookingSchema = z
  .object({
    id: z.uuid(),
    reference: z.string(),
    status: BookingStatusSchema,
    /** The listing as it was when booked: what the driver saw. */
    listing: z.object({
      id: z.uuid(),
      name: z.string().nullable(),
      address: z.string().nullable(),
      contentLocale: LocaleSchema,
    }),
    spaceLabel: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    driver: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
    vehiclePlate: z.string().nullable(),
    total: MoneySchema,
    paymentStatus: PaymentStatusSchema.nullable(),
    refund: z.object({
      status: z.enum(REFUND_STATUSES).nullable(),
      amount: MoneySchema.nullable(),
      /** How often staff asked Stripe again after a failed refund (#84). */
      attempts: z.int().nonnegative(),
    }),
    cancelledBy: BookingCancellerSchema.nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    transferStatus: z.enum(TRANSFER_STATUSES).nullable(),
    disputes: z.array(AdminDisputeSchema),
    /** Confirmed and not begun: staff may call it off with a full refund (#82). */
    canCancel: z.boolean(),
    /** A refund that failed, before any payout was made: staff may ask Stripe again (#84). */
    canRetryRefund: z.boolean(),
    /**
     * A refund that failed, or that staff asked again and Stripe keeps refusing: staff may mark it
     * settled, the driver paid another way (#84).
     */
    canSettleRefund: z.boolean(),
  })
  .register(contractsRegistry, { id: 'AdminBooking' });
export type AdminBooking = z.infer<typeof AdminBookingSchema>;

/** Who bears a lost dispute, and a note for the log (#83): decided once, never shown to the owners. */
export const AdminDisputeDecisionInputSchema = z
  .object({
    decision: z.enum(DISPUTE_DECISIONS, message('invalid')),
    note: staffNote(ADMIN_REASON_NOTE_MAX),
  })
  .strict()
  .register(contractsRegistry, { id: 'AdminDisputeDecisionInput' });
export type AdminDisputeDecisionInput = z.infer<typeof AdminDisputeDecisionInputSchema>;

/** What needs support in money: a row of the payments page. */
export const AdminPaymentItemSchema = z
  .object({
    bookingId: z.uuid(),
    reference: z.string(),
    listingName: z.string().nullable(),
    contentLocale: LocaleSchema,
    amount: MoneySchema,
    /** Dispute rows: its id, status, reason and due date; refund rows: how often it was retried. */
    disputeId: z.uuid().nullable(),
    disputeStatus: z.enum(DISPUTE_STATUSES).nullable(),
    reason: z.string().nullable(),
    dueBy: z.iso.datetime().nullable(),
    attempts: z.int().nonnegative(),
    /** When it last changed: what the lists are ordered by, oldest first. */
    at: z.iso.datetime(),
  })
  .register(contractsRegistry, { id: 'AdminPaymentItem' });
export type AdminPaymentItem = z.infer<typeof AdminPaymentItemSchema>;

/** At most this many to a list: what needs support is few, and a pile is itself the finding. */
export const ADMIN_PAYMENTS_LIST_MAX = 50;

export const AdminPaymentsSchema = z
  .object({
    /** Lost, and nobody has said who bears it (#57): the payout is held until they do. */
    lostDisputes: z.array(AdminPaymentItemSchema).max(ADMIN_PAYMENTS_LIST_MAX),
    /** Still to answer or under review at the bank: answered in Stripe, shown here to be seen. */
    openDisputes: z.array(AdminPaymentItemSchema).max(ADMIN_PAYMENTS_LIST_MAX),
    /** Refunds Stripe took and then failed: the driver is owed money (#84). */
    failedRefunds: z.array(AdminPaymentItemSchema).max(ADMIN_PAYMENTS_LIST_MAX),
    /** A list that is full has more than it shows. */
    more: z.object({
      lostDisputes: z.boolean(),
      openDisputes: z.boolean(),
      failedRefunds: z.boolean(),
    }),
  })
  .register(contractsRegistry, { id: 'AdminPayments' });
export type AdminPayments = z.infer<typeof AdminPaymentsSchema>;

/** Every `code` an admin route answers with, for clients to translate. */
export const ADMIN_ERROR_CODES = [
  'LISTING_NOT_FOUND',
  'PROOF_NOT_FOUND',
  /** The listing isn't waiting for a decision (another admin decided first, or it was sent back). */
  'NOT_IN_REVIEW',
  /** Staff decide other people's listings, not their own. */
  'OWN_LISTING',
  /** An owner of it changed their details since it was sent in: they must be complete (#22). */
  'OWNER_DETAILS_MISSING',
  'USER_NOT_FOUND',
  /** Staff act on other people's accounts, not their own. */
  'OWN_ACCOUNT',
  /** Staff accounts are recovered by hand, never by another admin's click (#13). */
  'STAFF_ACCOUNT',
  /** The account has no second factor to remove. */
  'NO_TWO_FACTOR',
  /** Only a live listing can be suspended. */
  'NOT_PUBLISHED',
  /** Only a suspended listing or account can be reinstated. */
  'NOT_SUSPENDED',
  /** The account is suspended already. */
  'ALREADY_SUSPENDED',
  'BOOKING_NOT_FOUND',
  /** Only a confirmed booking that hasn't started can be called off (#82). */
  'NOT_CANCELLABLE',
  /** The booking has no failed refund to retry or settle (#84). */
  'REFUND_NOT_FAILED',
  /** Its owners were paid already: a refund can't be asked again, only settled (#84). */
  'TRANSFER_MADE',
  'DISPUTE_NOT_FOUND',
  /** A dispute holds the booking: it can't be cancelled or its refund asked again (#82, #84). */
  'DISPUTED',
  /** No payout is held for it, so the owners can't be said to bear the loss (#83). */
  'NOT_HELD',
  /** Only a lost dispute is decided (#57). */
  'NOT_LOST',
  /** Decided already: once, and for good (#83). */
  'ALREADY_DECIDED',
  'OVERSTAY_NOT_FOUND',
  /** Closed already: once, and for good (#76). */
  'ALREADY_RESOLVED',
] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];
