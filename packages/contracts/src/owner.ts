import { z } from 'zod';
import { AREA_IDS, AreaIdSchema } from './areas.js';
import { DEFAULT_TIME_ZONE, LocaleSchema } from './i18n.js';
import {
  BOOKING_STEP_MINUTES,
  CANCELLATION_POLICIES,
  CancellationPolicySchema,
  HoursExceptionSchema,
  LISTING_LIMITS,
  ListingPhotoSchema,
  ListingStatusSchema,
  OpeningPeriodSchema,
  PARKING_FEATURES,
  ParkingFeatureSchema,
  type OpeningPeriod,
} from './parking.js';
import { contractsRegistry } from './registry.js';
import { addDays, zonedParts } from './time.js';
import {
  HOURS_EXCEPTION_AHEAD_DAYS,
  HOURS_EXCEPTIONS_MAX,
  MAX_BOOKING_DAYS,
  message,
  type ValidationMessage,
} from './validation.js';

export const OWNER_KINDS = ['individual', 'business'] as const;
export const OwnerKindSchema = z.enum(OWNER_KINDS).register(contractsRegistry, { id: 'OwnerKind' });
export type OwnerKind = z.infer<typeof OwnerKindSchema>;

export const OWNER_VERIFICATION_STATES = ['unverified', 'pending', 'verified', 'rejected'] as const;
export const OwnerVerificationSchema = z
  .enum(OWNER_VERIFICATION_STATES)
  .register(contractsRegistry, { id: 'OwnerVerification' });

/** Member states an owner can live in or pay tax in. Tax numbers are checked for Greece only. */
export const EU_COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
] as const;
export const DEFAULT_COUNTRY = 'GR';
export const OwnerCountrySchema = z
  .enum(EU_COUNTRIES)
  .register(contractsRegistry, { id: 'OwnerCountry' });
export type OwnerCountry = z.infer<typeof OwnerCountrySchema>;

export const OWNER_LIMITS = {
  name: 100,
  legalName: 200,
  addressLine: 200,
  city: 100,
  postalCode: 12,
  phone: 20,
  taxId: 20,
  vatId: 20,
  registrationNumber: 30,
  landRegistrationNumber: 30,
  reviewNote: 2000,
} as const;

const PHONE = /^\+?[0-9][0-9 ()-]{5,18}[0-9]$/;
const POSTAL_CODE = /^[0-9A-Za-z][0-9A-Za-z -]{1,10}[0-9A-Za-z]$/;
const TAX_NUMBER = /^[0-9A-Za-z][0-9A-Za-z./ -]*$/;

/** A tax number as stored and checked: what people type between the digits is gone. */
export function normalizeTaxNumber(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase();
}

/** Greek tax number (ΑΦΜ): nine digits, the last a check digit over the other eight. */
export function isValidAfm(value: string): boolean {
  if (!/^\d{9}$/.test(value) || /^0+$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 8).reduce((total, digit, i) => total + digit * 2 ** (8 - i), 0);
  return (sum % 11) % 10 === digits[8];
}

/** Whether someone born on `date` (`YYYY-MM-DD`) is 18 or over on `today`. */
export function isAdult(date: string, today: Date = new Date()): boolean {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Date.UTC(year + 18, month - 1, day) <= today.getTime();
}

const CONTROL_CHARACTERS = /^[^\p{Cc}\p{Cs}]*$/u;
const CONTROL_EXCEPT_LINES = /^(?:[^\p{Cc}\p{Cs}]|[\t\n\r])*$/u;

