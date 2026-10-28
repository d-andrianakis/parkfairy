import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_KEYS, authErrorKey } from './auth-errors';

describe('authErrorKey', () => {
  it('maps Better Auth codes to catalog keys', () => {
    expect(authErrorKey({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 })).toBe(
      'INVALID_EMAIL_OR_PASSWORD',
    );
  });

  it('folds code variants into one message', () => {
    expect(authErrorKey({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' })).toBe(
      'USER_ALREADY_EXISTS',
    );
    expect(authErrorKey({ code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' })).toBe('TOO_MANY_ATTEMPTS');
  });

  it('treats rate limiting by status, whatever the body says', () => {
    expect(authErrorKey({ status: 429 })).toBe('TOO_MANY_REQUESTS');
  });

  it.each([null, undefined, {}, { code: 'SOMETHING_NEW' }, { code: '__proto__' }])(
    'never shows raw server text for %o',
    (error) => {
      expect(authErrorKey(error)).toBe('UNKNOWN');
    },
  );

  it('lists every key the mapping can produce', () => {
    expect(AUTH_ERROR_KEYS).toContain('UNKNOWN');
    expect(new Set(AUTH_ERROR_KEYS).size).toBe(AUTH_ERROR_KEYS.length);
  });
});
