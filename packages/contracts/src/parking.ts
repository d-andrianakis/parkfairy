import { z } from 'zod';
import { AREA_IDS, AreaIdSchema } from './areas.js';
import { DEFAULT_TIME_ZONE, LocaleSchema } from './i18n.js';
import { contractsRegistry } from './registry.js';
import { wallClockMs } from './time.js';
import { MAX_BOOKING_DAYS, MAX_START_AHEAD_DAYS, message } from './validation.js';

/** Bookings and searches move in half-hour steps. Athens' UTC offset is whole hours, so
 * local :00/:30 boundaries are UTC :00/:30 boundaries too. */
export const BOOKING_STEP_MINUTES = 30;
export const MIN_BOOKING_MINUTES = 30;
const DAY_MS = 24 * 60 * 60_000;
const STEP_MS = BOOKING_STEP_MINUTES * 60_000;

/** Listing URL keys: lowercase words joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LISTING_LIMITS = {
  slug: 80,
  name: 120,
  address: 200,
  description: 2000,
  spaceLabel: 20,
} as const;

/** A listing's life. Drafts and listings sent back may be incomplete; the rest may not. */
export const LISTING_STATUSES = [
  'draft',
  'in_review',
  'changes_requested',
  'published',
  'suspended',
] as const;
export const ListingStatusSchema = z.enum(LISTING_STATUSES).register(contractsRegistry, {
  id: 'ListingStatus',
});
export type ListingStatus = z.infer<typeof ListingStatusSchema>;

/** Zones listings may use. Athens only until listings outside Greece exist: the web app shows
 * and parses times in DEFAULT_TIME_ZONE. */
export const SUPPORTED_TIME_ZONES = [DEFAULT_TIME_ZONE] as const;

export function isListingSlug(value: string): boolean {
  return value.length <= LISTING_LIMITS.slug && SLUG_PATTERN.test(value);
}

/** How far from the chosen area (or the driver's position) search looks. */
export const SEARCH_RADIUS_METERS = 5000;

export const CURRENCIES = ['EUR'] as const;
export const CurrencySchema = z.enum(CURRENCIES).register(contractsRegistry, {
  id: 'Currency',
  description: 'ISO 4217 currency code.',
});

export const MoneySchema = z
  .object({
    /** Integer minor units (cents). */
    amountMinor: z.int().nonnegative(),
    currency: CurrencySchema,
  })
  .register(contractsRegistry, { id: 'Money' });
export type Money = z.infer<typeof MoneySchema>;

export const PARKING_FEATURES = ['covered', 'evCharging', 'accessible'] as const;
export const ParkingFeatureSchema = z.enum(PARKING_FEATURES).register(contractsRegistry, {
  id: 'ParkingFeature',
});
export type ParkingFeature = z.infer<typeof ParkingFeatureSchema>;

/** Start of the half-hour slot containing `now`: searches may begin there, not earlier. */
export function currentSlotStart(now: number = Date.now()): number {
  return Math.floor(now / STEP_MS) * STEP_MS;
}

interface Window {
  start?: string | undefined;
  end?: string | undefined;
}

/** Shared rules for a parking window [start, end). Issue messages are catalog keys. */
function checkWindow(window: Window, ctx: z.RefinementCtx) {
  if (!window.start || !window.end) return;
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return; // already reported as dateInvalid
  if (start % STEP_MS !== 0) {
    ctx.addIssue({ code: 'custom', path: ['start'], message: message('timeNotOnStep') });
  }
  if (end % STEP_MS !== 0) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: message('timeNotOnStep') });
  }
  const slot = currentSlotStart();
  if (start < slot) {
    ctx.addIssue({ code: 'custom', path: ['start'], message: message('startInPast') });
  } else if (start > slot + MAX_START_AHEAD_DAYS * DAY_MS) {
    ctx.addIssue({ code: 'custom', path: ['start'], message: message('startTooFar') });
    return; // the end is meaningless that far out; keep the API away from such dates
  }
  // The 30-day limit is read on the Athens wall clock, so a 30-day stay across the autumn
  // DST change (30 days + 1 hour of real time) is still 30 days.
  const wallDuration =
    wallClockMs(new Date(end), DEFAULT_TIME_ZONE) - wallClockMs(new Date(start), DEFAULT_TIME_ZONE);
  if (end <= start) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: message('endBeforeStart') });
  } else if (
    // NaN (unreadable far-future date) fails the wall-clock check; real time backs it up.
    !(wallDuration <= MAX_BOOKING_DAYS * DAY_MS) ||
    end - start > (MAX_BOOKING_DAYS + 1) * DAY_MS
  ) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: message('durationTooLong') });
  }
}

