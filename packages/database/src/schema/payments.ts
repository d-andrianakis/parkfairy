/**
 * Payments (Phase 4): owners' payout accounts at Stripe, the platform's settings, and the Stripe
 * events already handled. A booking's own payment lives on the booking (`payment_intent_id`).
 */
import { PAYOUT_STATUSES, type PayoutStatus } from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
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
