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

/** Typed helper so schemas can only reference keys that exist in the catalogs. */
export const message = <K extends ValidationMessage>(key: K): K => key;

export function isValidationMessage(value: unknown): value is ValidationMessage {
  return typeof value === 'string' && (VALIDATION_MESSAGES as readonly string[]).includes(value);
}
