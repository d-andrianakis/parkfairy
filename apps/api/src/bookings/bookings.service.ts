import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  addDays,
  bookingsCursor,
  BookingPaymentSchema,
  BookingSchema,
  BOOKINGS_PAGE_SIZE,
  BookingListSchema,
  HOLD_MAX_EXTENSIONS,
  HOLD_MINUTES,
  MAX_BOOKING_DAYS,
  NAME_MAX_LENGTH,
  normalizeVehiclePlate,
  OwnerListingBookingsSchema,
  parseBookingsCursor,
  type Booking,
  type BookingCancelInput,
  type BookingConfirmInput,
  type BookingPayment,
  type CheckoutKind,
  type BookingHoldInput,
  type BookingList,
  type BookingListQuery,
  type BookingsCursor,
  type Locale,
  type Money,
  type OwnerBookingsQuery,
  type OwnerListingBookings,
} from '@parkfairy/contracts';
import { schema, type Database, type OutboxBooking } from '@parkfairy/database';
import { and, asc, desc, eq, gt, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB } from '../database/database.module.js';
import { conflict, listingNotFound } from '../owner/owner.errors.js';
import { listingRulesIn, utcDay, type ListingRules, type Reader } from '../parking/listing-data.js';
import { isOpenThroughout } from '../parking/opening-hours.js';
import { NO_PRICE_RULES, quoteStayMinor } from '../parking/pricing.js';
import { PAYMENTS } from '../payments/payments.tokens.js';
import {
  PaymentProviderError,
  type PaymentState,
  type PaymentsGateway,
} from '../payments/stripe-gateway.js';
import { newBookingReference } from './booking-reference.js';
import { refundMinor } from './refunds.js';

const booking = schema.bookings;
const listing = schema.parkingLocations;
const space = schema.parkingSpaces;
const profile = schema.ownerProfiles;
const users = schema.users;
const outbox = schema.emailOutbox;
const payout = schema.payoutAccounts;
const settings = schema.platformSettings;

type BookingRow = typeof booking.$inferSelect;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type OutboxKind = typeof outbox.$inferInsert.kind;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/**
 * How many emails one driver's bookings may send one owner in 24 hours, a new booking and a
 * cancellation counting one each (L3). A driver booking and cancelling in a loop would otherwise
 * fill the owner's inbox; past this the bookings still show on the owner's page.
 */
export const OWNER_EMAILS_PER_DRIVER_DAY = 6;

/** What a booking shows of its listing. */
const listingInfo = {
  slug: listing.slug,
  name: listing.name,
  address: listing.address,
  contentLocale: listing.contentLocale,
  timeZone: listing.timeZone,
};
interface ListingInfo {
  slug: string;
  name: string | null;
  address: string | null;
  contentLocale: Locale;
  timeZone: string;
}

/** What a hold or confirmation reads of the listing, under its `FOR SHARE` lock. */
const bookableColumns = {
  ...listingInfo,
  id: listing.id,
  status: listing.status,
  hourlyRateMinor: listing.hourlyRateMinor,
  dailyMaxMinor: listing.dailyMaxMinor,
  currency: listing.currency,
  bookingGapMinutes: listing.bookingGapMinutes,
  cancellationPolicy: listing.cancellationPolicy,
  ownerUserId: profile.userId,
};

const published = sql`${listing.status} = 'published'`;

function notFound(code: 'LISTING_NOT_FOUND' | 'SPACE_NOT_FOUND' | 'BOOKING_NOT_FOUND') {
  return new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'Not Found', code });
}

/** A Postgres error by code and constraint, through Drizzle's wrapper. */
function violates(error: unknown, code: string, constraint: string): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const found = cause as { code?: string; constraint?: string };
  return found.code === code && found.constraint === constraint;
}

const money = (amountMinor: number, currency: string): Money => ({
  amountMinor,
  currency: currency as Money['currency'],
});

/**
 * The listing as it was when booked (L6): name, address and their language come from the booking,
 * so an owner's later edit, unreviewed on a listing sent back, never reaches the driver.
 */
function booked(row: BookingRow, info: ListingInfo): ListingInfo {
  return {
    ...info,
    name: row.listingName,
    address: row.listingAddress,
    contentLocale: row.listingLocale,
  };
}

/**
 * The booking as its driver reads it; `now` decides what cancelling would give back, `checkout`
 * how a hold becomes a booking here (paying, or the stand-in press of #33).
 */
function viewOf(row: BookingRow, info: ListingInfo, now: Date, checkout: CheckoutKind): Booking {
  const cancellable = row.status === 'confirmed' && row.startsAt > now;
  return BookingSchema.parse({
    id: row.id,
    reference: row.reference,
    status: row.status,
    listing: booked(row, info),
    spaceLabel: row.spaceLabel,
    start: row.startsAt.toISOString(),
    end: row.endsAt.toISOString(),
    total: money(row.totalMinor, row.currency),
    cancellationPolicy: row.cancellationPolicy,
    holdExpiresAt: row.holdExpiresAt.toISOString(),
    holdExtensionsLeft: Math.max(0, HOLD_MAX_EXTENSIONS - row.holdExtensions),
    vehiclePlate: row.vehiclePlate,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledBy: row.cancelledBy,
    refund: row.refundMinor === null ? null : money(row.refundMinor, row.currency),
    refundIfCancelled: cancellable
      ? money(
          refundMinor({
            policy: row.cancellationPolicy,
            totalMinor: row.totalMinor,
            start: row.startsAt,
            at: now,
            by: 'driver',
          }),
          row.currency,
        )
      : null,
    checkout,
    payment: row.paymentStatus,
  });
}

