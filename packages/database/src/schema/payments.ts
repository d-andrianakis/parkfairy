/**
 * Payments (Phase 4): owners' payout accounts at Stripe, the platform's settings, and the Stripe
 * events already handled. A booking's own payment lives on the booking (`payment_intent_id`).
 */
import {
  DISPUTE_STATUSES,
  PAYOUT_STATUSES,
  type DisputeStatus,
  type PayoutStatus,
} from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookings } from './bookings.js';
import { ownerProfiles } from './owners.js';

/** `'a', 'b'` list for CHECK constraints built from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const instant = (name: string) => timestamp(name, { withTimezone: true });

/**
 * An owner's Express account (decision #48), one per owner. Kept apart from `owner_profiles`,
 * whose `updated_at` is the owner's own last change (the reminder reads it): Stripe's updates
 * aren't the owner's.
 */
export const payoutAccounts = pgTable(
  'payout_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Restrict: transfers will hang off this account.
    ownerId: uuid('owner_id')
      .notNull()
      .unique()
      .references(() => ownerProfiles.id, { onDelete: 'restrict' }),
    /** Stripe's `acct_…`. */
    stripeAccountId: text('stripe_account_id').notNull().unique(),
    /** `none` never stored: an owner without an account has no row. */
    status: text('status').$type<Exclude<PayoutStatus, 'none'>>().notNull().default('restricted'),
    /** When Stripe last told us; an older event never overwrites a newer state. */
    statusAt: instant('status_at').defaultNow().notNull(),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (t) => [
    check(
      'payout_accounts_status_check',
      sql`${t.status} in (${sqlList(PAYOUT_STATUSES.filter((status) => status !== 'none'))})`,
    ),
    check('payout_accounts_stripe_id_check', sql`${t.stripeAccountId} ~ '^acct_[A-Za-z0-9]+$'`),
  ],
);

/**
 * The platform's settings: one row. The commission (#15) is a stored setting, copied onto each
 * booking when it is held, so a change never rewrites past bookings or payouts.
 */
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Always true and unique: there is one row. */
    singleton: boolean('singleton').notNull().default(true).unique(),
    /** Parkfairy's share of a booking, in basis points: 1000 is 10%. */
    commissionBps: integer('commission_bps').notNull(),
    updatedAt: instant('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    check('platform_settings_single_row_check', sql`${t.singleton}`),
    check('platform_settings_commission_check', sql`${t.commissionBps} between 0 and 10000`),
  ],
);

/**
 * Stripe events handled, so a delivery Stripe repeats is answered without being handled twice.
 * Handling is safe to repeat anyway; this only spares the work.
 */
export const stripeEvents = pgTable(
  'stripe_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stripe's `evt_…`. */
    stripeEventId: text('stripe_event_id').notNull().unique(),
    type: text('type').notNull(),
    handledAt: instant('handled_at').defaultNow().notNull(),
  },
  // For a later purge: Stripe stops retrying an event after three days.
  (t) => [index('stripe_events_handled_idx').on(t.handledAt)],
);

/**
 * What moved, booking by booking (4.2): the driver's charge, what went back, Parkfairy's
 * commission and the owner's transfer. One of each kind at most per booking, so writing one
 * twice changes nothing. A financial record: nothing cascades into it.
 */
export const LEDGER_KINDS = ['charge', 'refund', 'commission', 'transfer'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    kind: text('kind').$type<LedgerKind>().notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** Stripe's id for what moved (`ch_`, `re_`, `tr_`); none for the commission, which stays. */
    stripeId: text('stripe_id'),
    /** A transfer's payee (co-ownership, #54): each owner paid has an entry of their own. */
    ownerId: uuid('owner_id').references(() => ownerProfiles.id, { onDelete: 'restrict' }),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (t) => [
    // One of each kind per booking, and one transfer per payee: writing one twice changes nothing.
    unique('ledger_entries_booking_kind_owner_key')
      .on(t.bookingId, t.kind, t.ownerId)
      .nullsNotDistinct(),
    index('ledger_entries_owner_idx').on(t.ownerId),
    check('ledger_entries_owner_check', sql`(${t.ownerId} is not null) = (${t.kind} = 'transfer')`),
    // The daily check reads what was entered since its last run.
    index('ledger_entries_created_idx').on(t.createdAt),
    check('ledger_entries_kind_check', sql`${t.kind} in (${sqlList(LEDGER_KINDS)})`),
    check('ledger_entries_amount_check', sql`${t.amountMinor} > 0`),
    check('ledger_entries_currency_check', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * A driver's bank disputing a booking's payment (4.3, #57–#60), as Stripe last told us. The
 * booking's evidence is staged at Stripe when it opens (#59), for support to complete and submit
 * there; an open or lost dispute holds the booking's payout (#58). A financial record: nothing
 * cascades into it.
 */
export const paymentDisputes = pgTable(
  'payment_disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    stripeDisputeId: text('stripe_dispute_id').notNull().unique(),
    status: text('status').$type<DisputeStatus>().notNull(),
    /** Stripe's category (`fraudulent`, `product_not_received`, …). */
    reason: text('reason').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** When the response is due at Stripe; past it, the dispute is lost. */
    dueBy: instant('due_by'),
    /** How many responses went to the bank (from Stripe): none yet, and support must act. */
    submissions: integer('submissions').default(0).notNull(),
    evidenceStagedAt: instant('evidence_staged_at'),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('payment_disputes_booking_idx').on(t.bookingId),
    // The day's look at disputes still to answer, by when.
    index('payment_disputes_open_idx')
      .on(t.dueBy)
      .where(sql`${t.status} in ('needs_response', 'warning_needs_response')`),
    check('payment_disputes_status_check', sql`${t.status} in (${sqlList(DISPUTE_STATUSES)})`),
    check('payment_disputes_amount_check', sql`${t.amountMinor} > 0`),
    check('payment_disputes_currency_check', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('payment_disputes_submissions_check', sql`${t.submissions} >= 0`),
  ],
);
