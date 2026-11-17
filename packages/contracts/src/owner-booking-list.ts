import { z } from 'zod';

import {
  BOOKING_REFERENCE_PATTERN,
  BookingCancellerSchema,
  BOOKINGS_CURSOR_PATTERN,
  BOOKINGS_PAGE_SIZE,
  parseBookingsCursor,
} from './bookings.js';
import { DEFAULT_TIME_ZONE } from './locales.js';
import {
  addMonths,
  CALENDAR_MONTHS_AWAY,
  CalendarListingSchema,
  currentMonth,
} from './owner-calendar.js';
import { MoneySchema } from './parking.js';
import { contractsRegistry } from './registry.js';
import { addDays, daysBetween, zonedParts } from './time.js';
import { message, NAME_MAX_LENGTH } from './validation.js';

/**
 * The bookings of every listing the signed-in account runs, in one list (5.1): `upcoming` (confirmed
 * and not over, soonest first), `past` (confirmed and over, latest first) and `cancelled` (latest
 * first), by listing and by the day a stay starts in its listing's own time zone. Owners, co-owners
 * and managers each see what the per-listing page shows them (#35, #53, #69): not stays that ended
 * before they joined.
 */
export const OWNER_BOOKING_STATUSES = ['upcoming', 'past', 'cancelled'] as const;
export const OwnerBookingStatusSchema = z
  .enum(OWNER_BOOKING_STATUSES)
  .register(contractsRegistry, { id: 'OwnerBookingStatus' });
export type OwnerBookingStatus = z.infer<typeof OwnerBookingStatusSchema>;

/** A window of start days is at most this long (inclusive): a year of history is one query's worth. */
export const OWNER_BOOKINGS_WINDOW_DAYS = 366;
/** What `past` and `cancelled` show when no day is asked for: the last quarter. */
export const OWNER_BOOKINGS_DEFAULT_DAYS = 90;

/** Today in the platform's time zone, as `2026-11-16`. */
export const platformToday = (now = new Date()) => zonedParts(now, DEFAULT_TIME_ZONE).date;

/**
 * The first and last day that may be asked for: the calendar's reach, 24 months either side of this
 * month. Nobody books further ahead, and how long drivers' names and plates stay readable further
 * back is Phase 6's to set (retention): until then the list reads no further than the calendar.
 */
export function ownerBookingsReach(now = new Date()): { min: string; max: string } {
  const month = currentMonth(now);
  return {
    min: `${addMonths(month, -CALENDAR_MONTHS_AWAY)}-01`,
    max: addDays(`${addMonths(month, CALENDAR_MONTHS_AWAY + 1)}-01`, -1),
  };
}

const startDay = z.iso.date(message('invalid')).refine((day) => {
  const { min, max } = ownerBookingsReach();
  return day >= min && day <= max;
}, message('invalid'));

/**
 * The days asked for, or for `past` and `cancelled` (which would otherwise read every stay a garage
 * ever had) the window those get: the last 90 days, a year after a `from` alone, a year up to a
 * `to` alone (and no further back than `ownerBookingsReach`). `upcoming` has no window unless one
 * is asked for. Null on a side means no bound.
 */
export function ownerBookingsWindow(
  status: OwnerBookingStatus,
  { from, to }: { from?: string | undefined; to?: string | undefined },
  now = new Date(),
): { from: string | null; to: string | null } {
  if (status === 'upcoming') return { from: from ?? null, to: to ?? null };
  const span = OWNER_BOOKINGS_WINDOW_DAYS - 1;
  if (from && to) return { from, to };
  if (from) {
    // A past stay started no later than today; a cancelled one may be a future stay called off.
    const end = addDays(from, span);
    return { from, to: status === 'past' && end > platformToday(now) ? platformToday(now) : end };
  }
  if (to) {
    // Never further back than may be asked for outright.
    const { min } = ownerBookingsReach(now);
    const start = addDays(to, -span);
    return { from: start < min ? min : start, to };
  }
  return {
    from: addDays(platformToday(now), -OWNER_BOOKINGS_DEFAULT_DAYS),
    to: status === 'past' ? platformToday(now) : null,
  };
}