/** Postgres refuses NUL, and a 500 for a stray character helps nobody: it never gets that far. */
const trimmed = () => z.string().trim().regex(CONTROL_CHARACTERS, message('invalid'));
/** The same for longer text, where a line break is a line break. */
const trimmedLines = () => z.string().trim().regex(CONTROL_EXCEPT_LINES, message('invalid'));
/** An empty field clears the saved value, so a half-done step can be corrected. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? null : value), schema.nullable());

const ownerFields = {
  kind: z.enum(OWNER_KINDS, message('ownerKindRequired')),
  firstName: trimmed().min(1, message('firstNameRequired')).max(OWNER_LIMITS.name, 'textTooLong'),
  lastName: trimmed().min(1, message('lastNameRequired')).max(OWNER_LIMITS.name, 'textTooLong'),
  legalName: trimmed()
    .min(1, message('legalNameRequired'))
    .max(OWNER_LIMITS.legalName, message('textTooLong')),
  phone: trimmed().regex(PHONE, message('phoneInvalid')),
  addressLine: trimmed()
    .min(1, message('addressRequired'))
    .max(OWNER_LIMITS.addressLine, message('textTooLong')),
  city: trimmed().min(1, message('cityRequired')).max(OWNER_LIMITS.city, message('textTooLong')),
  postalCode: trimmed().regex(POSTAL_CODE, message('postalCodeInvalid')),
  country: z.enum(EU_COUNTRIES, message('countryRequired')),
};

/** What finishes the "About you" step. Individuals give a name, businesses a legal name. */
export const OwnerProfileInputSchema = z
  .object({
    kind: ownerFields.kind,
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    legalName: z.string().nullish(),
    phone: ownerFields.phone,
    addressLine: ownerFields.addressLine,
    city: ownerFields.city,
    postalCode: ownerFields.postalCode,
    country: ownerFields.country,
  })
  .superRefine((profile, ctx) => {
    const required = (field: 'firstName' | 'lastName' | 'legalName') => {
      const result = ownerFields[field].safeParse(profile[field] ?? '');
      if (result.success) return;
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', path: [field], message: issue.message });
      }
    };
    if (profile.kind === 'business') required('legalName');
    else {
      required('firstName');
      required('lastName');
    }
  })
  .register(contractsRegistry, { id: 'OwnerProfileInput' });
export type OwnerProfileInput = z.infer<typeof OwnerProfileInputSchema>;

/** What a save may carry while the step is half done: valid fields, any number of them. */
export const OwnerProfilePatchSchema = z
  .object({
    kind: ownerFields.kind.optional(),
    firstName: clearable(ownerFields.firstName).optional(),
    lastName: clearable(ownerFields.lastName).optional(),
    legalName: clearable(ownerFields.legalName).optional(),
    phone: clearable(ownerFields.phone).optional(),
    addressLine: clearable(ownerFields.addressLine).optional(),
    city: clearable(ownerFields.city).optional(),
    postalCode: clearable(ownerFields.postalCode).optional(),
    country: ownerFields.country.optional(),
  })
  .strict()
  .register(contractsRegistry, { id: 'OwnerProfilePatch' });
export type OwnerProfilePatch = z.infer<typeof OwnerProfilePatchSchema>;

const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/**
 * Tax details. Saved values never come back to the browser, so a field left empty keeps what
 * is stored and the API works out what is still missing. `birthDate` is for individuals and
 * `registrationNumber` for businesses, which the stored kind decides.
 */
export const OwnerTaxInputSchema = z
  .object({
    taxCountry: z.enum(EU_COUNTRIES, message('countryRequired')),
    taxId: optionalText(
      trimmed().max(OWNER_LIMITS.taxId, message('taxIdInvalid')).regex(TAX_NUMBER, 'taxIdInvalid'),
    ),
    vatId: optionalText(
      trimmed().max(OWNER_LIMITS.vatId, message('vatIdInvalid')).regex(TAX_NUMBER, 'vatIdInvalid'),
    ),
    registrationNumber: optionalText(
      trimmed()
        .max(OWNER_LIMITS.registrationNumber, message('registrationRequired'))
        .regex(TAX_NUMBER, 'registrationRequired'),
    ),
    birthDate: optionalText(z.iso.date(message('birthDateInvalid'))),
  })
  .strict()
  .superRefine((tax, ctx) => {
    if (tax.taxId && tax.taxCountry === 'GR') {
      if (!isValidAfm(normalizeTaxNumber(tax.taxId))) {
        ctx.addIssue({ code: 'custom', path: ['taxId'], message: message('afmInvalid') });
      }
    }
    if (tax.birthDate && !isAdult(tax.birthDate)) {
      ctx.addIssue({ code: 'custom', path: ['birthDate'], message: message('birthDateUnderage') });
    }
  })
  .register(contractsRegistry, { id: 'OwnerTaxInput' });
