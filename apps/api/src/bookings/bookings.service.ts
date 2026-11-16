import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
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
import {
  copyPayees,
  enterCharge,
  heldByDispute,
  ownedByUser,
  runsListing,
  payableListing,
  recordCancelRefund,
  recordRefundFailed,
  recordUnbookedRefund,
  schema,
  type Database,
  type OutboxBooking,
} from '@parkfairy/database';
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB } from '../database/database.module.js';
import { conflict, listingNotFound } from '../owner/owner.errors.js';
import { listingRulesIn, utcDay, type ListingRules, type Reader } from '../parking/listing-data.js';
import { isOpenThroughout } from '../parking/opening-hours.js';
import { NO_PRICE_RULES, quoteStayMinor } from '../parking/pricing.js';
import { PAYMENTS } from '../payments/payments.tokens.js';
import { PaymentProviderError, type PaymentState, type PaymentsGateway } from '@parkfairy/payments';
import { newBookingReference } from './booking-reference.js';
import { refundMinor } from './refunds.js';

const booking = schema.bookings;
const listing = schema.parkingLocations;
const space = schema.parkingSpaces;
const profile = schema.ownerProfiles;
const users = schema.users;
const outbox = schema.emailOutbox;
/** How many bookings one statement calls off when staff suspend a listing. */
const CANCEL_CHUNK = 400;
const owners = schema.listingOwners;
const managers = schema.listingManagers;
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

/** What came in, for the ledger: Stripe's word on the amount, and the charge that took it. */
const charged = (state: PaymentState) => ({
  amountMinor: state.receivedMinor,
  chargeId: state.chargeId,
});