const instant = z.iso.datetime(message('dateInvalid'));
const coordinate = (limit: number) =>
  z.coerce
    .number(message('invalid'))
    .min(-limit, message('invalid'))
    .max(limit, message('invalid'));

export const ParkingSearchQuerySchema = z
  .object({
    area: z.enum(AREA_IDS, message('invalid')).optional(),
    latitude: coordinate(90).optional(),
    longitude: coordinate(180).optional(),
    start: instant,
    end: instant,
  })
  .superRefine((query, ctx) => {
    const hasPosition = query.latitude !== undefined && query.longitude !== undefined;
    if (!query.area && !hasPosition) {
      ctx.addIssue({ code: 'custom', path: ['area'], message: message('locationRequired') });
    }
    checkWindow(query, ctx);
  });
export type ParkingSearchQuery = z.infer<typeof ParkingSearchQuerySchema>;

/** Optional window on a listing page: both ends or neither. */
export const ParkingListingQuerySchema = z
  .object({ start: instant.optional(), end: instant.optional() })
  .superRefine((query, ctx) => {
    if (Boolean(query.start) !== Boolean(query.end)) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: message('invalid') });
    }
    checkWindow(query, ctx);
  });
export type ParkingListingQuery = z.infer<typeof ParkingListingQuerySchema>;

/** Widths each photo is stored at; pages pick one with `srcset`. */
export const PHOTO_WIDTHS = [480, 960, 1600] as const;

export const ListingPhotoSchema = z
  .object({
    /** Content hash: names the stored files, so they can be cached for ever. */
    key: z.string().regex(/^[0-9a-f]{32}$/),
    /** Size of the largest stored file. */
    width: z.int().positive(),
    height: z.int().positive(),
    /** Text alternative in the listing's language; null falls back to a generated one. */
    alt: z.string().nullable(),
    /** Dominant colour, painted while the photo loads. */
    color: z.string().regex(/^#[0-9a-f]{6}$/),
  })
  .register(contractsRegistry, { id: 'ListingPhoto' });
export type ListingPhoto = z.infer<typeof ListingPhotoSchema>;

/** Where the browser finds a stored photo: same origin, so the CSP stays as it is. */
export function photoUrl(key: string, width: (typeof PHOTO_WIDTHS)[number]): string {
  return `/api/v1/media/photos/${key}/${width}.webp`;
}

export const ParkingListingSummarySchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    address: z.string(),
    area: AreaIdSchema,
    /** Language the owner wrote name, address and description in (mark up with `lang`). */
    contentLocale: LocaleSchema,
    /** The listing's rate, or the cheapest space's when `spacePricesVary`. */
    hourlyRate: MoneySchema,
    /** Most a single day (24 h) can cost, if the owner caps it. */
    dailyMax: MoneySchema.nullable(),
    /** Spaces cost different amounts, so prices read "from". */
    spacePricesVary: z.boolean(),
    features: z.array(ParkingFeatureSchema),
    spaceCount: z.int().nonnegative(),
    coverPhoto: ListingPhotoSchema.nullable(),
  })
  .register(contractsRegistry, { id: 'ParkingListingSummary' });
export type ParkingListingSummary = z.infer<typeof ParkingListingSummarySchema>;

export const FeaturedParkingResponseSchema = z
  .object({ listings: z.array(ParkingListingSummarySchema) })
  .register(contractsRegistry, { id: 'FeaturedParkingResponse' });
export type FeaturedParkingResponse = z.infer<typeof FeaturedParkingResponseSchema>;

export const ParkingSearchResultSchema = ParkingListingSummarySchema.extend({
  distanceMeters: z.int().nonnegative(),
  /** Spaces free for the whole window. */
  freeSpaces: z.int().nonnegative(),
  /** For the cheapest free space. */
  total: MoneySchema,
}).register(contractsRegistry, { id: 'ParkingSearchResult' });
export type ParkingSearchResult = z.infer<typeof ParkingSearchResultSchema>;

export const ParkingSearchResponseSchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    results: z.array(ParkingSearchResultSchema),
  })
  .register(contractsRegistry, { id: 'ParkingSearchResponse' });
export type ParkingSearchResponse = z.infer<typeof ParkingSearchResponseSchema>;

