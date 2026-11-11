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

export const OUTBOX_EMAIL_KINDS = [
  'listing-submitted',
  'listing-approved',
  'listing-changes-requested',
  'onboarding-reminder',
  // To the driver.
  'booking-confirmed',
  'booking-cancelled',
  // To the listing's owner.
  'booking-received',
  'booking-cancelled-by-driver',
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
}

/** What the templates may show. `listingName` is the owner's own text, about their own listing. */
export interface OutboxPayload {
  listingName?: string;
  /** The language the listing is written in, for `lang` on its name (rows from 2026-11-11 on). */
  contentLocale?: string;
  booking?: OutboxBooking;
}

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<OutboxEmailKind>().notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    index('email_outbox_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    check('email_outbox_kind_check', sql`${t.kind} in (${sqlList(OUTBOX_EMAIL_KINDS)})`),
    check('email_outbox_status_check', sql`${t.status} in (${sqlList(OUTBOX_STATUSES)})`),
  ],
);