export type OwnerTaxInput = z.infer<typeof OwnerTaxInputSchema>;

/** Tax values are write-only: the page gets their last digits and whether they are saved. */
export const OwnerTaxSummarySchema = z
  .object({
    taxCountry: OwnerCountrySchema,
    taxIdEnding: z.string().nullable(),
    vatIdEnding: z.string().nullable(),
    registrationEnding: z.string().nullable(),
    birthDateSaved: z.boolean(),
  })
  .register(contractsRegistry, { id: 'OwnerTaxSummary' });
export type OwnerTaxSummary = z.infer<typeof OwnerTaxSummarySchema>;

export const OwnerProfileSchema = z
  .object({
    kind: OwnerKindSchema.nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    legalName: z.string().nullable(),
    phone: z.string().nullable(),
    addressLine: z.string().nullable(),
    city: z.string().nullable(),
    postalCode: z.string().nullable(),
    country: OwnerCountrySchema,
    verification: OwnerVerificationSchema,
    tax: OwnerTaxSummarySchema,
  })
  .register(contractsRegistry, { id: 'OwnerProfile' });
export type OwnerProfile = z.infer<typeof OwnerProfileSchema>;

/** Greece, generously: a pin outside it is a slip, and search only covers Greek areas. */
export const GREECE_BOUNDS = { south: 34.5, north: 41.8, west: 19.2, east: 29.7 } as const;

const inGreece = ({ latitude, longitude }: { latitude: number; longitude: number }) =>
  latitude >= GREECE_BOUNDS.south &&
  latitude <= GREECE_BOUNDS.north &&
  longitude >= GREECE_BOUNDS.west &&
  longitude <= GREECE_BOUNDS.east;

const locationFields = {
  name: trimmed()
    .min(1, message('listingNameRequired'))
    .max(LISTING_LIMITS.name, message('textTooLong')),
  address: trimmed()
    .min(1, message('addressRequired'))
    .max(LISTING_LIMITS.address, message('textTooLong')),
  areaId: z.enum(AREA_IDS, message('areaRequired')),
  latitude: z.number(message('pinRequired')).min(-90).max(90),
  longitude: z.number(message('pinRequired')).min(-180).max(180),
  description: trimmedLines().max(LISTING_LIMITS.description, message('textTooLong')),
  contentLocale: LocaleSchema,
};

/** What finishes the location step. */
export const ListingLocationInputSchema = z
  .object({
    name: locationFields.name,
    address: locationFields.address,
    areaId: locationFields.areaId,
    latitude: locationFields.latitude,
    longitude: locationFields.longitude,
    description: locationFields.description.nullish(),
    contentLocale: locationFields.contentLocale,
  })
  .superRefine((location, ctx) => {
    if (!inGreece(location)) {
      ctx.addIssue({ code: 'custom', path: ['latitude'], message: message('outsideGreece') });
    }
  })
  .register(contractsRegistry, { id: 'ListingLocationInput' });
export type ListingLocationInput = z.infer<typeof ListingLocationInputSchema>;

export const ListingLocationPatchSchema = z
  .object({
    name: clearable(locationFields.name).optional(),
    address: clearable(locationFields.address).optional(),
    areaId: clearable(locationFields.areaId).optional(),
    /** Both or neither: half a point is no point. */
    latitude: locationFields.latitude.nullish(),
    longitude: locationFields.longitude.nullish(),
    description: clearable(locationFields.description).optional(),
    contentLocale: locationFields.contentLocale.optional(),
  })
  .strict()
  .superRefine((patch, ctx) => {
    if ((patch.latitude === undefined) !== (patch.longitude === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['latitude'], message: message('pinRequired') });
    }
    if (typeof patch.latitude === 'number' && typeof patch.longitude === 'number') {
      if (!inGreece({ latitude: patch.latitude, longitude: patch.longitude })) {
        ctx.addIssue({ code: 'custom', path: ['latitude'], message: message('outsideGreece') });
      }
    }
  })
  .register(contractsRegistry, { id: 'ListingLocationPatch' });
export type ListingLocationPatch = z.infer<typeof ListingLocationPatchSchema>;

