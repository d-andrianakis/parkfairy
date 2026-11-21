/**
 * Bookings: a driver's claim on one named space (decision #1) for `[starts_at, ends_at)`. A hold
 * keeps the space for HOLD_MINUTES while the driver confirms (decision #3), and is a row here
 * too, so holds and bookings meet the same exclusion constraint (migration 0015): no two rows
 * that take a space may overlap on it, the owner's gap after each included (decision #10).
 *
 * A financial record: nothing cascades into it, and what was agreed (price, policy, gap) is
 * copied in, so later changes to the listing never rewrite a booking.
 */
import {
  BLOCKING_STATUSES,
  BOOKING_CANCELLERS,
  BOOKING_GAPS,
  BOOKING_STATUSES,
  type BookingCanceller,
  type BookingStatus,
  CANCELLATION_POLICIES,
  type CancellationPolicy,
  CURRENCIES,
  HOLD_MAX_EXTENSIONS,
  type Locale,
  PAYMENT_STATUSES,
  type PaymentStatus,
  REFUND_STATUSES,
  type RefundStatus,
  SUPPORTED_LOCALES,
  TRANSFER_STATUSES,
  type TransferStatus,
  VEHICLE_PLATE_LIMITS,
} from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  char,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { parkingLocations, parkingSpaces } from './parking.js';
import { savedVehicles } from './vehicles.js';

export { BOOKING_STATUSES, type BookingStatus };

