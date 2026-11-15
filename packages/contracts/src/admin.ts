import { z } from 'zod';
import { AreaIdSchema } from './areas.js';
import { LocaleSchema } from './i18n.js';
import {
  OWNER_LIMITS,
  OwnerKindSchema,
  OwnerVerificationSchema,
  ProofKindSchema,
} from './owner.js';
import { bookingsCursor, parseBookingsCursor } from './bookings.js';
import { ListingOwnerRoleSchema } from './listing-owners.js';
import { ListingStatusSchema, MoneySchema } from './parking.js';
import { contractsRegistry } from './registry.js';
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
] as const;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS).register(contractsRegistry, {
  id: 'AuditAction',
});
export type AuditAction = z.infer<typeof AuditActionSchema>;

/** What an action was done to. */
export const AUDIT_TARGETS = ['listing'] as const;

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
    /** The reader owns or manages it: they decide others' listings, never their own. */
    own: z.boolean(),
  })
  .register(contractsRegistry, { id: 'AdminListingReview' });
export type AdminListingReview = z.infer<typeof AdminListingReviewSchema>;

/** What staff asked to have changed: shown to the owner, so in plain words, and not empty. */
export const AdminChangesInputSchema = z
  .object({
    note: z
      .string(message('invalid'))
      .trim()
      // Plain words: new lines and tabs, no other control characters, and no bidi or zero-width
      // ones, which would read differently from what is written.
      .regex(
        /^(?:[^\p{Cc}\p{Cs}\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]|[\t\n\r])*$/u,
        message('invalid'),
      )
      .min(1, message('invalid'))
      .max(OWNER_LIMITS.reviewNote, message('textTooLong')),
  })
  .strict()
  .register(contractsRegistry, { id: 'AdminChangesInput' });
export type AdminChangesInput = z.infer<typeof AdminChangesInputSchema>;

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
] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];
