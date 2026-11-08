import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  BookingSchema,
  BOOKINGS_PAGE_SIZE,
  BookingListSchema,
  HOLD_MAX_EXTENSIONS,
  HOLD_MINUTES,
  MAX_BOOKING_DAYS,
  NAME_MAX_LENGTH,
  normalizeVehiclePlate,
  OwnerListingBookingsSchema,
  type Booking,
  type BookingCancelInput,
  type BookingConfirmInput,
  type BookingHoldInput,
  type BookingList,
  type BookingListQuery,
  type Locale,
  type Money,
  type OwnerBookingsQuery,
  type OwnerListingBookings,
} from '@parkfairy/contracts';
import { schema, type Database, type OutboxBooking } from '@parkfairy/database';
import { and, asc, desc, eq, gt, lte, or, sql, type SQL } from 'drizzle-orm';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB } from '../database/database.module.js';
import { conflict, listingNotFound } from '../owner/owner.errors.js';
import {
  hoursExceptionsOf,
  openingHoursOf,
  priceRulesOf,
  utcDay,
  type Reader,
} from '../parking/listing-data.js';
import { isOpenThroughout } from '../parking/opening-hours.js';
import { NO_PRICE_RULES, quoteStayMinor } from '../parking/pricing.js';
import { newBookingReference } from './booking-reference.js';
import { refundMinor } from './refunds.js';

const booking = schema.bookings;
const listing = schema.parkingLocations;
const space = schema.parkingSpaces;
const profile = schema.ownerProfiles;
const users = schema.users;
const outbox = schema.emailOutbox;

type BookingRow = typeof booking.$inferSelect;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type OutboxKind = typeof outbox.$inferInsert.kind;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

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

/** The booking as its driver reads it; `now` decides what cancelling would give back. */
function view(row: BookingRow, info: ListingInfo, now = new Date()): Booking {
  const cancellable = row.status === 'confirmed' && row.startsAt > now;
  return BookingSchema.parse({
    id: row.id,
    reference: row.reference,
    status: row.status,
    listing: info,
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
  });
}