/** Money an owner may enter, per hour or per day: 10 cents to 1,000 euros. */
export const RATE_LIMITS = { minMinor: 10, maxMinor: 100_000 } as const;
const rate = z
  .int(message('rateInvalid'))
  .min(RATE_LIMITS.minMinor, message('rateInvalid'))
  .max(RATE_LIMITS.maxMinor, message('rateInvalid'));

/** Largest garage the form handles; the demand so far is far below it. */
export const LISTING_SPACES_MAX = 500;

export const ListingSpaceInputSchema = z
  .object({
    label: trimmed()
      .min(1, message('spaceLabelRequired'))
      .max(LISTING_LIMITS.spaceLabel, message('textTooLong')),
    features: z.array(ParkingFeatureSchema).max(PARKING_FEATURES.length),
    /** This space's own hourly rate; null uses the listing's. */
    hourlyRateMinor: rate.nullable(),
  })
  .register(contractsRegistry, { id: 'ListingSpaceInput' });
export type ListingSpaceInput = z.infer<typeof ListingSpaceInputSchema>;

export const ListingSpacesInputSchema = z
  .object({
    spaces: z
      .array(ListingSpaceInputSchema)
      .min(1, message('spacesRequired'))
      .max(LISTING_SPACES_MAX, message('tooManySpaces')),
  })
  .superRefine(({ spaces }, ctx) => {
    const seen = new Set<string>();
    spaces.forEach(({ label }, index) => {
      const key = label.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['spaces', index, 'label'],
          message: message('spaceLabelDuplicate'),
        });
      }
      seen.add(key);
    });
  })
  .register(contractsRegistry, { id: 'ListingSpacesInput' });
export type ListingSpacesInput = z.infer<typeof ListingSpacesInputSchema>;

