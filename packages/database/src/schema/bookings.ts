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
  BOOKING_CANCELLERS,
  BOOKING_GAPS,
  BOOKING_STATUSES,
  CANCELLATION_POLICIES,
  CURRENCIES,
  HOLD_MAX_EXTENSIONS,
  SUPPORTED_LOCALES,
  VEHICLE_PLATE_LIMITS,
  type BookingCanceller,
  type BookingStatus,
  type CancellationPolicy,
  type Locale,
} from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import {
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
    confirmedAt: instant('confirmed_at'),
    cancelledAt: instant('cancelled_at'),
    cancelledBy: text('cancelled_by').$type<BookingCanceller>(),
    /** Owed to the driver after a cancellation; paid out from Phase 4. */
    refundMinor: integer('refund_minor'),
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
    // Removing a space sets its bookings' space to null; without it, a scan per space.
    index('bookings_space_idx').on(t.spaceId),
    // One hold per driver at a time: a second press at once can't see the first's row, so this is
    // what refuses it (the service then lets the first go and holds again).
    uniqueIndex('bookings_one_hold_per_user_idx')
      .on(t.userId)
      .where(sql`${t.status} = 'held'`),
    // The worker's sweep of holds that ran out.
    index('bookings_hold_expiry_idx')
      .on(t.holdExpiresAt)
      .where(sql`${t.status} = 'held'`),
    // And its deletion of holds that never became bookings, a week on.
    index('bookings_stale_holds_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} in ('expired', 'released')`),
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
  ],
);