/** Stripe failed or was too slow: nothing was charged, and trying again may work. */
function providerFailed(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'PAYMENT_PROVIDER_ERROR',
    code: 'PAYMENT_PROVIDER_ERROR',
  });
}

/** What a paid booking's settling came to. */
type Settled = 'confirmed' | 'done' | 'refund' | 'ignore';

/** What the emails about a booking may say: no people's names, no plate. */
function outboxBooking(row: BookingRow, info: ListingInfo): OutboxBooking {
  return {
    id: row.id,
    listingId: row.locationId,
    reference: row.reference,
    address: row.listingAddress,
    contentLocale: row.listingLocale,
    spaceLabel: row.spaceLabel,
    start: row.startsAt.toISOString(),
    end: row.endsAt.toISOString(),
    timeZone: info.timeZone,
    totalMinor: row.totalMinor,
    currency: row.currency,
    ...(row.refundMinor === null ? {} : { refundMinor: row.refundMinor }),
    ...(row.cancelledBy === null ? {} : { cancelledBy: row.cancelledBy }),
  };
}

/**
 * Before a new hold, in one statement: lets go of the driver's other holds (one at a time, so one
 * account can't sit on many spaces; a press of Book twice lets the first go and takes the space
 * again), and marks other drivers' holds on the space whose time ran out, so the exclusion
 * constraint stops counting them. Those are `skip locked`: a hold that another transaction has in
 * hand is theirs to settle, and waiting on it could deadlock two drivers releasing each other's
 * spaces; such a row being let go meanwhile makes the insert wait for that transaction, not fail.
 * The driver's own are waited for, as a plain update would.
 */
async function clearForHold(tx: Transaction, userId: string, spaceId: string) {
  await tx.execute(sql`with released as (
      update ${booking} set status = 'released', updated_at = now()
      where user_id = ${userId} and status = 'held'
    )
    update ${booking} set status = 'expired', updated_at = now()
    where id in (select id from ${booking} where space_id = ${spaceId} and status = 'held'
      and hold_expires_at <= now() and user_id <> ${userId}
      for update skip locked)`);
}

/**
 * Bookings: a driver holds a space, confirms it, and may call it off; the listing's owner sees and
 * cancels the bookings of their listings. Every call starts from the session's user, and a booking
 * or listing that isn't theirs is the same 404 as one that doesn't exist.
 *
 * Whatever locks the listing does so before any booking: a hold and a confirmation take it
 * `FOR SHARE`, against the owner's hours saves, which take it for update. The cancels lock only the
 * booking, and nothing takes a listing after a booking, so there is no cycle; a cancel that comes to
 * need the listing (Phase 4 refunds) must take it first. Two drivers on one space are kept apart by
 * the exclusion constraint, never by a read: the second insert waits for the first and fails as
 * `SPACE_TAKEN`. One hold per driver is the same: a unique index, not the release before the insert.
 */