/** `HH:MM` as minutes after midnight; `24:00` is 1440. */
export function wallMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * `[opens, closes)` per day: at most three, which is a day with a break (decision #28) whose
 * small hours belong to the night before.
 */
export const OPENING_PERIODS_MAX = 7 * 3;

export function checkOpeningPeriods(periods: OpeningPeriod[], ctx: z.RefinementCtx): void {
  const byDay = new Map<number, [number, number][]>();
  periods.forEach((period, index) => {
    const opens = wallMinutes(period.opens);
    const closes = wallMinutes(period.closes);
    const path = ['periods', index, 'closes'];
    if (opens % BOOKING_STEP_MINUTES !== 0 || closes % BOOKING_STEP_MINUTES !== 0) {
      ctx.addIssue({ code: 'custom', path, message: message('timeNotOnStep') });
    } else if (opens >= closes) {
      ctx.addIssue({ code: 'custom', path, message: message('hoursOrder') });
    } else {
      const day = byDay.get(period.weekday) ?? [];
      if (day.some(([from, to]) => opens < to && from < closes)) {
        ctx.addIssue({ code: 'custom', path, message: message('hoursOverlap') });
      }
      day.push([opens, closes]);
      byDay.set(period.weekday, day);
    }
  });
}

export const ListingHoursInputSchema = z
  .object({
    periods: z
      .array(OpeningPeriodSchema)
      .min(1, message('hoursRequired'))
      .max(OPENING_PERIODS_MAX, message('hoursRequired')),
  })
  .superRefine(({ periods }, ctx) => checkOpeningPeriods(periods, ctx))
  .register(contractsRegistry, { id: 'ListingHoursInput' });
export type ListingHoursInput = z.infer<typeof ListingHoursInputSchema>;

export const BOOKING_GAPS = [0, 30, 60] as const;
export type BookingGap = (typeof BOOKING_GAPS)[number];

export const DATED_PRICES_MAX = 20;
export const LONG_STAY_DISCOUNTS_MAX = 3;
export const DISCOUNT_LIMITS = { minPercent: 1, maxPercent: 90 } as const;
export const PRICE_LABEL_MAX = 80;

const HALF_HOUR = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const halfHour = z.string().regex(HALF_HOUR, message('timeNotOnStep'));

const DatedPriceSchema = z.object({
  /** The owner's own reminder, e.g. a festival; drivers don't see it. */
  label: trimmed().max(PRICE_LABEL_MAX, message('textTooLong')).nullable(),
  startsOn: z.iso.date(message('dateRangeInvalid')),
  endsOn: z.iso.date(message('dateRangeInvalid')),
  rateMinor: rate,
});

const LongStaySchema = z.object({
  minDays: z
    .int(message('discountInvalid'))
    .min(1, message('discountInvalid'))
    .max(MAX_BOOKING_DAYS, message('discountInvalid')),
  percent: z
    .int(message('discountInvalid'))
    .min(DISCOUNT_LIMITS.minPercent, message('discountInvalid'))
    .max(DISCOUNT_LIMITS.maxPercent, message('discountInvalid')),
});

export const ListingPricesInputSchema = z
  .object({
    hourlyRateMinor: rate,
    dailyMaxMinor: rate.nullable(),
    bookingGapMinutes: z.literal(BOOKING_GAPS, message('invalid')),
    cancellationPolicy: z.enum(CANCELLATION_POLICIES, message('policyRequired')),
    weekendRateMinor: rate.nullable(),
    night: z.object({ rateMinor: rate, from: halfHour, to: halfHour }).nullable(),
    datedPrices: z.array(DatedPriceSchema).max(DATED_PRICES_MAX, message('invalid')),
    longStayDiscounts: z.array(LongStaySchema).max(LONG_STAY_DISCOUNTS_MAX, message('invalid')),
  })
  .superRefine((prices, ctx) => {
    if (prices.dailyMaxMinor !== null && prices.dailyMaxMinor < prices.hourlyRateMinor) {
      ctx.addIssue({
        code: 'custom',
        path: ['dailyMaxMinor'],
        message: message('dailyMaxBelowRate'),
      });
    }
    if (prices.night && prices.night.from === prices.night.to) {
      ctx.addIssue({ code: 'custom', path: ['night'], message: message('nightWindowInvalid') });
    }
    const ranges = prices.datedPrices.toSorted((a, b) => a.startsOn.localeCompare(b.startsOn));
    prices.datedPrices.forEach(({ startsOn, endsOn }, index) => {
      if (endsOn < startsOn) {
        ctx.addIssue({
          code: 'custom',
          path: ['datedPrices', index, 'endsOn'],
          message: message('dateRangeInvalid'),
        });
      }
    });
    ranges.forEach((range, index) => {
      const next = ranges[index + 1];
      if (next && next.startsOn <= range.endsOn) {
        ctx.addIssue({
          code: 'custom',
          path: ['datedPrices', prices.datedPrices.indexOf(next), 'startsOn'],
          message: message('datedOverlap'),
        });
      }
    });
    const days = new Set<number>();
    prices.longStayDiscounts.forEach(({ minDays }, index) => {
      if (days.has(minDays)) {
        ctx.addIssue({
          code: 'custom',
          path: ['longStayDiscounts', index, 'minDays'],
          message: message('discountDuplicate'),
        });
      }
      days.add(minDays);
    });
  })
  .register(contractsRegistry, { id: 'ListingPricesInput' });
export type ListingPricesInput = z.infer<typeof ListingPricesInputSchema>;

export const HOURS_EXCEPTION_LABEL_MAX = 80;

const CLOSING_TIME = /^(?:[01]\d|2[0-3]):(?:00|30)$|^24:00$/;
/** Only real days are compared: a field that failed its own check has already said so. */
const isoDate = z.iso.date();
const isDate = (value: unknown) => isoDate.safeParse(value).success;

const HoursExceptionInputSchema = z.object({
  /** The owner's own reminder, e.g. a holiday; drivers never see it. */
  label: trimmed().max(HOURS_EXCEPTION_LABEL_MAX, message('textTooLong')).nullable(),
  startsOn: z.iso.date(message('dateRequired')),
  endsOn: z.iso.date(message('dateRequired')),
  /** Open these hours each day instead of the week's, ending by midnight. */
  hours: z
    .object({ opens: halfHour, closes: z.string().regex(CLOSING_TIME, message('timeNotOnStep')) })
    .nullable(),
  /** Or closed for this part of each day, the week's hours around it (decision #28). */
  closedHours: z
    .object({ from: halfHour, to: z.string().regex(CLOSING_TIME, message('timeNotOnStep')) })
    .nullable(),
});

/**
 * Closures and special hours, all of them at once: what is sent replaces what is stored. An entry
 * that has ended is refused rather than kept, because the owner never sees one again.
 */
export const ListingHoursExceptionsInputSchema = z
  .object({
    exceptions: z.array(HoursExceptionInputSchema).max(HOURS_EXCEPTIONS_MAX, message('invalid')),
  })
  .strict()
  .superRefine(({ exceptions }, ctx) => {
    // Refinements run even when a field failed its own check.
    if (!Array.isArray(exceptions)) return;
    const today = zonedParts(new Date(), DEFAULT_TIME_ZONE).date;
    const latest = addDays(today, HOURS_EXCEPTION_AHEAD_DAYS);
    // An entry still running comes back with every save, so its first day may be long gone: as
    // far back as one saved on the last day it could reach. Earlier than that is a slip (year 1).
    const earliest = addDays(today, -2 * HOURS_EXCEPTION_AHEAD_DAYS);
    const issue = (path: (string | number)[], key: ValidationMessage) =>
      ctx.addIssue({ code: 'custom', path: ['exceptions', ...path], message: message(key) });

    const ranges: { index: number; startsOn: string; endsOn: string }[] = [];
    exceptions.forEach(({ startsOn, endsOn, hours, closedHours }, index) => {
      if (hours && wallMinutes(hours.opens) >= wallMinutes(hours.closes)) {
        issue([index, 'hours', 'closes'], 'hoursOrder');
      }
      if (closedHours && wallMinutes(closedHours.from) >= wallMinutes(closedHours.to)) {
        issue([index, 'closedHours', 'to'], 'closedTimeOrder');
      }
      // Other hours and a closed part of the week's are two answers for one day.
      if (hours && closedHours) issue([index, 'closedHours'], 'invalid');
      if (!isDate(startsOn) || !isDate(endsOn)) return;
      if (endsOn < startsOn) issue([index, 'endsOn'], 'lastDayBeforeFirst');
      else if (startsOn < earliest) issue([index, 'startsOn'], 'dateInPast');
      else if (endsOn < today) issue([index, 'endsOn'], 'dateInPast');
      else if (endsOn > latest) issue([index, 'endsOn'], 'dateTooFar');
      else ranges.push({ index, startsOn, endsOn });
    });
    // Against the furthest end so far, so a long range overlapping two short ones names both.
    let reached = '';
    for (const range of ranges.toSorted((a, b) => a.startsOn.localeCompare(b.startsOn))) {
      if (range.startsOn <= reached) issue([range.index, 'startsOn'], 'exceptionOverlap');
      if (range.endsOn > reached) reached = range.endsOn;
    }
  })
  .register(contractsRegistry, { id: 'ListingHoursExceptionsInput' });
export type ListingHoursExceptionsInput = z.infer<typeof ListingHoursExceptionsInputSchema>;

/** Enough for a chain of garages, and a ceiling on what one account can make us store. */
export const OWNER_LISTINGS_MAX = 50;

/** The owner's other listings that get this one's closures and special hours (decision #29). */
export const ListingHoursExceptionsCopyInputSchema = z
  .object({
    to: z
      .array(z.uuid(message('invalid')))
      .min(1, message('invalid'))
      .max(OWNER_LISTINGS_MAX, message('invalid'))
      .refine((ids) => new Set(ids).size === ids.length, message('invalid')),
  })
  .strict()
  .register(contractsRegistry, { id: 'ListingHoursExceptionsCopyInput' });
export type ListingHoursExceptionsCopyInput = z.infer<typeof ListingHoursExceptionsCopyInputSchema>;

/**
 * What became of each listing: `copied` (entries it already had count as copied), `clash` (it has
 * other hours on one of those days, so nothing was added) or `full` (no room for them all).
 */
export const HOURS_EXCEPTIONS_COPY_OUTCOMES = ['copied', 'clash', 'full'] as const;
export const OwnerHoursExceptionsCopySchema = z
  .object({
    results: z.array(z.object({ id: z.uuid(), outcome: z.enum(HOURS_EXCEPTIONS_COPY_OUTCOMES) })),
  })
  .register(contractsRegistry, { id: 'OwnerHoursExceptionsCopy' });
export type OwnerHoursExceptionsCopy = z.infer<typeof OwnerHoursExceptionsCopySchema>;

export const OwnerHoursExceptionSchema = HoursExceptionSchema.extend({
  label: z.string().nullable(),
}).register(contractsRegistry, { id: 'OwnerHoursException' });
export type OwnerHoursException = z.infer<typeof OwnerHoursExceptionSchema>;

export const OwnerHoursExceptionsSchema = z
  .object({ exceptions: z.array(OwnerHoursExceptionSchema) })
  .register(contractsRegistry, { id: 'OwnerHoursExceptions' });
export type OwnerHoursExceptions = z.infer<typeof OwnerHoursExceptionsSchema>;

export const PHOTO_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  /** Narrower photos would look soft on the listing page. */
  minWidth: 960,
  maxPerListing: 10,
  alt: 160,
} as const;
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const ListingPhotoUpdateSchema = z
  .object({ alt: clearable(trimmed().max(PHOTO_LIMITS.alt, message('textTooLong'))) })
  .strict()
  .register(contractsRegistry, { id: 'ListingPhotoUpdate' });