/** A cancellation owes a refund at Stripe when the booking was paid there and some goes back. */
const owesRefund = (row: BookingRow, refund: number) =>
  row.paymentStatus === 'succeeded' && refund > 0 ? ('owed' as const) : null;

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
  private readonly logger = new Logger(BookingsService.name);

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
        // Co-ownership (#54): every owner with a share can be paid; this driver isn't one.
        payable: sql<boolean>`${payableListing}`,
        mine: sql<boolean>`${ownedByUser(userId)}`,
      })
      .from(listing)
      .leftJoin(profile, eq(profile.id, listing.ownerId))
      .leftJoin(
        space,
        and(eq(space.id, input.spaceId), eq(space.locationId, listing.id), sql`${space.isActive}`),
      )
      .where(and(published, eq(listing.slug, input.listing)))
      .for('share', { of: listing });
    if (!row || row.hourlyRateMinor === null) throw notFound('LISTING_NOT_FOUND');
    // A booking of one's own would be a payout to oneself (Phase 4) and tells nobody anything.
    if (row.mine) throw conflict('OWN_LISTING');
    // Paying needs somewhere for the owners' share to go (#5, #54): each one's account, active.
    if (this.payments && !row.payable) throw conflict('BOOKING_UNAVAILABLE');
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

  /**
   * A booking made, in the transaction that made it. Who is paid for it is kept with it, as the
   * owners' shares are now (#54), as its commission was at the hold (#15): a hold that never books
   * keeps none, and goes like any lapsed hold. Then both sides hear of it: the driver, and each of
   * the listing's owners unless this driver used them up.
   */
  private async queueConfirmedEmails(
    tx: Transaction,
    confirmed: BookingRow,
    row: ListingInfo,
  ): Promise<void> {
    await copyPayees(tx, confirmed.id, confirmed.locationId);
    const driver = confirmed.userId;
    await this.queueEmails(tx, confirmed, row, [
      { kind: 'booking-confirmed', userId: driver, to: 'driver' },
      ...(await this.ownersHearing(tx, driver, confirmed.locationId, 'booking-received')),
    ]);
  }

  /** The listing's owners this driver may still email today (L3), every one of them (#53). */
  private async ownersHearing<Kind extends 'booking-received' | 'booking-cancelled-by-driver'>(
    tx: Transaction,
    driverId: string,
    locationId: string,
    kind: Kind,
  ): Promise<{ kind: Kind; userId: string; to: 'owner' }[]> {
    const accounts = (await this.ownerUsersOf(tx, locationId)).filter((id) => id !== driverId);
    const events = await this.driverEmailsToOwners(tx, driverId, accounts);
    return accounts
      .filter((userId) => (events.get(userId) ?? 0) <= OWNER_EMAILS_PER_DRIVER_DAY)
      .map((userId) => ({ kind, userId, to: 'owner' as const }));
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
        .set({
          paymentIntentId: state.id,
          paymentStatus: state.status,
          // Called off: it can't be paid now, and the plate was only ever for a booking.
          ...(state.status === 'canceled' ? { vehiclePlate: null } : {}),
        })
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
    // All it received went back (the ledger's refund, against its charge).
    await recordUnbookedRefund(this.db, state.id, state.receivedMinor);
  }

  /**
   * A refund Stripe says changed. One that failed after Stripe took it (a closed card, say) is
   * taken out of the ledger, a cancellation's marked `failed`, and support told: asking again would
   * fail the same way, and the driver is owed it. Anything else changes nothing; another app's
   * refund is none of ours.
   */
  async settleRefund(refundId: string): Promise<void> {
    const gateway = this.payments;
    if (!gateway) return;
    const refund = await gateway.refund(refundId);
    if (refund.status !== 'failed' && refund.status !== 'canceled') return;
    const bookingId = await recordRefundFailed(this.db, {
      refundId: refund.id,
      paymentIntentId: refund.paymentIntentId,
      reason: refund.reason,
    });
    if (bookingId) {
      this.logger.error(
        { bookingId, refundId, status: refund.status, reason: refund.reason },
        'refund failed at Stripe',
      );
    }
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
        if (current.paymentStatus !== 'succeeded' || current.stripeChargeId === null) {
          await tx
            .update(booking)
            .set({
              paymentIntentId: state.id,
              paymentStatus: 'succeeded',
              stripeChargeId: current.stripeChargeId ?? state.chargeId,
            })
            .where(eq(booking.id, current.id));
          await enterCharge(tx, current, charged(state));
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
                stripeChargeId: state.chargeId,
              })
              .where(eq(booking.id, current.id))
              .returning();
            return made;
          });
          if (confirmed) {
            await enterCharge(tx, confirmed, charged(state));
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
          stripeChargeId: state.chargeId,
          vehiclePlate: null,
          status: sql`case when ${booking.status} = 'held' then 'released' else ${booking.status} end`,
        })
        .where(eq(booking.id, current.id))
        .returning();
      // The driver may have left the page: they hear of it, as of a booking.
      if (refunding) {
        // The money came in before it goes back: the ledger has both.
        await enterCharge(tx, refunding, charged(state));
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
    const { view, owed } = await this.db.transaction(async (tx) => {
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
        return { view: this.view(released ?? current, info, now), owed: null };
      }
      if (current.status !== 'confirmed') {
        return { view: this.view(current, info, now), owed: null };
      }
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
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: 'driver',
          refundMinor: refund,
          refundStatus: owesRefund(current, refund),
        })
        .where(eq(booking.id, id))
        .returning();
      if (!cancelled) throw notFound('BOOKING_NOT_FOUND');
      await this.queueEmails(tx, cancelled, info, [
        { kind: 'booking-cancelled', userId, to: 'driver' },
        ...(await this.ownersHearing(
          tx,
          userId,
          current.locationId,
          'booking-cancelled-by-driver',
        )),
      ]);
      return { view: this.view(cancelled, info, now), owed: cancelled };
    });
    await this.sendCancelRefund(owed);
    return view;
  }

  /**
   * A cancellation's refund, recorded `owed` with the cancel and asked of Stripe once that has
   * committed, never under the booking's lock. The cancellation stands either way: a failure
   * leaves the refund owed, and the worker sends it (Stripe's idempotency key makes it the same
   * refund, should this one have reached Stripe after all).
   */
  private async sendCancelRefund(row: BookingRow | null): Promise<void> {
    const gateway = this.payments;
    if (!gateway || row?.refundStatus !== 'owed' || !row.paymentIntentId || !row.refundMinor) {
      return;
    }
    try {
      // One short try while the driver waits: past it, the worker sends it (the same refund).
      const refundId = await gateway.refundCancelled(
        { paymentIntentId: row.paymentIntentId, bookingId: row.id, amountMinor: row.refundMinor },
        { quick: true },
      );
      await recordCancelRefund(this.db, row.id, refundId);
    } catch (error) {
      // Its type and code only: Stripe's message can name the driver.
      const detail =
        error instanceof PaymentProviderError
          ? error.detail
          : error instanceof Error
            ? error.name
            : 'unknown';
      this.logger.warn({ bookingId: row.id, detail }, 'cancellation refund left for the worker');
    }
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
    const owed = await this.db.transaction(async (tx) => {
      // The listing's lock first (before the booking's, as every path takes them), then whether
      // this is still one of its owners, read after it: one statement would join the owners as
      // they were before the wait, and an owner removed meanwhile would still cancel.
      await tx
        .select({ id: listing.id })
        .from(listing)
        .where(eq(listing.id, owned.id))
        .for('share');
      const [still] = await tx
        .select({ id: owners.id, role: owners.role })
        .from(owners)
        .innerJoin(profile, eq(profile.id, owners.ownerId))
        .where(and(eq(owners.locationId, owned.id), eq(profile.userId, userId)));
      // A manager too (#69), the same way: read after the lock.
      const [managing] = still
        ? [true]
        : await tx
            .select({ id: managers.id })
            .from(managers)
            .where(and(eq(managers.locationId, owned.id), eq(managers.userId, userId)));
      if (!still && !managing) throw listingNotFound();
      const [current] = await tx
        .select()
        .from(booking)
        .where(and(eq(booking.id, bookingId), eq(booking.locationId, owned.id)))
        .for('update');
      if (!current) throw notFound('BOOKING_NOT_FOUND');
      if (current.status === 'cancelled') return null;
      if (current.status !== 'confirmed') throw notFound('BOOKING_NOT_FOUND');
      const now = new Date();
      if (current.startsAt <= now) throw conflict('BOOKING_STARTED');
      const [cancelled] = await tx
        .update(booking)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: 'owner',
          // Who, so the record answers it (#69): the primary, a co-owner or a manager.
          cancelledByUserId: userId,
          refundMinor: current.totalMinor,
          refundStatus: owesRefund(current, current.totalMinor),
        })
        .where(eq(booking.id, bookingId))
        .returning();
      if (!cancelled) throw notFound('BOOKING_NOT_FOUND');
      const info = await this.listingOf(tx, owned.id);
      await this.queueEmails(tx, cancelled, info, [
        { kind: 'booking-cancelled', userId: current.userId, to: 'driver' },
      ]);
      // The primary hears of a cancellation by anyone else on the listing (#69): a co-owner or a
      // manager, by role and never by name; who it was is on the booking (`cancelled_by_user_id`).
      if (still?.role !== 'primary') {
        const [lead] = await tx
          .select({ userId: profile.userId })
          .from(listing)
          .innerJoin(profile, eq(profile.id, listing.ownerId))
          .where(eq(listing.id, owned.id));
        if (lead && lead.userId !== userId) {
          await tx
            .insert(outbox)
            .values({
              kind: 'booking-cancelled-by-team',
              userId: lead.userId,
              payload: {
                listingName: cancelled.listingName ?? undefined,
                booking: {
                  ...outboxBooking(cancelled, info),
                  cancelledByRole: still ? 'co_owner' : 'manager',
                },
              },
              dedupeKey: `booking:${cancelled.id}:cancelled-by-team:${lead.userId}`,
            })
            .onConflictDoNothing({ target: outbox.dedupeKey });
        }
      }
      return cancelled;
    });
    await this.sendCancelRefund(owed);
  }

  /**
   * Support calls one booking off (#82): confirmed and not begun, the driver refunded in full and
   * told, and every owner of the listing told too. In the caller's transaction, the listing's lock
   * first and then the booking's, as every path takes them; asked again, it is already done and says
   * so (`not-cancellable`). The refund is recorded `owed` and the worker sends it.
   */
  async cancelForStaff(
    tx: Transaction,
    staffId: string,
    bookingId: string,
  ): Promise<
    'not-cancellable' | 'not-found' | 'disputed' | { reference: string; refundMinor: number }
  > {
    const [located] = await tx
      .select({ locationId: booking.locationId })
      .from(booking)
      .where(eq(booking.id, bookingId));
    if (!located) return 'not-found';
    await tx
      .select({ id: listing.id })
      .from(listing)
      .where(eq(listing.id, located.locationId))
      .for('share');
    const [current] = await tx
      .select()
      .from(booking)
      .where(eq(booking.id, bookingId))
      .for('update');
    if (!current) return 'not-found';
    const now = new Date();
    if (current.status !== 'confirmed' || current.startsAt <= now) return 'not-cancellable';
    // A booking the bank is disputing is not refunded by us as well: the driver would be paid twice,
    // and the loss would be ours (#82). Read under the booking's lock, as a dispute is recorded.
    const held = await tx.execute<{ held: boolean }>(
      sql`select exists (${heldByDispute}) as held from ${booking} b where b.id = ${bookingId}`,
    );
    if (held.rows[0]?.held === true) return 'disputed';
    const [cancelled] = await tx
      .update(booking)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: 'owner',
        cancelledByUserId: staffId,
        refundMinor: current.totalMinor,
        refundStatus: owesRefund(current, current.totalMinor),
      })
      .where(eq(booking.id, bookingId))
      .returning();
    if (!cancelled) return 'not-found';
    const info = await this.listingOf(tx, current.locationId);
    await this.queueEmails(tx, cancelled, info, [
      { kind: 'booking-cancelled', userId: current.userId, to: 'driver' },
      ...(await this.ownerUsersOf(tx, current.locationId)).map((userId) => ({
        kind: 'booking-cancelled-by-staff' as const,
        userId,
        to: 'owner' as const,
      })),
    ]);
    return { reference: cancelled.reference, refundMinor: current.totalMinor };
  }

  /**
   * Tells each owner paid for a booking who bears its lost dispute (#83), in the transaction that
   * decided it: the facts of the booking, never the driver. Each owner once per booking and kind.
   */
  async tellPayees(
    tx: Transaction,
    bookingId: string,
    kind: 'dispute-parkfairy-bears' | 'dispute-owners-bear',
  ): Promise<void> {
    const [current] = await tx.select().from(booking).where(eq(booking.id, bookingId));
    if (!current) return;
    const info = await this.listingOf(tx, current.locationId);
    const payees = await tx
      .select({ userId: profile.userId })
      .from(schema.bookingPayees)
      .innerJoin(profile, eq(profile.id, schema.bookingPayees.ownerId))
      .where(eq(schema.bookingPayees.bookingId, bookingId));
    if (payees.length === 0) return;
    await tx
      .insert(outbox)
      .values(
        payees.map(({ userId }) => ({
          kind,
          userId,
          payload: {
            listingName: current.listingName ?? undefined,
            contentLocale: current.listingLocale,
            booking: outboxBooking(current, info),
          },
          dedupeKey: `booking:${bookingId}:${kind}:${userId}`,
        })),
      )
      .onConflictDoNothing({ target: outbox.dedupeKey });
  }

  /**
   * Staff suspended the listing and chose to call off what is booked (#78): every confirmed booking
   * that hasn't started, each driver refunded in full and told. Inside the suspension's own
   * transaction, with the listing's lock held (before the bookings', as every path takes them), so
   * none is booked or cancelled between the choice and the suspension. The refunds are recorded
   * `owed` and the worker sends them (a listing can have many, and staff shouldn't wait on Stripe
   * for each); the cancelling account is the staff member's.
   *
   * Set-based, a few hundred at a time: one statement for the bookings and one for their emails per
   * chunk, not two round trips each, so a busy listing doesn't hold its lock (and every driver
   * waiting on it, each with a pool connection) for seconds, and no statement meets the timeout.
   * The update takes each row's lock as it goes, and one a driver cancelled meanwhile is passed over.
   */
  async cancelUpcomingForStaff(
    tx: Transaction,
    staffId: string,
    listingId: string,
  ): Promise<number> {
    const now = new Date();
    const info = await this.listingOf(tx, listingId);
    let cancelled = 0;
    for (;;) {
      const chunk = await tx
        .update(booking)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: 'owner',
          cancelledByUserId: staffId,
          refundMinor: sql`${booking.totalMinor}`,
          // As `owesRefund` says it: paid at Stripe, and something goes back.
          refundStatus: sql`case when ${booking.paymentStatus} = 'succeeded' and ${booking.totalMinor} > 0 then 'owed' end`,
        })
        .where(
          inArray(
            booking.id,
            tx
              .select({ id: booking.id })
              .from(booking)
              .where(
                and(
                  eq(booking.locationId, listingId),
                  eq(booking.status, 'confirmed'),
                  gt(booking.startsAt, now),
                ),
              )
              .orderBy(booking.startsAt, booking.id)
              .limit(CANCEL_CHUNK),
          ),
        )
        .returning();
      if (chunk.length === 0) break;
      await tx
        .insert(outbox)
        .values(
          chunk.map((row) => ({
            kind: 'booking-cancelled' as const,
            userId: row.userId,
            payload: {
              listingName: row.listingName ?? undefined,
              booking: outboxBooking(row, info),
            },
            dedupeKey: `booking:${row.id}:cancelled:driver`,
          })),
        )
        .onConflictDoNothing({ target: outbox.dedupeKey });
      cancelled += chunk.length;
      if (chunk.length < CANCEL_CHUNK) break;
    }
    return cancelled;
  }

  /**
   * The listing, if this user is one of its owners (#53) or manages it (#69); anything else is the
   * same 404.
   */
  private async ownedListing(userId: string, listingId: string) {
    if (!UUID.test(listingId)) throw listingNotFound();
    const [owned] = await this.db
      .select({ id: listing.id, name: listing.name, contentLocale: listing.contentLocale })
      .from(listing)
      .where(and(eq(listing.id, listingId), runsListing(userId)));
    if (!owned) throw listingNotFound();
    return owned;
  }

  private async listingOf(db: Reader, locationId: string): Promise<ListingInfo> {
    const [info] = await db.select(listingInfo).from(listing).where(eq(listing.id, locationId));
    if (!info) throw notFound('BOOKING_NOT_FOUND');
    return info;
  }

  /**
   * How many emails this driver's bookings have earned each of these owners in the last day (L3):
   * the confirmations and driver's cancellations at any of the owner's listings, the one being
   * written included, in one statement for all of them. Read on the driver's own bookings
   * (`bookings_user_starts_idx`), which are few. Two at once may both pass: a cap, not a count.
   */
  private async driverEmailsToOwners(
    tx: Transaction,
    driverId: string,
    ownerUserIds: string[],
  ): Promise<Map<string, number>> {
    if (ownerUserIds.length === 0) return new Map();
    const since = new Date(Date.now() - DAY_MS);
    const rows = await tx
      .select({
        userId: profile.userId,
        events: sql<number>`(count(*) filter (where ${booking.confirmedAt} > ${since})
          + count(*) filter (where ${booking.cancelledBy} = 'driver' and ${booking.cancelledAt} > ${since}))::int`,
      })
      .from(booking)
      .innerJoin(owners, eq(owners.locationId, booking.locationId))
      .innerJoin(profile, eq(profile.id, owners.ownerId))
      .where(
        and(
          eq(booking.userId, driverId),
          inArray(profile.userId, ownerUserIds),
          // Only rows with an event in the window (a cancellation comes after its confirmation),
          // so neither a long history nor a week of holds is read under the locks.
          sql`coalesce(${booking.cancelledAt}, ${booking.confirmedAt}) > ${since}`,
        ),
      )
      .groupBy(profile.userId);
    return new Map(rows.map((row) => [row.userId, row.events]));
  }

  /** The accounts of every owner of the listing, the primary first. */
  private async ownerUsersOf(db: Reader, locationId: string): Promise<string[]> {
    const rows = await db
      .select({ userId: profile.userId })
      .from(owners)
      .innerJoin(profile, eq(profile.id, owners.ownerId))
      .where(eq(owners.locationId, locationId))
      .orderBy(sql`${owners.role} = 'primary' desc`, asc(owners.createdAt));
    return rows.map((row) => row.userId);
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
          // Each owner their own (#53): a co-owned listing's owners each hear of it once.
          dedupeKey: `booking:${row.id}:${event}:${to === 'owner' ? `owner:${userId}` : to}`,
        })),
      )
      .onConflictDoNothing({ target: outbox.dedupeKey });
  }
}
