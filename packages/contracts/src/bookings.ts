import { z } from 'zod';
import { LocaleSchema } from './i18n.js';
import {
  CancellationPolicySchema,
  checkStayWindow,
  isListingSlug,
  MoneySchema,
} from './parking.js';
import { contractsRegistry } from './registry.js';
import { isVehiclePlate } from './plates.js';
import { message, NAME_MAX_LENGTH } from './validation.js';

export * from './plates.js';

/**
 * A booking's life. `held` keeps the space for HOLD_MINUTES; `confirmed` is booked; a hold that ran
 * out is `expired` and one the driver let go (or replaced with another) `released`; a booking
 * called off is `cancelled`. Only `held` and `confirmed` take the space.
 */
export const BOOKING_STATUSES = ['held', 'confirmed', 'cancelled', 'expired', 'released'] as const;
export const BookingStatusSchema = z.enum(BOOKING_STATUSES).register(contractsRegistry, {
  id: 'BookingStatus',
});
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

/** Who called a booking off. */
export const BOOKING_CANCELLERS = ['driver', 'owner'] as const;
export const BookingCancellerSchema = z.enum(BOOKING_CANCELLERS).register(contractsRegistry, {
  id: 'BookingCanceller',
});
export type BookingCanceller = z.infer<typeof BookingCancellerSchema>;

/** `K7M4-Q2ZD`: Crockford base32, so no I, L, O or U to misread. */
export const BOOKING_REFERENCE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

const instant = z.iso.datetime(message('dateInvalid'));

/**
 * Holds a space for the driver (decision #3): the listing, the space they picked (#9) and the
 * stay, under the same rules as a search.
 */
export const BookingHoldInputSchema = z
  .object({
    listing: z.string(message('invalid')).refine(isListingSlug, message('invalid')),
    spaceId: z.uuid(message('invalid')),
    start: instant,
    end: instant,
  })
  .strict()
  .superRefine((input, ctx) => checkStayWindow(input, ctx))
  .register(contractsRegistry, { id: 'BookingHoldInput' });
export type BookingHoldInput = z.infer<typeof BookingHoldInputSchema>;

/**
 * Turns a hold into a booking. Until Phase 4 this stands in for paying (decision #33). The plate
 * is how the owner knows the car (#35); the API stores it normalized.
 */
export const BookingConfirmInputSchema = z
  .object({
    vehiclePlate: z
      .string(message('plateRequired'))
      .trim()
      // An empty field is "required" only, not also unreadable.
      .min(1, { message: message('plateRequired'), abort: true })
      .refine(isVehiclePlate, message('plateInvalid')),
  })
  .strict()
  .register(contractsRegistry, { id: 'BookingConfirmInput' });
export type BookingConfirmInput = z.infer<typeof BookingConfirmInputSchema>;

/**
 * Calling a booking off. `expectedRefundMinor` is what the driver was told would come back: the
 * refund falls as the start nears, and a cancel that would give back less is refused instead
 * (`REFUND_CHANGED`), so nobody gets less than they agreed to.
 */
export const BookingCancelInputSchema = z
  .object({
    expectedRefundMinor: z.int(message('invalid')).nonnegative(message('invalid')).optional(),
  })
  .strict()
  .register(contractsRegistry, { id: 'BookingCancelInput' });
export type BookingCancelInput = z.infer<typeof BookingCancelInputSchema>;

export const BookingListingSchema = z
  .object({
    slug: z.string(),
    /** Null only if the owner has since emptied it, on a listing sent back to them. */
    name: z.string().nullable(),
    address: z.string().nullable(),
    contentLocale: LocaleSchema,
    timeZone: z.string(),
  })
  .register(contractsRegistry, { id: 'BookingListing' });

