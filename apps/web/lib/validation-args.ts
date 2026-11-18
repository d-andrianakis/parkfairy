import {
  HOURS_EXCEPTION_AHEAD_DAYS,
  MAX_BOOKING_DAYS,
  MAX_START_AHEAD_DAYS,
  NAME_MAX_LENGTH,
  PASSWORD_POLICY,
  PLACE_QUERY_LIMITS,
  SIZE_MESSAGES,
  SPACE_DIMENSIONS,
  SPACE_LIMITS_CM,
  type ValidationMessage,
} from '@parkfairy/contracts/validation';

/** ICU arguments for `Validation.*` messages (server and client components alike). */
export function validationArgs(key: ValidationMessage) {
  // A size says its limits (whole centimetres, as a car park can hold them).
  const dimension = SPACE_DIMENSIONS.find((candidate) => SIZE_MESSAGES[candidate] === key);
  if (dimension) return SPACE_LIMITS_CM[dimension];
  const max =
    key === 'nameTooLong'
      ? NAME_MAX_LENGTH
      : key === 'durationTooLong'
        ? MAX_BOOKING_DAYS
        : key === 'startTooFar'
          ? MAX_START_AHEAD_DAYS
          : key === 'dateTooFar'
            ? HOURS_EXCEPTION_AHEAD_DAYS
            : PASSWORD_POLICY.maxLength;
  const min = key === 'placeTooShort' ? PLACE_QUERY_LIMITS.min : PASSWORD_POLICY.minLength;
  return { min, max };
}