export const OwnerBookingListQuerySchema = z
  .object({
    status: OwnerBookingStatusSchema.default('upcoming'),
    /** One listing's bookings only; a listing that isn't the account's is the same as none. */
    listing: z.uuid(message('invalid')).optional(),
    /** The first and last day a stay may start on, in its listing's own time zone. */
    from: startDay.optional(),
    to: startDay.optional(),
    /** A place a page gave out: the page after it in reading order, or the one before. */
    after: z
      .string(message('invalid'))
      .refine((place) => parseBookingsCursor(place) !== null, message('invalid'))
      .optional(),
    before: z
      .string(message('invalid'))
      .refine((place) => parseBookingsCursor(place) !== null, message('invalid'))
      .optional(),
  })
  .refine((query) => !(query.after && query.before), { error: message('invalid'), path: ['after'] })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    error: message('invalid'),
    path: ['to'],
  })
  .refine(
    (query) =>
      !query.from || !query.to || daysBetween(query.from, query.to) < OWNER_BOOKINGS_WINDOW_DAYS,
    { error: message('invalid'), path: ['to'] },
  )
  .register(contractsRegistry, { id: 'OwnerBookingListQuery' });
export type OwnerBookingListQuery = z.infer<typeof OwnerBookingListQuerySchema>;

/** What a booking in the list is: stays not over are `upcoming`, or `underWay` once begun. */
export const OWNER_BOOKING_STATES = ['upcoming', 'underWay', 'ended', 'cancelled'] as const;
export const OwnerBookingStateSchema = z
  .enum(OWNER_BOOKING_STATES)
  .register(contractsRegistry, { id: 'OwnerBookingState' });
export type OwnerBookingState = z.infer<typeof OwnerBookingStateSchema>;

export const OwnerBookingListItemSchema = z
  .object({
    id: z.uuid(),
    reference: z.string().regex(BOOKING_REFERENCE_PATTERN),
    listing: CalendarListingSchema,
    /** The listing's time zone, which the stay's days and times are read in. */
    timeZone: z.string(),
    spaceLabel: z.string(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    /** The driver's account name: their own words, so isolate it (`<bdi>`). */
    driverName: z.string().max(NAME_MAX_LENGTH),
    vehiclePlate: z.string(),
    /** What the driver paid, as on the listing's own page (#35): not anyone's earnings. */
    total: MoneySchema,
    state: OwnerBookingStateSchema,
    /** Only for `cancelled`: whose side called it off, and when. */
    cancelledBy: BookingCancellerSchema.nullable(),
    cancelledAt: z.iso.datetime().nullable(),
  })
  .register(contractsRegistry, { id: 'OwnerBookingListItem' });
export type OwnerBookingListItem = z.infer<typeof OwnerBookingListItemSchema>;

export const OwnerBookingListSchema = z
  .object({
    status: OwnerBookingStatusSchema,
    /** The listing shown alone, or null for all. */
    listing: z.uuid().nullable(),
    /** The days shown, `from` and `to` as asked or as the list's own window; null is no bound. */
    from: z.iso.date().nullable(),
    to: z.iso.date().nullable(),
    /** Every listing the account runs, for the filter. */
    listings: z.array(CalendarListingSchema).max(100),
    bookings: z.array(OwnerBookingListItemSchema).max(BOOKINGS_PAGE_SIZE),
    /** `before` for the page ahead of this one, null on the first. */
    previous: z.string().regex(BOOKINGS_CURSOR_PATTERN).nullable(),
    /** `after` for the page that follows, null on the last. */
    next: z.string().regex(BOOKINGS_CURSOR_PATTERN).nullable(),
  })
  .register(contractsRegistry, { id: 'OwnerBookingList' });
export type OwnerBookingList = z.infer<typeof OwnerBookingListSchema>;
