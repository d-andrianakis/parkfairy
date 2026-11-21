/**
 * Zod issue messages in contracts are translation keys, never user-facing text. The web app
 * renders them through the `Validation` namespace of its message catalogs; API clients
 * receive the key and translate it themselves.
 */
export const VALIDATION_MESSAGES = [
  'nameRequired',
  'nameTooLong',
  'emailInvalid',
  'passwordTooShort',
  'passwordTooLong',
  'passwordRequired',
  'codeInvalid',
  'backupCodeRequired',
  'locationRequired',
  'dateInvalid',
  'timeNotOnStep',
  'startInPast',
  'startTooFar',
  'endBeforeStart',
  'durationTooLong',
  'invalid',
  'textTooLong',
  'ownerKindRequired',
  'firstNameRequired',
  'lastNameRequired',
  'legalNameRequired',
  'phoneInvalid',
  'addressRequired',
  'cityRequired',
  'postalCodeInvalid',
  'countryRequired',
  'taxIdRequired',
  'taxIdInvalid',
  'afmInvalid',
  'vatIdInvalid',
  'registrationRequired',
  'birthDateRequired',
  'birthDateInvalid',
  'birthDateUnderage',
  'listingNameRequired',
  'areaRequired',
  'pinRequired',
  'outsideGreece',
  'spaceLabelRequired',
  'spaceLabelDuplicate',
  'spacesRequired',
  'tooManySpaces',
  'hoursRequired',
  'hoursOrder',
  'hoursOverlap',
  'rateInvalid',
  'sizeHeightInvalid',
  'sizeLengthInvalid',
  'sizeWidthInvalid',
  'dailyMaxBelowRate',
  'nightWindowInvalid',
  'dateRangeInvalid',
  'datedOverlap',
  'discountInvalid',
  'discountDuplicate',
  'policyRequired',
  'confirmRequired',
  'landRegistrationInvalid',
  'dateInPast',
  'dateTooFar',
  'exceptionOverlap',
  'closedTimeOrder',
  'dateRequired',
  'lastDayBeforeFirst',
  'plateRequired',
  'plateInvalid',
  'placeTooShort',
  'placeNotFound',
  'placeUnavailable',
  'shareInvalid',
  'sharesTotal',
] as const;
export type ValidationMessage = (typeof VALIDATION_MESSAGES)[number];

/*
 * The numbers in those messages. They live here, in the one file with no zod, so a page can fill
 * a message in without loading every schema: see `@parkfairy/contracts/validation`.
 */

/** Enforced by Better Auth on the server and by the sign-up form on the client. */
export const PASSWORD_POLICY = { minLength: 10, maxLength: 128 } as const;
export const NAME_MAX_LENGTH = 100;
export const MAX_BOOKING_DAYS = 30;
/** How far ahead a stay may start. Also keeps every date the API walks within year 9999. */
export const MAX_START_AHEAD_DAYS = 365;
/** Enough for every public holiday and a few closures of the owner's own, a year ahead. */
export const HOURS_EXCEPTIONS_MAX = 30;
/** Closures and special hours past this reach no stay: the latest starts and lasts its 30 days. */
export const HOURS_EXCEPTION_AHEAD_DAYS = MAX_START_AHEAD_DAYS + MAX_BOOKING_DAYS;

/**
 * The largest vehicle a space takes, in whole centimetres, as an owner may state it. A space with no
 * stated limit is taken to fit any vehicle: owners say what they know, and a driver reads the
 * limits that are there.
 */
export const SPACE_LIMITS_CM = {
  height: { min: 100, max: 500 },
  length: { min: 200, max: 1500 },
  width: { min: 100, max: 400 },
} as const;
export type SpaceDimension = keyof typeof SPACE_LIMITS_CM;
export const SPACE_DIMENSIONS = [
  'height',
  'length',
  'width',
] as const satisfies readonly SpaceDimension[];

/** The message of a size outside its limits, which says the limits (`{min}` and `{max}`). */
export const SIZE_MESSAGES = {
  height: 'sizeHeightInvalid',
  length: 'sizeLengthInvalid',
  width: 'sizeWidthInvalid',
} as const satisfies Record<SpaceDimension, ValidationMessage>;

/** What a driver's saved vehicles keep to (5A.2), here so the page that lists them loads no zod. */
export const VEHICLE_LIMITS = {
  /** A nickname for the car ("Work car"): free text, so it is isolated where it is shown. */
  name: 40,
  /** Enough for a household and a company car; more is a fleet, which is 5A.11's. */
  perDriver: 10,
} as const;

/**
 * When the driver is reminded (5A.3, decided 2026-11-19): two hours before a stay starts and half an
 * hour before it ends. A stay booked closer than that gets no reminder for it: it would arrive with
 * the confirmation.
 */
export const BOOKING_REMINDER_MINUTES = { starting: 120, ending: 30 } as const;

/** How long a space is kept for a driver while they confirm (decision #3). */
export const HOLD_MINUTES = 10;
/**
 * How often a driver may keep a hold for another HOLD_MINUTES. Confirming works only while the hold
 * runs (decision #37), so the time limit must be extendable (WCAG 2.2.1), at least ten times; and
 * no more, so a space isn't kept from others for long.
 */
export const HOLD_MAX_EXTENSIONS = 10;

/**
 * Address search (decision #40): suggestions start at `min` characters, and `max` bounds both what
 * is sent to Mapbox (it takes 256) and the place named in a search's URL and title.
 */
export const PLACE_QUERY_LIMITS = { min: 3, max: 200 } as const;

/** Typed helper so schemas can only reference keys that exist in the catalogs. */
export const message = <K extends ValidationMessage>(key: K): K => key;

export function isValidationMessage(value: unknown): value is ValidationMessage {
  return typeof value === 'string' && (VALIDATION_MESSAGES as readonly string[]).includes(value);
}