@Injectable()
export class BookingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Pick<Env, 'bookingWithoutPayment'>,
    @Inject(PAYMENTS) private readonly payments: PaymentsGateway | null,
  ) {}

  private view(row: BookingRow, info: ListingInfo, now = new Date()): Booking {
    return viewOf(row, info, now, this.payments ? 'payment' : 'confirm');
  }

  /** Holds work where the driver pays (Stripe), or on a local run without it (#33, #47). */
  private assertBooking() {
    if (!this.payments && !this.env.bookingWithoutPayment) throw conflict('BOOKING_UNAVAILABLE');
  }

  /** The stand-in press that charges nothing: a local run without Stripe only (#33, #47). */
  private assertStandIn() {
    // Never beside Stripe: where it is configured, every booking is paid for.
    if (this.payments || !this.env.bookingWithoutPayment) throw conflict('BOOKING_UNAVAILABLE');
  }

  /** Keeps a space for the driver for HOLD_MINUTES (decision #3). */
  async hold(userId: string, input: BookingHoldInput): Promise<Booking> {
    this.assertBooking();
    const stay = { start: new Date(input.start), end: new Date(input.end) };
    for (let tries = 1; ; tries++) {
      try {
        return await this.db.transaction((tx) => this.holdIn(tx, userId, input, stay));
      } catch (error) {
        if (violates(error, '23P01', 'bookings_space_no_overlap')) throw conflict('SPACE_TAKEN');
        // Two presses at once: the other's hold is committed now, so the next try lets it go.
        // 40 random bits make a repeated reference next to impossible, and as cheap to survive.
        const retry =
          violates(error, '23505', 'bookings_one_hold_per_user_idx') ||
          violates(error, '23505', 'bookings_reference_unique');
        if (tries < 3 && retry) continue;
        throw error;
      }
    }
  }

  private async holdIn(
    tx: Transaction,
    userId: string,
    input: BookingHoldInput,
    stay: { start: Date; end: Date },
  ): Promise<Booking> {
    // Four round trips and the insert, all under the listing's lock: the listing with the space,
    // its hours and prices, clearing the way, the hold.
    const [row] = await tx
      .select({
        ...bookableColumns,
        spot: { id: space.id, label: space.label, ownRate: space.hourlyRateMinor },
        payoutStatus: payout.status,
      })
      .from(listing)
      .leftJoin(profile, eq(profile.id, listing.ownerId))
      .leftJoin(payout, eq(payout.ownerId, listing.ownerId))
      .leftJoin(
        space,
        and(eq(space.id, input.spaceId), eq(space.locationId, listing.id), sql`${space.isActive}`),
      )
      .where(and(published, eq(listing.slug, input.listing)))
      .for('share', { of: listing });
    if (!row || row.hourlyRateMinor === null) throw notFound('LISTING_NOT_FOUND');
    // A booking of one's own would be a payout to oneself (Phase 4) and tells nobody anything.
    if (row.ownerUserId === userId) throw conflict('OWN_LISTING');
    // Paying needs somewhere for the owner's share to go (#5): their payout account, active.
    if (this.payments && row.payoutStatus !== 'active') throw conflict('BOOKING_UNAVAILABLE');
    const { spot } = row;
    if (!spot) throw notFound('SPACE_NOT_FOUND');
    const { prices } = await this.assertOpen(tx, row, stay, { prices: true });

    await clearForHold(tx, userId, spot.id);

    const totalMinor = quoteStayMinor({
      rates: { hourlyRateMinor: row.hourlyRateMinor, dailyMaxMinor: row.dailyMaxMinor },
      rules: prices ?? NO_PRICE_RULES,
      spaceRateMinor: spot.ownRate,
      start: stay.start,
      end: stay.end,
      timeZone: row.timeZone,
    });
    const [created] = await tx
      .insert(booking)
      .values({
        reference: newBookingReference(),
        userId,
        locationId: row.id,
        spaceId: spot.id,
        spaceLabel: spot.label,
        listingName: row.name,
        listingAddress: row.address,
        listingLocale: row.contentLocale,
        startsAt: stay.start,
        endsAt: stay.end,
        gapMinutes: row.bookingGapMinutes,
        blockedUntil: new Date(stay.end.getTime() + row.bookingGapMinutes * MINUTE_MS),
        status: 'held',
        // The database's clock, which every `hold_expires_at > now()` reads.
        holdExpiresAt: sql`now() + make_interval(mins => ${HOLD_MINUTES})`,
        totalMinor,
        currency: row.currency,
        // Every listing sent in has a policy; one without gets the driver's best terms.
        cancellationPolicy: row.cancellationPolicy ?? 'oneHour',
        // The rate now, kept with the booking (#15): in the insert, so no round trip more.
        commissionBps: sql`(select ${settings.commissionBps} from ${settings})`,
      })
      .returning();
    if (!created) throw new Error('Hold not inserted');
    return this.view(created, row);
  }

  /**
   * The listing is open for the whole stay, read under its lock in one statement, with its prices
   * when asked for (`listingRulesIn`).
   */
  private async assertOpen(
    tx: Transaction,
    row: { id: string; timeZone: string },
    { start, end }: { start: Date; end: Date },
    { prices = false }: { prices?: boolean } = {},
  ): Promise<ListingRules> {
    const rules = await listingRulesIn(
      tx,
      row.id,
      addDays(utcDay(start), -1),
      addDays(utcDay(end), 1),
      { prices },
    );
    if (!isOpenThroughout(rules.periods, start, end, row.timeZone, rules.exceptions)) {
      throw conflict('LISTING_CLOSED');
    }
    return rules;
  }

  /**
   * The driver's hold, under the listing's lock and then its own, checked as booking it needs: the
   * hold still runs (decision #37), the listing is live and open for the stay (the owner may have
   * closed that time since), the space is still there. A booking already confirmed comes back as
   * it is, unchecked.
   */
  private async lockHold(
    tx: Transaction,
    userId: string,
    id: string,
  ): Promise<{
    row: ListingInfo & { id: string; timeZone: string; ownerUserId: string | null };
    current: BookingRow;
  }> {
    // The listing first (its lock before the booking's), found through the driver's booking.
    const [row] = await tx
      .select(bookableColumns)
      .from(listing)
      .leftJoin(profile, eq(profile.id, listing.ownerId))
      .where(
        eq(
          listing.id,
          sql`(select ${booking.locationId} from ${booking} where ${booking.id} = ${id} and ${booking.userId} = ${userId})`,
        ),
      )
      .for('share', { of: listing });
    if (!row) throw notFound('BOOKING_NOT_FOUND');
    // With its space, if that is still there and in use.
    const [locked] = await tx
      .select({ current: booking, activeSpaceId: space.id })
      .from(booking)
      .leftJoin(space, and(eq(space.id, booking.spaceId), sql`${space.isActive}`))
      .where(and(eq(booking.id, id), eq(booking.userId, userId)))
      .for('update', { of: booking });
    if (!locked) throw notFound('BOOKING_NOT_FOUND');
    const { current } = locked;
    if (current.status === 'confirmed') return { row, current };
    // A hold that ran out, swept or not, books nothing: the space may be someone else's now.
    if (current.status !== 'held' || current.holdExpiresAt <= new Date()) {
      throw conflict('BOOKING_NOT_ACTIVE');
    }
    if (row.status !== 'published') throw conflict('LISTING_CLOSED');
    // Removed from a listing sent back to its owner, or taken out of use, since the hold.
    if (!current.spaceId || !locked.activeSpaceId) throw conflict('SPACE_TAKEN');
    await this.assertOpen(tx, row, { start: current.startsAt, end: current.endsAt });
    return { row, current };
  }

  /**
   * Turns the driver's hold into a booking without paying: the stand-in of a local run without
   * Stripe (#33, #47). Only while the hold runs (decision #37): after it, the driver chooses the
   * space again, and to have more time they keep the hold (`extend`). Asked again, a confirmed
   * booking answers as it is.
   */
  async confirm(userId: string, id: string, input: BookingConfirmInput): Promise<Booking> {
    this.assertStandIn();
    if (!UUID.test(id)) throw notFound('BOOKING_NOT_FOUND');
    const vehiclePlate = normalizeVehiclePlate(input.vehiclePlate);
    try {
      return await this.db.transaction(async (tx) => {
        const { row, current } = await this.lockHold(tx, userId, id);
        if (current.status === 'confirmed') return this.view(current, row);
        const now = new Date();
        const [confirmed] = await tx
          .update(booking)
          .set({ status: 'confirmed', vehiclePlate, confirmedAt: now })
          .where(eq(booking.id, id))
          .returning();
        if (!confirmed) throw notFound('BOOKING_NOT_FOUND');
        await this.queueConfirmedEmails(tx, confirmed, row);
        return this.view(confirmed, row, now);
      });
    } catch (error) {
      if (violates(error, '23P01', 'bookings_space_no_overlap')) throw conflict('SPACE_TAKEN');
      throw error;
    }
  }

  /** Both sides hear of a new booking: the driver, and the owner unless this driver used it up. */
  private async queueConfirmedEmails(
    tx: Transaction,
    confirmed: BookingRow,
    row: ListingInfo & { ownerUserId: string | null },
  ): Promise<void> {
    const driver = confirmed.userId;
    const owner = row.ownerUserId;
    await this.queueEmails(tx, confirmed, row, [
      { kind: 'booking-confirmed', userId: driver, to: 'driver' },
      ...(owner && (await this.ownerStillHears(tx, driver, owner))
        ? [{ kind: 'booking-received' as const, userId: owner, to: 'owner' as const }]
        : []),
    ]);
  }

  /**
   * Starts paying for a held space (Phase 4, #49): the plate is kept, and the booking's one
   * PaymentIntent made, or found again, for the Payment Element. Only while the hold runs, as the
   * stand-in Confirm (#37). The booking is confirmed when Stripe says the money is in
   * (`settlePayment`), whenever that is (#3).
   */
  async pay(userId: string, id: string, input: BookingConfirmInput): Promise<BookingPayment> {
    const gateway = this.payments;
    if (!gateway) throw conflict('BOOKING_UNAVAILABLE');
    if (!UUID.test(id)) throw notFound('BOOKING_NOT_FOUND');
    const vehiclePlate = normalizeVehiclePlate(input.vehiclePlate);
    const held = await this.db.transaction(async (tx) => {
      const { current } = await this.lockHold(tx, userId, id);
      // Booked already: nothing is left to pay.
      if (current.status === 'confirmed') throw conflict('BOOKING_NOT_ACTIVE');
      // Paying takes minutes (a card typed, a bank's check): a hold with less than half its time
      // left is kept for a full HOLD_MINUTES again, as one of its extensions (decision #37), so
      // the time limit doesn't fall in the middle of paying (WCAG 2.2.1).
      const low =
        current.holdExpiresAt.getTime() - Date.now() < (HOLD_MINUTES * MINUTE_MS) / 2 &&
        current.holdExtensions < HOLD_MAX_EXTENSIONS;
      const [kept] = await tx
        .update(booking)
        .set({
          vehiclePlate,
          ...(low
            ? {
                holdExpiresAt: sql`now() + make_interval(mins => ${HOLD_MINUTES})`,
                holdExtensions: current.holdExtensions + 1,
              }
            : {}),
        })
        .where(eq(booking.id, id))
        .returning();
      if (!kept) throw notFound('BOOKING_NOT_FOUND');
      return kept;
    });
    // Stripe outside the locks: its answer can take a second, and the owner's saves wait on them.
    let state: PaymentState;
    try {
      state = held.paymentIntentId
        ? await gateway.payment(held.paymentIntentId)
        : await gateway.createPayment({
            bookingId: held.id,
            reference: held.reference,
            amountMinor: held.totalMinor,
            currency: held.currency,
          });
    } catch (error) {
      if (error instanceof PaymentProviderError) throw providerFailed();
      throw error;
    }
    if (!held.paymentIntentId) {
      // Two presses at once made one PaymentIntent (the idempotency key): the first write stands.
      await this.db
        .update(booking)
        .set({ paymentIntentId: state.id, paymentStatus: state.status })
        .where(and(eq(booking.id, held.id), isNull(booking.paymentIntentId)));
    }
    return BookingPaymentSchema.parse({ clientSecret: state.clientSecret, status: state.status });
  }

  /**
   * The driver's page asks how their payment went, after paying or coming back from their bank:
   * the booking brought in line with Stripe (`settlePayment`), without waiting for the webhook.
   */
  async settle(userId: string, id: string): Promise<Booking> {
    if (!this.payments) throw conflict('BOOKING_UNAVAILABLE');
    if (!UUID.test(id)) throw notFound('BOOKING_NOT_FOUND');
    const [mine] = await this.db
      .select({
        paymentIntentId: booking.paymentIntentId,
        paymentStatus: booking.paymentStatus,
        confirmedAt: booking.confirmedAt,
      })
      .from(booking)
      .where(and(eq(booking.id, id), eq(booking.userId, userId)));
    if (!mine) throw notFound('BOOKING_NOT_FOUND');
    // Settled for good (booked and paid, or refunded): nothing Stripe says would change it, and
    // a page asking again and again mustn't spend the platform's Stripe rate limit.
    const settled =
      mine.paymentStatus === 'refunded' ||
      (mine.confirmedAt !== null && mine.paymentStatus === 'succeeded');
    if (mine.paymentIntentId && !settled) {
      try {
        await this.settlePayment(mine.paymentIntentId);
      } catch (error) {
        if (error instanceof PaymentProviderError) throw providerFailed();
        throw error;
      }
    }
    return this.get(userId, id);
  }

  /**
   * Brings a booking in line with its payment as Stripe has it, from a webhook or the driver's
   * page. Safe to repeat, and to run twice at once: the booking's lock takes turns, and Stripe's
   * refund has an idempotency key. Paid for a hold never booked, it becomes a booking if it still
   * can, a late payment included while the space is free (#3); if it can't (the space taken, the
   * stay begun, the listing closed, the hold let go, the money not all there), all of it goes back.
   * A booking made once (confirmed, cancelled since) keeps its money: its refunds are its
   * cancellation's, by its policy, never this.
   */
  async settlePayment(paymentIntentId: string): Promise<void> {
    const gateway = this.payments;
    if (!gateway) return;
    const state = await gateway.payment(paymentIntentId);
    // Another app's payment on the same Stripe account is none of ours.
    if (!state.bookingId || !UUID.test(state.bookingId)) return;
    const mine = or(
      eq(booking.paymentIntentId, state.id),
      and(eq(booking.id, state.bookingId), isNull(booking.paymentIntentId)),
    );
    if (state.status !== 'succeeded') {
      await this.db
        .update(booking)
        .set({ paymentIntentId: state.id, paymentStatus: state.status })
        .where(
          and(
            mine,
            or(
              isNull(booking.paymentStatus),
              sql`${booking.paymentStatus} in ('pending', 'processing')`,
            ),
            // The same word again changes nothing, and writes nothing.
            sql`${booking.paymentStatus} is distinct from ${state.status}`,
          ),
        );
      return;
    }
    const settled = await this.confirmPaid(state, mine);
    if (settled !== 'refund') return;
    // Decided and recorded under the booking's lock (`refunding`) before Stripe is asked: a failure
    // here is finished by the next look (Stripe retries its webhook), as one refund. Refunded at
    // Stripe already (our write lost after its answer, perhaps past its idempotency key's day):
    // only the record is left to make, and asking again would be refused.
    const refundedAlready = state.receivedMinor > 0 && state.refundedMinor >= state.receivedMinor;
    if (!refundedAlready) await gateway.refundPayment(state.id, 'not_bookable');
    await this.db
      .update(booking)
      .set({ paymentStatus: 'refunded' })
      .where(and(eq(booking.paymentIntentId, state.id), eq(booking.paymentStatus, 'refunding')));
  }

  /**
   * The paid hold made a booking, under the listing's lock and the booking's, or the refund
   * recorded (`refunding`) in the same turn of the lock, so nothing can confirm it in between.
   */
  private async confirmPaid(state: PaymentState, mine: SQL | undefined): Promise<Settled> {
    return this.db.transaction(async (tx): Promise<Settled> => {
      const [row] = await tx
        .select(bookableColumns)
        .from(listing)
        .leftJoin(profile, eq(profile.id, listing.ownerId))
        .where(eq(listing.id, sql`(select ${booking.locationId} from ${booking} where ${mine})`))
        .for('share', { of: listing });
      // A booking this database doesn't have: another environment's on the same Stripe account
      // (staging and a local run), not ours to refund. Ours are never deleted once paid for.
      if (!row) return 'ignore';
      const [locked] = await tx
        .select({ current: booking, activeSpaceId: space.id })
        .from(booking)
        .leftJoin(space, and(eq(space.id, booking.spaceId), sql`${space.isActive}`))
        .where(mine)
        .for('update', { of: booking });
      if (!locked) return 'ignore';
      const { current } = locked;
      // A refund decided already: finish it if it failed half way; done, nothing more.
      if (current.paymentStatus === 'refunding') return 'refund';
      if (current.paymentStatus === 'refunded') return 'done';
      // Booked once: the money is the booking's, whatever happened to it since.
      if (current.confirmedAt !== null) {
        if (current.paymentStatus !== 'succeeded') {
          await tx
            .update(booking)
            .set({ paymentIntentId: state.id, paymentStatus: 'succeeded' })
            .where(eq(booking.id, current.id));
        }
        return 'done';
      }
      const now = new Date();
      const bookable =
        (current.status === 'held' || current.status === 'expired') &&
        // All of it in, none of it back: Stripe's word, not the event's.
        state.amountMinor === current.totalMinor &&
        state.receivedMinor === current.totalMinor &&
        state.refundedMinor === 0 &&
        state.currency === current.currency &&
        // A stay begun or over can't be booked now: a late payment for it goes back.
        current.startsAt > now &&
        row.status === 'published' &&
        current.spaceId !== null &&
        locked.activeSpaceId !== null &&
        current.vehiclePlate !== null;
      if (bookable && (await this.isOpen(tx, row, current))) {
        try {
          // A savepoint: a clash rolls back this update alone, and the refund is recorded below.
          const confirmed = await tx.transaction(async (point) => {
            const [made] = await point
              .update(booking)
              .set({
                status: 'confirmed',
                confirmedAt: now,
                paymentIntentId: state.id,
                paymentStatus: 'succeeded',
              })
              .where(eq(booking.id, current.id))
              .returning();
            return made;
          });
          if (confirmed) {
            await this.queueConfirmedEmails(tx, confirmed, row);
            return 'confirmed';
          }
        } catch (error) {
          // An expired hold taken back: someone else has the space now (#3).
          if (!violates(error, '23P01', 'bookings_space_no_overlap')) throw error;
        }
      }
      // A hold still running is let go; the plate was only ever for a booking.
      const [refunding] = await tx
        .update(booking)
        .set({
          paymentIntentId: state.id,
          paymentStatus: 'refunding',
          vehiclePlate: null,
          status: sql`case when ${booking.status} = 'held' then 'released' else ${booking.status} end`,
        })
        .where(eq(booking.id, current.id))
        .returning();
      // The driver may have left the page: they hear of it, as of a booking.
      if (refunding) {
        await this.queueEmails(
          tx,
          refunding,
          row,
          [{ kind: 'booking-payment-refunded', userId: current.userId, to: 'driver' }],
          'refunded',
        );
      }
      return 'refund';
    });
  }

  /** Open for the whole stay, or not; anything but the listing's answer is thrown on. */
  private async isOpen(
    tx: Transaction,
    row: { id: string; timeZone: string },
    { startsAt, endsAt }: { startsAt: Date; endsAt: Date },
  ): Promise<boolean> {
    try {
      await this.assertOpen(tx, row, { start: startsAt, end: endsAt });
      return true;
    } catch (error) {
      if (error instanceof ConflictException) return false;
      throw error;
    }
  }

  /**
   * Keeps a running hold for another HOLD_MINUTES from now, so the time limit can be extended
   * (WCAG 2.2.1), up to HOLD_MAX_EXTENSIONS times (`HOLD_LIMIT_REACHED` after). A hold that ran out
   * can't be kept: the space may be someone else's. The space was the driver's all along, so the
   * exclusion constraint has nothing new to check but the gap after the end, which doesn't move.
   */
  async extend(userId: string, id: string): Promise<Booking> {
    this.assertBooking();
    if (!UUID.test(id)) throw notFound('BOOKING_NOT_FOUND');
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(booking)
        .where(and(eq(booking.id, id), eq(booking.userId, userId)))
        .for('update');
      if (!current) throw notFound('BOOKING_NOT_FOUND');
      if (current.status === 'confirmed')
        return this.view(current, await this.listingOf(tx, current.locationId));
      if (current.status !== 'held' || current.holdExpiresAt <= new Date()) {
        throw conflict('BOOKING_NOT_ACTIVE');
      }
      if (current.holdExtensions >= HOLD_MAX_EXTENSIONS) throw conflict('HOLD_LIMIT_REACHED');
      const [kept] = await tx
        .update(booking)
        .set({
          holdExpiresAt: sql`now() + make_interval(mins => ${HOLD_MINUTES})`,
          holdExtensions: current.holdExtensions + 1,
        })
        .where(eq(booking.id, id))
        .returning();
      if (!kept) throw notFound('BOOKING_NOT_FOUND');
      return this.view(kept, await this.listingOf(tx, kept.locationId));
    });
  }

  /**
   * The driver lets a hold go, or calls off a booking that hasn't started, with the refund its
   * policy gives (#16). Asked again, a booking already settled answers as it is. A refund lower
   * than the one the driver was shown (the start came nearer meanwhile) is refused, not applied.
   */
  async cancel(
    userId: string,
    id: string,
    { expectedRefundMinor }: BookingCancelInput = {},
  ): Promise<Booking> {
    if (!UUID.test(id)) throw notFound('BOOKING_NOT_FOUND');
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(booking)
        .where(and(eq(booking.id, id), eq(booking.userId, userId)))
        .for('update');
      if (!current) throw notFound('BOOKING_NOT_FOUND');
      const info = await this.listingOf(tx, current.locationId);
      const now = new Date();
      if (current.status === 'held') {
        const [released] = await tx
          .update(booking)
          .set({ status: 'released' })
          .where(eq(booking.id, id))
          .returning();
        return this.view(released ?? current, info, now);
      }
      if (current.status !== 'confirmed') return this.view(current, info, now);
      if (current.startsAt <= now) throw conflict('BOOKING_STARTED');
      const refund = refundMinor({
        policy: current.cancellationPolicy,
        totalMinor: current.totalMinor,
        start: current.startsAt,
        at: now,
        by: 'driver',
      });
      if (expectedRefundMinor !== undefined && refund < expectedRefundMinor) {
        throw conflict('REFUND_CHANGED', { refund: money(refund, current.currency) });
      }

      const [cancelled] = await tx
        .update(booking)
        .set({ status: 'cancelled', cancelledAt: now, cancelledBy: 'driver', refundMinor: refund })
        .where(eq(booking.id, id))
        .returning();
      if (!cancelled) throw notFound('BOOKING_NOT_FOUND');
      const ownerUserId = await this.ownerUserOf(tx, current.locationId);
      await this.queueEmails(tx, cancelled, info, [
        { kind: 'booking-cancelled', userId, to: 'driver' },
        ...(ownerUserId && (await this.ownerStillHears(tx, userId, ownerUserId))
          ? [
              {
                kind: 'booking-cancelled-by-driver' as const,
                userId: ownerUserId,
                to: 'owner' as const,
              },
            ]
          : []),
      ]);
      return this.view(cancelled, info, now);
    });
  }

  async get(userId: string, id: string): Promise<Booking> {
    if (!UUID.test(id)) throw notFound('BOOKING_NOT_FOUND');
    const [row] = await this.db
      .select({ booking, info: listingInfo })
      .from(booking)
      .innerJoin(listing, eq(listing.id, booking.locationId))
      .where(and(eq(booking.id, id), eq(booking.userId, userId)));
    if (!row) throw notFound('BOOKING_NOT_FOUND');
    return this.view(row.booking, row.info);
  }

  /**
   * The driver's bookings a page at a time: upcoming soonest first (holds still running among
   * them), past latest first. Holds that lapsed or were let go are nobody's history.
   */
  async list(userId: string, { when, page }: BookingListQuery): Promise<BookingList> {
    const now = new Date();
    const upcoming = when === 'upcoming';
    const filter: SQL | undefined = upcoming
      ? or(
          and(eq(booking.status, 'confirmed'), gt(booking.endsAt, now)),
          and(eq(booking.status, 'held'), gt(booking.holdExpiresAt, now)),
        )
      : or(
          and(eq(booking.status, 'confirmed'), lte(booking.endsAt, now)),
          eq(booking.status, 'cancelled'),
        );
    const rows = await this.db
      .select({ booking, info: listingInfo })
      .from(booking)
      .innerJoin(listing, eq(listing.id, booking.locationId))
      .where(and(eq(booking.userId, userId), filter))
      .orderBy(
        ...(upcoming
          ? [asc(booking.startsAt), asc(booking.id)]
          : [desc(booking.startsAt), desc(booking.id)]),
      )
      .limit(BOOKINGS_PAGE_SIZE + 1)
      .offset((page - 1) * BOOKINGS_PAGE_SIZE);
    return BookingListSchema.parse({
      bookings: rows
        .slice(0, BOOKINGS_PAGE_SIZE)
        .map((row) => this.view(row.booking, row.info, now)),
      page,
      hasMore: rows.length > BOOKINGS_PAGE_SIZE,
    });
  }

  /**
   * A listing's confirmed bookings that haven't ended, soonest first, with who is coming in which
   * car (decision #35). Only to the listing's owner. A page at a time from a place in the list
   * (`after` or `before` a booking's start and id, keyset paging), so a page late in a busy
   * garage's year reads what the first one does, on `bookings_location_starts_id_idx`.
   */
  async listingBookings(
    userId: string,
    listingId: string,
    { after, before }: OwnerBookingsQuery,
  ): Promise<OwnerListingBookings> {
    const owned = await this.ownedListing(userId, listingId);
    const now = new Date();
    const from = after ? parseBookingsCursor(after) : null;
    const to = before ? parseBookingsCursor(before) : null;
    const showing = and(
      eq(booking.locationId, owned.id),
      eq(booking.status, 'confirmed'),
      gt(booking.endsAt, now),
      // Implied by the line above (a stay lasts 30 days at most), and what keeps the index
      // from reading every booking the listing ever had.
      gt(booking.startsAt, new Date(now.getTime() - (MAX_BOOKING_DAYS + 1) * DAY_MS)),
    );
    // The place compares as a pair, and Postgres takes the bound on the start from it for the
    // index. Don't add that bound by hand: estimated apart, the two looked so selective that deep
    // pages read and sorted every booking left (performance review, 182k on one listing).
    const pair = sql`(${booking.startsAt}, ${booking.id})`;
    const at = ({ start, id }: BookingsCursor) =>
      sql`(${start.toISOString()}::timestamptz, ${id}::uuid)`;
    const later = (place: BookingsCursor, orAt: boolean) =>
      orAt ? sql`${pair} >= ${at(place)}` : sql`${pair} > ${at(place)}`;
    const earlier = (place: BookingsCursor, orAt: boolean) =>
      orAt ? sql`${pair} <= ${at(place)}` : sql`${pair} < ${at(place)}`;
    const backwards = to !== null;
    const [found, beyond] = await Promise.all([
      this.db
        .select({
          id: booking.id,
          reference: booking.reference,
          spaceLabel: booking.spaceLabel,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          // Names change after sign-up too; whatever the account holds, the owner gets the limit.
          driverName: sql<string>`left(${users.name}, ${NAME_MAX_LENGTH})`,
          vehiclePlate: booking.vehiclePlate,
          totalMinor: booking.totalMinor,
          currency: booking.currency,
        })
        .from(booking)
        .innerJoin(users, eq(users.id, booking.userId))
        .where(
          and(showing, from ? later(from, false) : undefined, to ? earlier(to, false) : undefined),
        )
        .orderBy(
          ...(backwards
            ? [desc(booking.startsAt), desc(booking.id)]
            : [asc(booking.startsAt), asc(booking.id)]),
        )
        .limit(BOOKINGS_PAGE_SIZE + 1),
      // Is there a page on the side we came from? Bookings there may have ended or been called off.
      // Ordered from the place outwards: unordered, `limit 1` past ~1% of the table was planned as
      // a scan of all of `bookings`.
      from || to
        ? this.db
            .select({ id: booking.id })
            .from(booking)
            .where(
              and(
                showing,
                from ? earlier(from, true) : undefined,
                to ? later(to, true) : undefined,
              ),
            )
            .orderBy(
              ...(from
                ? [desc(booking.startsAt), desc(booking.id)]
                : [asc(booking.startsAt), asc(booking.id)]),
            )
            .limit(1)
        : Promise.resolve([]),
    ]);
    const more = found.length > BOOKINGS_PAGE_SIZE;
    const rows = found.slice(0, BOOKINGS_PAGE_SIZE);
    if (backwards) rows.reverse();
    const first = rows[0];
    const last = rows.at(-1);
    const place = (row: { startsAt: Date; id: string } | undefined) =>
      row ? bookingsCursor({ start: row.startsAt, id: row.id }) : null;
    return OwnerListingBookingsSchema.parse({
      ...owned,
      bookings: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        spaceLabel: row.spaceLabel,
        start: row.startsAt.toISOString(),
        end: row.endsAt.toISOString(),
        driverName: row.driverName,
        // A confirmed booking always has one (`bookings_confirmed_check`).
        vehiclePlate: row.vehiclePlate ?? '',
        total: money(row.totalMinor, row.currency),
        cancellable: row.startsAt > now,
      })),
      previous: (backwards ? more : beyond.length > 0) ? place(first) : null,
      next: (backwards ? beyond.length > 0 : more) ? place(last) : null,
    });
  }

  /**
   * The owner calls off a booking that hasn't started, the driver refunded in full: what closing
   * that time takes first (decision #27). Asked again, it is already done.
   */
  async cancelForOwner(userId: string, listingId: string, bookingId: string): Promise<void> {
    const owned = await this.ownedListing(userId, listingId);
    if (!UUID.test(bookingId)) throw notFound('BOOKING_NOT_FOUND');
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(booking)
        .where(and(eq(booking.id, bookingId), eq(booking.locationId, owned.id)))
        .for('update');
      if (!current) throw notFound('BOOKING_NOT_FOUND');
      if (current.status === 'cancelled') return;
      if (current.status !== 'confirmed') throw notFound('BOOKING_NOT_FOUND');
      const now = new Date();
      if (current.startsAt <= now) throw conflict('BOOKING_STARTED');
      const [cancelled] = await tx
        .update(booking)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: 'owner',
          refundMinor: current.totalMinor,
        })
        .where(eq(booking.id, bookingId))
        .returning();
      if (!cancelled) throw notFound('BOOKING_NOT_FOUND');
      await this.queueEmails(tx, cancelled, await this.listingOf(tx, owned.id), [
        { kind: 'booking-cancelled', userId: current.userId, to: 'driver' },
      ]);
    });
  }

  /** The listing, if this user owns it; anything else is the same 404. */
  private async ownedListing(userId: string, listingId: string) {
    if (!UUID.test(listingId)) throw listingNotFound();
    const [owned] = await this.db
      .select({ id: listing.id, name: listing.name, contentLocale: listing.contentLocale })
      .from(listing)
      .innerJoin(profile, eq(profile.id, listing.ownerId))
      .where(and(eq(listing.id, listingId), eq(profile.userId, userId)));
    if (!owned) throw listingNotFound();
    return owned;
  }

  private async listingOf(db: Reader, locationId: string): Promise<ListingInfo> {
    const [info] = await db.select(listingInfo).from(listing).where(eq(listing.id, locationId));
    if (!info) throw notFound('BOOKING_NOT_FOUND');
    return info;
  }

  /**
   * Whether this driver's bookings may still email this owner today (L3): the confirmations and
   * driver's cancellations of the last 24 hours at any of the owner's listings, the one being
   * written included, against OWNER_EMAILS_PER_DRIVER_DAY. Read on the driver's own bookings
   * (`bookings_user_starts_idx`), which are few. Two at once may both pass: a cap, not a count.
   */
  private async ownerStillHears(tx: Transaction, driverId: string, ownerUserId: string) {
    const since = new Date(Date.now() - DAY_MS);
    const [row] = await tx
      .select({
        events: sql<number>`(count(*) filter (where ${booking.confirmedAt} > ${since})
          + count(*) filter (where ${booking.cancelledBy} = 'driver' and ${booking.cancelledAt} > ${since}))::int`,
      })
      .from(booking)
      .innerJoin(listing, eq(listing.id, booking.locationId))
      .innerJoin(profile, eq(profile.id, listing.ownerId))
      .where(
        and(
          eq(booking.userId, driverId),
          eq(profile.userId, ownerUserId),
          // Only rows with an event in the window (a cancellation comes after its confirmation),
          // so neither a long history nor a week of holds is read under the locks.
          sql`coalesce(${booking.cancelledAt}, ${booking.confirmedAt}) > ${since}`,
        ),
      );
    return (row?.events ?? 0) <= OWNER_EMAILS_PER_DRIVER_DAY;
  }

  private async ownerUserOf(db: Reader, locationId: string): Promise<string | null> {
    const [row] = await db
      .select({ userId: profile.userId })
      .from(listing)
      .innerJoin(profile, eq(profile.id, listing.ownerId))
      .where(eq(listing.id, locationId));
    return row?.userId ?? null;
  }

  /**
   * Emails about the change, in the transaction that made it (the outbox): none is lost to a crash,
   * none goes for something that rolled back. One per booking, event and reader, however often the
   * same request comes.
   */
  private async queueEmails(
    tx: Transaction,
    row: BookingRow,
    info: ListingInfo,
    emails: { kind: OutboxKind; userId: string; to: 'driver' | 'owner' }[],
    event: 'confirmed' | 'cancelled' | 'refunded' = row.status === 'cancelled'
      ? 'cancelled'
      : 'confirmed',
  ) {
    if (emails.length === 0) return;
    await tx
      .insert(outbox)
      .values(
        emails.map(({ kind, userId, to }) => ({
          kind,
          userId,
          payload: { listingName: row.listingName ?? undefined, booking: outboxBooking(row, info) },
          dedupeKey: `booking:${row.id}:${event}:${to}`,
        })),
      )
      .onConflictDoNothing({ target: outbox.dedupeKey });
  }
}