export type ListingPhotoUpdate = z.infer<typeof ListingPhotoUpdateSchema>;

export const ListingPhotoOrderSchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(PHOTO_LIMITS.maxPerListing) })
  .strict()
  .register(contractsRegistry, { id: 'ListingPhotoOrder' });
export type ListingPhotoOrder = z.infer<typeof ListingPhotoOrderSchema>;

export const OwnerPhotoSchema = ListingPhotoSchema.extend({ id: z.uuid() }).register(
  contractsRegistry,
  { id: 'OwnerPhoto' },
);
export type OwnerPhoto = z.infer<typeof OwnerPhotoSchema>;

export const PROOF_KINDS = ['titleDeed', 'lease', 'operatingLicence', 'other'] as const;
export const ProofKindSchema = z.enum(PROOF_KINDS).register(contractsRegistry, { id: 'ProofKind' });
export type ProofKind = z.infer<typeof ProofKindSchema>;

export const PROOF_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxPerListing: 5,
  fileName: 200,
} as const;
export const PROOF_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export const OwnerProofSchema = z
  .object({
    id: z.uuid(),
    kind: ProofKindSchema,
    fileName: z.string(),
    contentType: z.enum(PROOF_CONTENT_TYPES),
    sizeBytes: z.int().positive(),
    createdAt: z.iso.datetime(),
  })
  .register(contractsRegistry, { id: 'OwnerProof' });
