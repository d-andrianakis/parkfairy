/**
 * Emails owed to people, written in the same transaction as what caused them, so one is never
 * lost to a crash and never sent for something that rolled back. The worker drains the table;
 * the row's id is the idempotency key, so a retry after a lost answer sends nothing twice.
 *
 * No addresses and no secrets: the recipient is looked up when sending, so a changed address
 * is honoured, and a live link must never wait here.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { listingInvites } from './listing-owners.js';

export const OUTBOX_EMAIL_KINDS = [
  'listing-submitted',
  'listing-approved',
  'listing-changes-requested',
  'onboarding-reminder',
  // To the driver.
  'booking-confirmed',
  'booking-cancelled',
  'booking-payment-refunded',
  // To the listing's owner.
  'booking-received',
  'booking-cancelled-by-driver',
  // To the primary owner, when a co-owner or a manager called a booking off (#69).
  'booking-cancelled-by-team',
  // To someone invited to own a listing (#56), who may have no account yet.
  'listing-invite',
  // To the co-owner offered the primary role, and to the primary who gave it up (#61–#64).
  'listing-handover-offered',
  'listing-handover-accepted',
  // To an account whose second factor support removed (#13).
  'two-factor-removed',
  // To a listing's primary owner when staff took it down or brought it back (#78, #81).
  'listing-suspended',
  'listing-reinstated',
  // To an account's holder when it was suspended or reinstated (#79, #81).
  'account-suspended',
  'account-reinstated',
  // To a booking's owners when support called it off, and when a lost dispute was decided (#82, #83).
  'booking-cancelled-by-staff',
  'dispute-parkfairy-bears',
  'dispute-owners-bear',
] as const;
export type OutboxEmailKind = (typeof OUTBOX_EMAIL_KINDS)[number];

export const OUTBOX_STATUSES = ['pending', 'sent', 'failed'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** `'a', 'b'` list for CHECK constraints built from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/** A booking as its emails show it: no names of people, no plate, nothing the reader didn't see. */
export interface OutboxBooking {
  id: string;
  listingId: string;
  reference: string;
  /** The listing's address, public on its page. */
  address: string | null;
  contentLocale: string;
  spaceLabel: string;
  /** ISO instants, written out in the reader's language when sending. */
  start: string;
  end: string;
  timeZone: string;
  totalMinor: number;
  currency: string;
  /** Cancellations only. */
  refundMinor?: number;
  cancelledBy?: 'driver' | 'owner';
  /** An owner-side cancellation by someone other than the primary: who, by role, never by name. */
  cancelledByRole?: 'co_owner' | 'manager';
}

/** What the templates may show. `listingName` is the owner's own text, about their own listing. */
export interface OutboxPayload {
  listingName?: string;
  /** The language the listing is written in, for `lang` on its name (rows from 2026-11-11 on). */
  contentLocale?: string;
  booking?: OutboxBooking;
  /** Handover emails: the page they link to; the listing's name is never in them (an owner's text). */
  listingId?: string;
}

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<OutboxEmailKind>().notNull(),
    /** The account it goes to; or, for an invite, the invite (its address, its language). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    inviteId: uuid('invite_id').references(() => listingInvites.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<OutboxPayload>().notNull().default({}),
    /** One email per event, however many sweeps see it. */
    dedupeKey: text('dedupe_key').notNull().unique(),
    status: text('status').$type<OutboxStatus>().notNull().default('pending'),
    attempts: smallint('attempts').notNull().default(0),
    /** A claim pushes this forward, so a worker that dies mid-send gives the row back. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** A short reason, never the address or body. */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // The cascade from `users` would otherwise scan the table for every deleted account.
    index('email_outbox_user_idx').on(t.userId),
    index('email_outbox_invite_idx').on(t.inviteId),
    check(
      'email_outbox_recipient_check',
      sql`(${t.userId} is null) <> (${t.inviteId} is null) and (${t.inviteId} is null) = (${t.kind} <> 'listing-invite')`,
    ),
    index('email_outbox_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    check('email_outbox_kind_check', sql`${t.kind} in (${sqlList(OUTBOX_EMAIL_KINDS)})`),
    check('email_outbox_status_check', sql`${t.status} in (${sqlList(OUTBOX_STATUSES)})`),
  ],
);
