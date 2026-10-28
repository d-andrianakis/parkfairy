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
  'invalid',
] as const;
export type ValidationMessage = (typeof VALIDATION_MESSAGES)[number];

/** Typed helper so schemas can only reference keys that exist in the catalogs. */
export const message = <K extends ValidationMessage>(key: K): K => key;

export function isValidationMessage(value: unknown): value is ValidationMessage {
  return typeof value === 'string' && (VALIDATION_MESSAGES as readonly string[]).includes(value);
}