/** What the emails about a booking may say: no people's names, no plate. */
function outboxBooking(row: BookingRow, info: ListingInfo): OutboxBooking {
  return {
    id: row.id,
    listingId: row.locationId,
    reference: row.reference,
    address: info.address,
    contentLocale: info.contentLocale,
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
 * Marks the space's holds whose time ran out, so the exclusion constraint stops counting them.
 * `skip locked`: a hold that another transaction has in hand is theirs to settle, and waiting on it
 * could deadlock two drivers releasing each other's spaces. Such a row being let go meanwhile
 * makes an insert wait for that transaction, not fail.
 */
async function expireLapsedHolds(tx: Transaction, spaceId: string, except?: string) {
  await tx.execute(sql`update ${booking} set status = 'expired', updated_at = now()
    where id in (select id from ${booking} where space_id = ${spaceId} and status = 'held'
      and hold_expires_at <= now() ${except ? sql`and id <> ${except}` : sql``}
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
  ) {}

  /** Until Phase 4, holds and confirmations work only where no payment is due (decision #33). */
  private assertBookable() {
    if (!this.env.bookingWithoutPayment) throw conflict('BOOKING_UNAVAILABLE');
  }

  /** Keeps a space for the driver for HOLD_MINUTES (decision #3). */
  async hold(userId: string, input: BookingHoldInput): Promise<Booking> {
    this.assertBookable();
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
    const [row] = await tx
      .select(bookableColumns)
      .from(listing)
      .leftJoin(profile, eq(profile.id, listing.ownerId))
      .where(and(published, eq(listing.slug, input.listing)))
      .for('share', { of: listing });
    if (!row || row.hourlyRateMinor === null) throw notFound('LISTING_NOT_FOUND');
    // A booking of one's own would be a payout to oneself (Phase 4) and tells nobody anything.
    if (row.ownerUserId === userId) throw conflict('OWN_LISTING');
    const [spot] = await tx
      .select({ id: space.id, label: space.label, ownRate: space.hourlyRateMinor })
      .from(space)
      .where(
        and(eq(space.id, input.spaceId), eq(space.locationId, row.id), sql`${space.isActive}`),
      );
    if (!spot) throw notFound('SPACE_NOT_FOUND');
    await this.assertOpen(tx, row, stay);

    // One hold at a time: a new one lets the driver's others go, so one account can't sit on
    // many spaces. A press of Book twice lets the first go and takes the space again.
    await tx
      .update(booking)
      .set({ status: 'released' })
      .where(and(eq(booking.userId, userId), eq(booking.status, 'held')));
    await expireLapsedHolds(tx, spot.id);

    const rules = (await priceRulesOf(tx, [row.id])).get(row.id) ?? NO_PRICE_RULES;
    const totalMinor = quoteStayMinor({
      rates: { hourlyRateMinor: row.hourlyRateMinor, dailyMaxMinor: row.dailyMaxMinor },
      rules,
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
      })
      .returning();
    if (!created) throw new Error('Hold not inserted');
    return view(created, row);
  }

  /** The listing is open for the whole stay, read under its lock. */
  private async assertOpen(
    db: Reader,
    row: { id: string; timeZone: string },
    { start, end }: { start: Date; end: Date },
  ) {
    const periods = (await openingHoursOf(db, [row.id])).get(row.id) ?? [];
    const exceptions =
      (
        await hoursExceptionsOf(db, [row.id], addDays(utcDay(start), -1), addDays(utcDay(end), 1))
      ).get(row.id) ?? [];
    if (!isOpenThroughout(periods, start, end, row.timeZone, exceptions)) {
      throw conflict('LISTING_CLOSED');
    }
  }

  /**
   * Turns the driver's hold into a booking; until Phase 4 this stands in for paying (#33). Only
   * while the hold runs (decision #37): after it, the driver chooses the space again, and to have
   * more time they keep the hold (`extend`). A payment arriving late in Phase 4 is decision #3's
   * case, settled where the payment is, not by this press. Asked again, a confirmed booking answers
   * as it is.
   */
  async confirm(userId: string, id: string, input: BookingConfirmInput): Promise<Booking> {
    this.assertBookable();
    if (!UUID.test(id)) throw notFound('BOOKING_NOT_FOUND');
    const vehiclePlate = normalizeVehiclePlate(input.vehiclePlate);
    try {
      return await this.db.transaction(async (tx) => {
        const [found] = await tx
          .select({ locationId: booking.locationId })
          .from(booking)
          .where(and(eq(booking.id, id), eq(booking.userId, userId)));
        if (!found) throw notFound('BOOKING_NOT_FOUND');
        const [row] = await tx
          .select(bookableColumns)
          .from(listing)
          .leftJoin(profile, eq(profile.id, listing.ownerId))
          .where(eq(listing.id, found.locationId))
          .for('share', { of: listing });
        const [current] = await tx.select().from(booking).where(eq(booking.id, id)).for('update');
        if (!row || !current) throw notFound('BOOKING_NOT_FOUND');
        if (current.status === 'confirmed') return view(current, row);
        const now = new Date();
        // A hold that ran out, swept or not, books nothing: the space may be someone else's now.
        if (current.status !== 'held' || current.holdExpiresAt <= now) {
          throw conflict('BOOKING_NOT_ACTIVE');
        }
        if (row.status !== 'published') throw conflict('LISTING_CLOSED');
        // Removed from a listing sent back to its owner, or taken out of use, since the hold.
        const [spot] = current.spaceId
          ? await tx
              .select({ id: space.id })
              .from(space)
              .where(and(eq(space.id, current.spaceId), sql`${space.isActive}`))
          : [];
        if (!current.spaceId || !spot) throw conflict('SPACE_TAKEN');
        // The owner may have closed that time since the hold; it is refused now, not later.
        await this.assertOpen(tx, row, { start: current.startsAt, end: current.endsAt });

        const [confirmed] = await tx
          .update(booking)
          .set({ status: 'confirmed', vehiclePlate, confirmedAt: now })
          .where(eq(booking.id, id))
          .returning();
        if (!confirmed) throw notFound('BOOKING_NOT_FOUND');
        await this.queueEmails(tx, confirmed, row, [
          { kind: 'booking-confirmed', userId, to: 'driver' },
          ...(row.ownerUserId
            ? [{ kind: 'booking-received' as const, userId: row.ownerUserId, to: 'owner' as const }]
            : []),
        ]);
        return view(confirmed, row, now);
      });
    } catch (error) {
      if (violates(error, '23P01', 'bookings_space_no_overlap')) throw conflict('SPACE_TAKEN');
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
    this.assertBookable();
    if (!UUID.test(id)) throw notFound('BOOKING_NOT_FOUND');
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(booking)
        .where(and(eq(booking.id, id), eq(booking.userId, userId)))
        .for('update');
      if (!current) throw notFound('BOOKING_NOT_FOUND');
      if (current.status === 'confirmed')
        return view(current, await this.listingOf(tx, current.locationId));
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
      return view(kept, await this.listingOf(tx, kept.locationId));
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
        return view(released ?? current, info, now);
      }
      if (current.status !== 'confirmed') return view(current, info, now);
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
        ...(ownerUserId
          ? [
              {
                kind: 'booking-cancelled-by-driver' as const,
                userId: ownerUserId,
                to: 'owner' as const,
              },
            ]
          : []),
      ]);
      return view(cancelled, info, now);
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
    return view(row.booking, row.info);
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
      bookings: rows.slice(0, BOOKINGS_PAGE_SIZE).map((row) => view(row.booking, row.info, now)),
      page,
      hasMore: rows.length > BOOKINGS_PAGE_SIZE,
    });
  }

  /**
   * A listing's confirmed bookings that haven't ended, soonest first, with who is coming in which
   * car (decision #35). Only to the listing's owner.
   */
  async listingBookings(
    userId: string,
    listingId: string,
    { page }: OwnerBookingsQuery,
  ): Promise<OwnerListingBookings> {
    const owned = await this.ownedListing(userId, listingId);
    const now = new Date();
    const rows = await this.db
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
        and(
          eq(booking.locationId, owned.id),
          eq(booking.status, 'confirmed'),
          gt(booking.endsAt, now),
          // Implied by the line above (a stay lasts 30 days at most), and what keeps the index
          // from reading every booking the listing ever had.
          gt(booking.startsAt, new Date(now.getTime() - (MAX_BOOKING_DAYS + 1) * DAY_MS)),
        ),
      )
      .orderBy(asc(booking.startsAt), asc(booking.id))
      .limit(BOOKINGS_PAGE_SIZE + 1)
      .offset((page - 1) * BOOKINGS_PAGE_SIZE);
    return OwnerListingBookingsSchema.parse({
      ...owned,
      bookings: rows.slice(0, BOOKINGS_PAGE_SIZE).map((row) => ({
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
      page,
      hasMore: rows.length > BOOKINGS_PAGE_SIZE,
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
  ) {
    if (emails.length === 0) return;
    const event = row.status === 'cancelled' ? 'cancelled' : 'confirmed';
    await tx
      .insert(outbox)
      .values(
        emails.map(({ kind, userId, to }) => ({
          kind,
          userId,
          payload: { listingName: info.name ?? undefined, booking: outboxBooking(row, info) },
          dedupeKey: `booking:${row.id}:${event}:${to}`,
        })),
      )
      .onConflictDoNothing({ target: outbox.dedupeKey });
  }
}