/** `'a', 'b'` list for CHECK constraints built from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const instant = (name: string) => timestamp(name, { withTimezone: true });

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** What the driver and the owner say to each other: `K7M4-Q2ZD`. */
    reference: text('reference').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'restrict' }),
    /**
     * Null once the owner removes the space from a listing sent back to them; `space_label` keeps
     * the name. Saving spaces refuses to remove one a booking still takes.
     */
    spaceId: uuid('space_id').references(() => parkingSpaces.id, { onDelete: 'set null' }),
    spaceLabel: text('space_label').notNull(),
    /**
     * The booking this one carries on from (Phase 5A): an extension of a stay under way, or the next
     * 30-day period of a monthly booking. It starts where the parent ends, on the same space and
     * for the same driver; the service keeps that true (no constraint can see another row). The
     * owner's gap should come once, after the last piece, so 5A.5 gives the parent a flag that waives
     * its own gap (`bookings_gap_check` ties `blocked_until` to `gap_minutes` today, so it can't just
     * be cut back). A booking has at most one continuation (the unique index). No action on delete,
     * not restrict: it is checked when the statement ends, so a whole chain can go in one.
     */
    continuesBookingId: uuid('continues_booking_id').references((): AnyPgColumn => bookings.id),
    /**
     * The listing's name, address and their language when booked: what the driver's pages and
     * emails show, so text an owner changes later (a listing sent back is edited unreviewed) never
     * reaches them. Null only where a booking made before this was kept met a listing whose owner
     * had cleared it (migration 0019).
     */
    listingName: text('listing_name'),
    listingAddress: text('listing_address'),
    listingLocale: text('listing_locale').$type<Locale>().notNull(),
    startsAt: instant('starts_at').notNull(),
    endsAt: instant('ends_at').notNull(),
    /** The owner's gap when booked: a later change applies to later bookings. */
    gapMinutes: smallint('gap_minutes').notNull(),
    /** `ends_at` plus the gap: until when the space stays taken. */
    blockedUntil: instant('blocked_until').notNull(),
    status: text('status').$type<BookingStatus>().notNull().default('held'),
    holdExpiresAt: instant('hold_expires_at').notNull(),
    /** Times the driver kept the hold for another HOLD_MINUTES (WCAG 2.2.1), up to the limit. */
    holdExtensions: smallint('hold_extensions').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    cancellationPolicy: text('cancellation_policy').$type<CancellationPolicy>().notNull(),
    /** Normalized (`IKB1234`), set when confirmed. Personal data: Phase 6 sets how long it stays. */
    vehiclePlate: text('vehicle_plate'),
    /**
     * The saved vehicle it was held or paid for (5A.2), so the booking page offers it first and a
     * rebook asks for it again. Null once the driver deletes the vehicle: the plate above stays.
     */
    vehicleId: uuid('vehicle_id').references(() => savedVehicles.id, { onDelete: 'set null' }),
    confirmedAt: instant('confirmed_at'),
    cancelledAt: instant('cancelled_at'),
    cancelledBy: text('cancelled_by').$type<BookingCanceller>(),
    /**
     * The account that called it off from the owners' side: the primary owner, a co-owner or a
     * manager (#69). Null for a driver's cancellation, and for bookings called off before this.
     */
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Owed to the driver after a cancellation; paid out from Phase 4. */
    refundMinor: integer('refund_minor'),
    /**
     * Parkfairy's share, in basis points, from `platform_settings` when the space was held (#15):
     * a later change of rate never reaches this booking or its payout.
     */
    commissionBps: integer('commission_bps').notNull(),
    /** Stripe's PaymentIntent (`pi_…`), one per booking, once the driver went to pay (Phase 4). */
    paymentIntentId: text('payment_intent_id').unique(),
    /** Where that payment stands, as Stripe last told us; null before one was asked for. */
    paymentStatus: text('payment_status').$type<PaymentStatus>(),
    /** The charge that took the money (`ch_…`), once paid: the owner's transfer is tied to it. */
    stripeChargeId: text('stripe_charge_id'),
    /** A cancellation's refund at Stripe (4.2): owed in the cancel's transaction, then sent. */
    refundStatus: text('refund_status').$type<RefundStatus>(),
    stripeRefundId: text('stripe_refund_id'),
    /**
     * How many times staff asked Stripe again after a failed refund (#84): part of the idempotency
     * key, since the same key would give the same failed refund back.
     */
    refundAttempts: smallint('refund_attempts').default(0).notNull(),
    /**
     * The owner's share (#4, #50, #51), worked out when it goes, 24 hours after the stay: what's
     * kept less Parkfairy's commission, both kept here as sent.
     */
    transferStatus: text('transfer_status').$type<TransferStatus>(),
    transferMinor: integer('transfer_minor'),
    commissionMinor: integer('commission_minor'),
    /** When every payee's part went (`booking_payees` holds each, with Stripe's ids). */
    transferredAt: instant('transferred_at'),
    /**
     * The worker's tries at the money this booking owes (a refund, a transfer, a payment to call
     * off) that Stripe refused, and when to try again: each wait twice the last, six hours at
     * most, so one that keeps failing costs little and keeps nothing waiting. Back to none once
     * it went.
     */
    moneyAttempts: integer('money_attempts').default(0).notNull(),
    moneyRetryAt: instant('money_retry_at'),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // A driver's lists; also what deleting an account checks.
    index('bookings_user_starts_idx').on(t.userId, t.startsAt),
    // An owner's bookings page and the check that closing hours strand nobody. The id last: the
    // page goes by `(starts_at, id)` places, which this answers in order and exactly (0020).
    index('bookings_location_starts_id_idx').on(t.locationId, t.startsAt, t.id),
    // The owner's list of called-off bookings (5.1): each listing's latest, in order. A few percent of
    // the table, so a listing with few of them doesn't walk a whole window of the others.
    index('bookings_location_cancelled_idx')
      .on(t.locationId, t.startsAt, t.id)
      .where(sql`${t.status} = 'cancelled'`),
    // Removing a space sets its bookings' space to null; without it, a scan per space.
    index('bookings_space_idx').on(t.spaceId),
    // The worker's reminders (5A.3): confirmed stays about to start, and about to end.
    index('bookings_confirmed_starts_idx')
      .on(t.startsAt)
      .where(sql`${t.status} = 'confirmed'`),
    index('bookings_confirmed_ends_idx')
      .on(t.endsAt)
      .where(sql`${t.status} = 'confirmed'`),
    // Deleting a saved vehicle sets its bookings' vehicle to null; without it, a scan per delete.
    index('bookings_vehicle_idx')
      .on(t.vehicleId)
      .where(sql`${t.vehicleId} is not null`),
    // A booking has one *live* continuation at most (a hold, or a booking that stands): one that
    // lapsed, was let go or was cancelled stays as history and must not block the next try. Also
    // what finding "what carries on from this?" reads. The statuses are the ones that take a space.
    uniqueIndex('bookings_continues_idx')
      .on(t.continuesBookingId)
      .where(
        sql`${t.continuesBookingId} is not null and ${t.status} in (${sqlList(BLOCKING_STATUSES)})`,
      ),
    check(
      'bookings_continues_check',
      sql`${t.continuesBookingId} is null or ${t.continuesBookingId} <> ${t.id}`,
    ),
    // Deleting an account that called bookings off sets this null: without it, a scan per account.
    index('bookings_cancelled_by_user_idx')
      .on(t.cancelledByUserId)
      .where(sql`${t.cancelledByUserId} is not null`),
    // One hold per driver at a time: a second press at once can't see the first's row, so this is
    // what refuses it (the service then lets the first go and holds again).
    uniqueIndex('bookings_one_hold_per_user_idx')
      .on(t.userId)
      .where(sql`${t.status} = 'held'`),
    // The worker's sweep of holds that ran out.
    index('bookings_hold_expiry_idx')
      .on(t.holdExpiresAt)
      .where(sql`${t.status} = 'held'`),
    // The money the worker moves: refunds owed (a cancellation's, or a paid hold's finishing)…
    // A refund that failed after Stripe took it, or that staff asked again and Stripe keeps refusing
    // (#84): the few staff settle, oldest change first.
    index('bookings_refund_failed_idx')
      .on(t.updatedAt, t.id)
      .where(
        sql`${t.refundStatus} = 'failed' or (${t.refundStatus} = 'owed' and ${t.refundAttempts} > 0)`,
      ),
    index('bookings_refunds_owed_idx')
      .on(t.updatedAt)
      .where(sql`${t.refundStatus} = 'owed' or ${t.paymentStatus} = 'refunding'`),
    // …transfers coming due, 24 hours after each paid stay…
    index('bookings_transfers_due_idx')
      .on(t.endsAt)
      .where(
        sql`${t.paymentStatus} = 'succeeded' and ${t.status} in ('confirmed', 'cancelled') and (${t.transferStatus} is null or ${t.transferStatus} = 'sending') and (${t.refundMinor} is null or ${t.refundMinor} < ${t.totalMinor})`,
      ),
    // …and PaymentIntents of holds that lapsed unpaid, to call off.
    index('bookings_lapsed_payments_idx')
      .on(t.updatedAt)
      .where(sql`${t.paymentStatus} = 'pending' and ${t.status} in ('expired', 'released')`),
    // And its deletion of holds that never became bookings, a week on.
    // Holds a payment was asked for are kept (Phase 4), so they stay out of it too.
    index('bookings_stale_holds_idx')
      .on(t.updatedAt)
      .where(
        sql`${t.status} in ('expired', 'released') and (${t.paymentIntentId} is null or ${t.paymentStatus} = 'canceled')`,
      ),
    check('bookings_status_check', sql`${t.status} in (${sqlList(BOOKING_STATUSES)})`),
    check(
      'bookings_reference_check',
      sql`${t.reference} ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'`,
    ),
    check('bookings_period_check', sql`${t.startsAt} < ${t.endsAt}`),
    check(
      'bookings_gap_check',
      sql`${t.gapMinutes} in (${sql.raw(BOOKING_GAPS.join(', '))}) and ${t.blockedUntil} = ${t.endsAt} + make_interval(mins => ${t.gapMinutes})`,
    ),
    check(
      'bookings_listing_locale_check',
      sql`${t.listingLocale} in (${sqlList(SUPPORTED_LOCALES)})`,
    ),
    check('bookings_currency_check', sql`${t.currency} in (${sqlList(CURRENCIES)})`),
    check(
      'bookings_hold_extensions_check',
      sql`${t.holdExtensions} between 0 and ${sql.raw(String(HOLD_MAX_EXTENSIONS))}`,
    ),
    check('bookings_total_check', sql`${t.totalMinor} >= 0`),
    check(
      'bookings_cancellation_policy_check',
      sql`${t.cancellationPolicy} in (${sqlList(CANCELLATION_POLICIES)})`,
    ),
    check(
      'bookings_vehicle_plate_check',
      sql`${t.vehiclePlate} is null or ${t.vehiclePlate} ~ '^[A-Z0-9]{${sql.raw(String(VEHICLE_PLATE_LIMITS.min))},${sql.raw(String(VEHICLE_PLATE_LIMITS.max))}}$'`,
    ),
    // Confirmed once means a car and a time, whatever happened after.
    check(
      'bookings_confirmed_check',
      sql`${t.status} not in ('confirmed', 'cancelled') or (${t.vehiclePlate} is not null and ${t.confirmedAt} is not null)`,
    ),
    check(
      'bookings_cancelled_check',
      sql`case when ${t.status} = 'cancelled' then ${t.cancelledAt} is not null and ${t.refundMinor} is not null and ${t.cancelledBy} in (${sqlList(BOOKING_CANCELLERS)}) else ${t.cancelledAt} is null and ${t.cancelledBy} is null and ${t.refundMinor} is null end`,
    ),
    check(
      'bookings_refund_check',
      sql`${t.refundMinor} is null or ${t.refundMinor} between 0 and ${t.totalMinor}`,
    ),
    check('bookings_commission_check', sql`${t.commissionBps} between 0 and 10000`),
    // A cancellation's refund: paid, cancelled, something to give back; sent with Stripe's id.
    check(
      'bookings_refund_status_check',
      sql`${t.refundStatus} is null or (${t.refundStatus} in (${sqlList(REFUND_STATUSES)}) and ${t.status} = 'cancelled' and ${t.paymentStatus} = 'succeeded' and ${t.refundMinor} is not null and ${t.refundMinor} > 0 and ((${t.refundStatus} in ('sent', 'failed')) = (${t.stripeRefundId} is not null) or ${t.refundStatus} = 'settled'))`,
    ),
    // A transfer: paid for, its refund settled, its amounts worked out and adding up to what's
    // kept (#50), sent with Stripe's id and its time. Nulls stated: a CHECK passes on null.
    check(
      'bookings_transfer_check',
      sql`${t.transferStatus} is null or (${t.transferStatus} in (${sqlList(TRANSFER_STATUSES)}) and ${t.paymentStatus} = 'succeeded' and ${t.refundStatus} is distinct from 'owed' and ${t.transferMinor} is not null and ${t.commissionMinor} is not null and ${t.transferMinor} > 0 and ${t.commissionMinor} >= 0 and ${t.transferMinor} + ${t.commissionMinor} = ${t.totalMinor} - coalesce(${t.refundMinor}, 0) and (${t.transferStatus} = 'sent') = (${t.transferredAt} is not null))`,
    ),
    check('bookings_money_attempts_check', sql`${t.moneyAttempts} >= 0`),
    // A payment's state and its PaymentIntent come together.
    check(
      'bookings_payment_check',
      sql`(${t.paymentIntentId} is null) = (${t.paymentStatus} is null) and (${t.paymentStatus} is null or ${t.paymentStatus} in (${sqlList(PAYMENT_STATUSES)}))`,
    ),
    check(
      'bookings_payment_intent_check',
      sql`${t.paymentIntentId} is null or ${t.paymentIntentId} ~ '^pi_[A-Za-z0-9]+$'`,
    ),
  ],
);