export type OwnerProof = z.infer<typeof OwnerProofSchema>;

export const ProofUploadQuerySchema = z.object({ kind: z.enum(PROOF_KINDS, message('invalid')) });

export const ListingProofPatchSchema = z
  .object({
    landRegistrationNumber: clearable(
      trimmed()
        .max(OWNER_LIMITS.landRegistrationNumber, message('landRegistrationInvalid'))
        .regex(TAX_NUMBER, message('landRegistrationInvalid')),
    ),
  })
  .strict()
  .register(contractsRegistry, { id: 'ListingProofPatch' });
export type ListingProofPatch = z.infer<typeof ListingProofPatchSchema>;

export const ListingSubmitInputSchema = z
  .object({ confirmed: z.literal(true, message('confirmRequired')) })
  .strict()
  .register(contractsRegistry, { id: 'ListingSubmitInput' });
export type ListingSubmitInput = z.infer<typeof ListingSubmitInputSchema>;

/** One account, whatever its number of listings. */
export const ACCOUNT_STEPS = ['profile', 'tax'] as const;
export const AccountStepSchema = z
  .enum(ACCOUNT_STEPS)
  .register(contractsRegistry, { id: 'AccountStep' });
export type AccountStep = z.infer<typeof AccountStepSchema>;

/** Each listing, in the order the checklist shows them. `review` sends it to staff. */
export const LISTING_STEPS = [
  'location',
  'spaces',
  'hours',
  'prices',
  'photos',
  'proof',
  'review',
] as const;
export const ListingStepSchema = z
  .enum(LISTING_STEPS)
  .register(contractsRegistry, { id: 'ListingStep' });
