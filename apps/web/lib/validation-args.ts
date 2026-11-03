import {
  MAX_BOOKING_DAYS,
  MAX_START_AHEAD_DAYS,
  NAME_MAX_LENGTH,
  PASSWORD_POLICY,
  type ValidationMessage,
} from '@parkfairy/contracts/validation';

/** ICU arguments for `Validation.*` messages (server and client components alike). */
export function validationArgs(key: ValidationMessage) {
  const max =
    key === 'nameTooLong'
      ? NAME_MAX_LENGTH
      : key === 'durationTooLong'
        ? MAX_BOOKING_DAYS
        : key === 'startTooFar'
          ? MAX_START_AHEAD_DAYS
          : PASSWORD_POLICY.maxLength;
  return { min: PASSWORD_POLICY.minLength, max };
}