const WALL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export const OpeningPeriodSchema = z
  .object({
    /** ISO weekday: Monday = 1 … Sunday = 7. */
    weekday: z.int().min(1).max(7),
    /** Local wall time `HH:MM` in the listing's time zone. */
    opens: z.string().regex(WALL_TIME),
    /** `24:00` means midnight at the end of the day. */
    closes: z.string().regex(WALL_TIME),
  })
  .register(contractsRegistry, { id: 'OpeningPeriod' });
export type OpeningPeriod = z.infer<typeof OpeningPeriodSchema>;

/**
 * Days, both ends included, that keep other hours than the week's, on the listing's wall clock.
 * With `hours`, open `[opens, closes)` each day instead of the week's hours. With `closedHours`,
 * the week's hours less `[from, to)`. With neither, closed all day. Never both.
 */
export const HoursExceptionSchema = z
  .object({
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    hours: z
      .object({ opens: z.string().regex(WALL_TIME), closes: z.string().regex(WALL_TIME) })
      .nullable(),
    closedHours: z
      .object({ from: z.string().regex(WALL_TIME), to: z.string().regex(WALL_TIME) })
      .nullable(),
  })
  .register(contractsRegistry, { id: 'HoursException' });
export type HoursException = z.infer<typeof HoursExceptionSchema>;

export const ParkingSpaceSchema = z
  .object({
    label: z.string(),
    features: z.array(ParkingFeatureSchema),
    hourlyRate: MoneySchema,
    /** For this space and the requested window; null when the request named none. */
    total: MoneySchema.nullable(),
  })
  .register(contractsRegistry, { id: 'ParkingSpace' });
export type ParkingSpace = z.infer<typeof ParkingSpaceSchema>;

export const ParkingAvailabilitySchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    /** Open for the whole window. */
    open: z.boolean(),
    freeSpaces: z.int().nonnegative(),
    /** For the cheapest free space. */
    total: MoneySchema,
  })
  .register(contractsRegistry, { id: 'ParkingAvailability' });
export type ParkingAvailability = z.infer<typeof ParkingAvailabilitySchema>;

export const CANCELLATION_POLICIES = ['oneHour', 'oneDay', 'oneDayThenHalf'] as const;
export const CancellationPolicySchema = z.enum(CANCELLATION_POLICIES).register(contractsRegistry, {
  id: 'CancellationPolicy',
  description:
    'oneHour: full refund until 1 hour before the start. oneDay: until 24 hours before. ' +
    'oneDayThenHalf: full refund until 24 hours before, 50% until the start.',
});
export type CancellationPolicy = z.infer<typeof CancellationPolicySchema>;

/** Prices on top of the hourly rate, for drivers to read. Space prices scale all of them. */
export const ListingPriceRulesSchema = z
  .object({
    weekendRate: MoneySchema.nullable(),
    night: z.object({ rate: MoneySchema, from: z.string(), to: z.string() }).nullable(),
    /** Dated prices that have not ended yet. */
    dated: z.array(z.object({ startsOn: z.iso.date(), endsOn: z.iso.date(), rate: MoneySchema })),
    longStay: z.array(z.object({ minDays: z.int().positive(), percent: z.int().positive() })),
  })
  .register(contractsRegistry, { id: 'ListingPriceRules' });
export type ListingPriceRules = z.infer<typeof ListingPriceRulesSchema>;

/** Big garages have hundreds of spaces, and drivers don't pick one until booking. */
export const LISTING_SPACES_LIMIT = 48;

export const ParkingListingDetailSchema = ParkingListingSummarySchema.extend({
  description: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  timeZone: z.string(),
  openingHours: z.array(OpeningPeriodSchema),
  /** Closures and special hours that have not ended, soonest first. The owner's notes stay out. */
  hoursExceptions: z.array(HoursExceptionSchema),
  /** The first spaces in label order; `spaceCount` says how many there are in all. */
  spaces: z.array(ParkingSpaceSchema).max(LISTING_SPACES_LIMIT),
  photos: z.array(ListingPhotoSchema),
  priceRules: ListingPriceRulesSchema,
  cancellationPolicy: CancellationPolicySchema.nullable(),
  /** Present when the request named a window. */
  availability: ParkingAvailabilitySchema.nullable(),
}).register(contractsRegistry, { id: 'ParkingListingDetail' });
export type ParkingListingDetail = z.infer<typeof ParkingListingDetailSchema>;