export type ListingStep = z.infer<typeof ListingStepSchema>;

/** Steps that make up each milestone on the dashboard. */
export const LISTING_MILESTONES = [
  { id: 'place', steps: ['location', 'spaces', 'hours'] },
  { id: 'prices', steps: ['prices'] },
  { id: 'trust', steps: ['photos', 'proof'] },
  { id: 'submit', steps: ['review'] },
] as const satisfies readonly { id: string; steps: readonly ListingStep[] }[];

export const OwnerListingProgressSchema = z
  .object({
    id: z.uuid(),
    name: z.string().nullable(),
    /** Language the owner writes in, for marking up `name`. */
    contentLocale: LocaleSchema,
    status: ListingStatusSchema,
    /** Public URL key, once it means something. */
    slug: z.string().nullable(),
    coverPhoto: ListingPhotoSchema.nullable(),
    doneSteps: z.array(ListingStepSchema),
    /** First unfinished step; null when nothing is left to do here. */
    nextStep: ListingStepSchema.nullable(),
    /** What staff asked to have changed. */
    reviewNote: z.string().nullable(),
    submittedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .register(contractsRegistry, { id: 'OwnerListingProgress' });
export type OwnerListingProgress = z.infer<typeof OwnerListingProgressSchema>;

export const OwnerOnboardingSchema = z
  .object({
    started: z.boolean(),
    doneAccountSteps: z.array(AccountStepSchema),
    listings: z.array(OwnerListingProgressSchema),
  })
  .register(contractsRegistry, { id: 'OwnerOnboarding' });
export type OwnerOnboarding = z.infer<typeof OwnerOnboardingSchema>;

export const OwnerSpaceSchema = z
  .object({
    id: z.uuid(),
    label: z.string(),
    features: z.array(ParkingFeatureSchema),
    hourlyRateMinor: z.int().nullable(),
  })
  .register(contractsRegistry, { id: 'OwnerSpace' });

export const OwnerPricesSchema = z
  .object({
    hourlyRateMinor: z.int().nullable(),
    dailyMaxMinor: z.int().nullable(),
    bookingGapMinutes: z.int(),
    cancellationPolicy: CancellationPolicySchema.nullable(),
    weekendRateMinor: z.int().nullable(),
    night: z.object({ rateMinor: z.int(), from: z.string(), to: z.string() }).nullable(),
    datedPrices: z.array(
      z.object({
        label: z.string().nullable(),
        startsOn: z.iso.date(),
        endsOn: z.iso.date(),
        rateMinor: z.int(),
      }),
    ),
    longStayDiscounts: z.array(z.object({ minDays: z.int(), percent: z.int() })),
  })
  .register(contractsRegistry, { id: 'OwnerPrices' });
export type OwnerPrices = z.infer<typeof OwnerPricesSchema>;

/** Everything a listing's steps show and edit. */
export const OwnerListingSchema = z
  .object({
    id: z.uuid(),
    status: ListingStatusSchema,
    /** Staff are looking at it, or it is live: the steps are read-only. */
    locked: z.boolean(),
    progress: OwnerListingProgressSchema,
    /** The account's side of submitting, so the page needs no second request. */
    doneAccountSteps: z.array(AccountStepSchema),
    location: z.object({
      name: z.string().nullable(),
      address: z.string().nullable(),
      areaId: AreaIdSchema.nullable(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      description: z.string().nullable(),
      contentLocale: LocaleSchema,
    }),
    spaces: z.array(OwnerSpaceSchema),
    openingHours: z.array(OpeningPeriodSchema),
    /** Those that have not ended, soonest first. Editable whatever the status. */
    hoursExceptions: z.array(OwnerHoursExceptionSchema),
    prices: OwnerPricesSchema,
    photos: z.array(OwnerPhotoSchema),
    proofs: z.array(OwnerProofSchema),
    landRegistrationNumber: z.string().nullable(),
  })
  .register(contractsRegistry, { id: 'OwnerListing' });
export type OwnerListing = z.infer<typeof OwnerListingSchema>;

export const OwnerListingCreatedSchema = z
  .object({ id: z.uuid() })
  .register(contractsRegistry, { id: 'OwnerListingCreated' });
