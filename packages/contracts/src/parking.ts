import { z } from 'zod';
import { AREA_IDS, AreaIdSchema } from './areas.js';
import { DEFAULT_TIME_ZONE, LocaleSchema } from './i18n.js';
import { contractsRegistry } from './registry.js';
import { wallClockMs } from './time.js';
import { message } from './validation.js';

/** Bookings and searches move in half-hour steps. Athens' UTC offset is whole hours, so
 * local :00/:30 boundaries are UTC :00/:30 boundaries too. */
export const BOOKING_STEP_MINUTES = 30;
export const MIN_BOOKING_MINUTES = 30;
export const MAX_BOOKING_DAYS = 30;
/** How far ahead a stay may start. Also keeps every date the API walks within year 9999. */
export const MAX_START_AHEAD_DAYS = 365;
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

export const ParkingListingSummarySchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    address: z.string(),
    area: AreaIdSchema,
    /** Language the owner wrote name, address and description in (mark up with `lang`). */
    contentLocale: LocaleSchema,
    hourlyRate: MoneySchema,
    /** Most a single day (24 h) can cost, if the owner caps it. */
    dailyMax: MoneySchema.nullable(),
    features: z.array(ParkingFeatureSchema),
    spaceCount: z.int().nonnegative(),
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

export const ParkingSpaceSchema = z
  .object({ label: z.string(), features: z.array(ParkingFeatureSchema) })
  .register(contractsRegistry, { id: 'ParkingSpace' });
export type ParkingSpace = z.infer<typeof ParkingSpaceSchema>;

export const ParkingAvailabilitySchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    /** Open for the whole window. */
    open: z.boolean(),
    freeSpaces: z.int().nonnegative(),
    total: MoneySchema,
  })
  .register(contractsRegistry, { id: 'ParkingAvailability' });
export type ParkingAvailability = z.infer<typeof ParkingAvailabilitySchema>;

export const ParkingListingDetailSchema = ParkingListingSummarySchema.extend({
  description: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  timeZone: z.string(),
  openingHours: z.array(OpeningPeriodSchema),
  spaces: z.array(ParkingSpaceSchema),
  /** Present when the request named a window. */
  availability: ParkingAvailabilitySchema.nullable(),
}).register(contractsRegistry, { id: 'ParkingListingDetail' });
export type ParkingListingDetail = z.infer<typeof ParkingListingDetailSchema>;