/** A booking as its driver sees it. */
export const BookingSchema = z
  .object({
    id: z.uuid(),
    reference: z.string().regex(BOOKING_REFERENCE_PATTERN),
    status: BookingStatusSchema,
    listing: BookingListingSchema,
    spaceLabel: z.string(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    /** Agreed when the space was held. */
    total: MoneySchema,
    /** The listing's policy when the space was held; a later change doesn't reach this booking. */
    cancellationPolicy: CancellationPolicySchema,
    /** Until when a hold keeps the space; confirming works only until then (decision #37). */
    holdExpiresAt: z.iso.datetime(),
    /** How many more times the hold may be kept for another HOLD_MINUTES. */
    holdExtensionsLeft: z.int().nonnegative(),
    vehiclePlate: z.string().nullable(),
    confirmedAt: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    cancelledBy: BookingCancellerSchema.nullable(),
    /** After a cancellation: what the driver gets back (paid out from Phase 4). */
    refund: MoneySchema.nullable(),
    /** Confirmed and not started: what cancelling now would give back. Null otherwise. */
    refundIfCancelled: MoneySchema.nullable(),
  })
  .register(contractsRegistry, { id: 'Booking' });
export type Booking = z.infer<typeof BookingSchema>;

export const BOOKINGS_PAGE_SIZE = 20;
/** Pages past this aren't served: nobody reads that far, and an offset that deep costs a scan. */
export const BOOKINGS_MAX_PAGE = 50;

const page = z.coerce
  .number(message('invalid'))
  .int(message('invalid'))
  .min(1, message('invalid'))
  .max(BOOKINGS_MAX_PAGE, message('invalid'))
  .default(1);

/** `upcoming`: confirmed and not over, and holds still running. `past`: the rest but lapsed holds. */
export const BOOKING_LISTS = ['upcoming', 'past'] as const;
export const BookingListQuerySchema = z
  .object({ when: z.enum(BOOKING_LISTS, message('invalid')).default('upcoming'), page })
  .register(contractsRegistry, { id: 'BookingListQuery' });
export type BookingListQuery = z.infer<typeof BookingListQuerySchema>;

export const BookingListSchema = z
  .object({
    bookings: z.array(BookingSchema).max(BOOKINGS_PAGE_SIZE),
    page: z.int().positive(),
    hasMore: z.boolean(),
  })
  .register(contractsRegistry, { id: 'BookingList' });
export type BookingList = z.infer<typeof BookingListSchema>;

/** A booking as the listing's owner sees it: who is coming, in which car (decision #35). */
export const OwnerBookingSchema = z
  .object({
    id: z.uuid(),
    reference: z.string().regex(BOOKING_REFERENCE_PATTERN),
    spaceLabel: z.string(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    /** The driver's account name: their own words, so isolate it (`<bdi>`). */
    driverName: z.string().max(NAME_MAX_LENGTH),
    vehiclePlate: z.string(),
    total: MoneySchema,
    /** Not started yet, so the owner can still call it off (with a full refund). */
    cancellable: z.boolean(),
  })
  .register(contractsRegistry, { id: 'OwnerBooking' });
export type OwnerBooking = z.infer<typeof OwnerBookingSchema>;

export const OwnerBookingsQuerySchema = z
  .object({ page })
  .register(contractsRegistry, { id: 'OwnerBookingsQuery' });
export type OwnerBookingsQuery = z.infer<typeof OwnerBookingsQuerySchema>;

/** A listing's confirmed bookings that haven't ended, soonest first: the owner's bookings page. */
export const OwnerListingBookingsSchema = z
  .object({
    id: z.uuid(),
    name: z.string().nullable(),
    contentLocale: LocaleSchema,
    bookings: z.array(OwnerBookingSchema).max(BOOKINGS_PAGE_SIZE),
    page: z.int().positive(),
    hasMore: z.boolean(),
  })
  .register(contractsRegistry, { id: 'OwnerListingBookings' });
export type OwnerListingBookings = z.infer<typeof OwnerListingBookingsSchema>;

/** Every `code` a booking route answers with, for clients to translate. */
export const BOOKING_ERROR_CODES = [
  'BOOKING_UNAVAILABLE',
  'LISTING_NOT_FOUND',
  'SPACE_NOT_FOUND',
  'SPACE_TAKEN',
  'LISTING_CLOSED',
  'OWN_LISTING',
  'BOOKING_NOT_FOUND',
  'BOOKING_NOT_ACTIVE',
  'BOOKING_STARTED',
  'REFUND_CHANGED',
  'HOLD_LIMIT_REACHED',
] as const;
export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];
