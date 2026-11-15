import { z } from 'zod';
import { BOOKING_REFERENCE_PATTERN } from './bookings.js';
import { LocaleSchema } from './i18n.js';
import { DEFAULT_TIME_ZONE } from './locales.js';
import { contractsRegistry } from './registry.js';
import { zonedParts } from './time.js';
import { message, NAME_MAX_LENGTH } from './validation.js';

/**
 * The owner's calendar (5.1): the confirmed bookings of the listings they own, a month at a time
 * and a day at a time, each in its listing's own time zone. An agenda, not a grid: a list is what a
 * screen reader and a phone read best, and it is the same list a grid would be drawn from.
 */
export const CALENDAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** How far from this month an owner may look, either way: a year of stays can be booked ahead. */
export const CALENDAR_MONTHS_AWAY = 24;
/** A month of a very busy owner is cut here, and says so (`truncated`). */
export const CALENDAR_BOOKINGS_MAX = 500;

/** This month in the platform's time zone, as `2026-11`. */
export const currentMonth = (now = new Date()) =>
  zonedParts(now, DEFAULT_TIME_ZONE).date.slice(0, 7);

/** The month after (or, with a negative count, before) `month`, as `2026-12`. */
export function addMonths(month: string, count: number): string {
  const [year = 1970, number = 1] = month.split('-').map(Number);
  const index = year * 12 + (number - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Whole months from `from` to `to` (negative when `to` is earlier). */
export function monthsBetween(from: string, to: string): number {
  const index = (month: string) => {
    const [year = 1970, number = 1] = month.split('-').map(Number);
    return year * 12 + (number - 1);
  };
  return index(to) - index(from);
}

export const OwnerCalendarQuerySchema = z
  .object({
    /** Defaults to this month, in the platform's time zone. */
    month: z
      .string(message('invalid'))
      .regex(CALENDAR_MONTH_PATTERN, message('invalid'))
      .optional(),
    /** One listing's bookings only; any other owner's listing is the same as none. */
    listing: z.uuid(message('invalid')).optional(),
  })
  // Within a couple of years of today: nobody books further ahead, and none is left further back.
  .refine(
    ({ month }) =>
      month === undefined || Math.abs(monthsBetween(currentMonth(), month)) <= CALENDAR_MONTHS_AWAY,
    { error: message('invalid'), path: ['month'] },
  )
  .register(contractsRegistry, { id: 'OwnerCalendarQuery' });
export type OwnerCalendarQuery = z.infer<typeof OwnerCalendarQuerySchema>;

export const CalendarListingSchema = z
  .object({
    id: z.uuid(),
    /** Null only if the owner has since emptied it, on a listing sent back to them. */
    name: z.string().nullable(),
    contentLocale: LocaleSchema,
  })
  .register(contractsRegistry, { id: 'CalendarListing' });

export const CalendarBookingSchema = z
  .object({
    id: z.uuid(),
    reference: z.string().regex(BOOKING_REFERENCE_PATTERN),
    listing: CalendarListingSchema,
    spaceLabel: z.string(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    /** The listing's time zone: what the owner's clock reads there, which the days go by. */
    timeZone: z.string(),
    /** The driver's own words: isolated on the page (`<bdi>`). */
    driverName: z.string().max(NAME_MAX_LENGTH),
    vehiclePlate: z.string(),
  })
  .register(contractsRegistry, { id: 'CalendarBooking' });
export type CalendarBooking = z.infer<typeof CalendarBookingSchema>;

export const CalendarDaySchema = z
  .object({
    /** `2026-11-18`, the day the bookings start, in their listing's time zone. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    bookings: z.array(CalendarBookingSchema).min(1),
  })
  .register(contractsRegistry, { id: 'CalendarDay' });

export const OwnerCalendarSchema = z
  .object({
    month: z.string().regex(CALENDAR_MONTH_PATTERN),
    /** The month before and after, null at the edge of what can be looked at. */
    previous: z.string().regex(CALENDAR_MONTH_PATTERN).nullable(),
    next: z.string().regex(CALENDAR_MONTH_PATTERN).nullable(),
    /** The listing shown alone, or null for all. */
    listing: z.uuid().nullable(),
    /** Every listing the owner owns, for the filter. */
    listings: z.array(CalendarListingSchema).max(100),
    /** Days with a booking, in order; a day without one isn't listed. */
    days: z.array(CalendarDaySchema).max(CALENDAR_BOOKINGS_MAX),
    /** The month had more bookings than are shown: the rest are cut from its end. */
    truncated: z.boolean(),
  })
  .register(contractsRegistry, { id: 'OwnerCalendar' });
export type OwnerCalendar = z.infer<typeof OwnerCalendarSchema>;
