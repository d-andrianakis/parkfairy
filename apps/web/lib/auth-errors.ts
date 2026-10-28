/**
 * Better Auth returns English messages plus a stable `code`. The UI never shows the
 * server text; it maps the code to a key in the `AuthErrors` catalog namespace.
 */
const CODE_TO_KEY = {
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'USER_ALREADY_EXISTS',
  INVALID_EMAIL_OR_PASSWORD: 'INVALID_EMAIL_OR_PASSWORD',
  INVALID_EMAIL: 'INVALID_EMAIL',
  PASSWORD_TOO_SHORT: 'PASSWORD_TOO_SHORT',
  PASSWORD_TOO_LONG: 'PASSWORD_TOO_LONG',
  INVALID_CODE: 'INVALID_CODE',
  OTP_HAS_EXPIRED: 'OTP_HAS_EXPIRED',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'TOO_MANY_ATTEMPTS',
  INVALID_TWO_FACTOR_COOKIE: 'INVALID_TWO_FACTOR_COOKIE',
  INVALID_LOCALE: 'INVALID_LOCALE',
} as const;

export type AuthErrorKey =
  (typeof CODE_TO_KEY)[keyof typeof CODE_TO_KEY] | 'TOO_MANY_REQUESTS' | 'UNKNOWN';

export const AUTH_ERROR_KEYS: readonly AuthErrorKey[] = [
  ...new Set<AuthErrorKey>([...Object.values(CODE_TO_KEY), 'TOO_MANY_REQUESTS', 'UNKNOWN']),
];

export function authErrorKey(
  error: { code?: string; status?: number } | null | undefined,
): AuthErrorKey {
  if (error?.status === 429) return 'TOO_MANY_REQUESTS';
  const code = error?.code;
  if (code && Object.hasOwn(CODE_TO_KEY, code)) {
    return CODE_TO_KEY[code as keyof typeof CODE_TO_KEY];
  }
  return 'UNKNOWN';
}
