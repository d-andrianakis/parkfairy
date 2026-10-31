import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_KEYS, authErrorKey, authErrorValues } from './auth-errors';

describe('authErrorKey', () => {
  it('maps Better Auth codes to catalog keys', () => {
    expect(authErrorKey({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 })).toBe(
      'INVALID_EMAIL_OR_PASSWORD',
    );
  });

  it('maps the two-factor settings codes', () => {
    expect(authErrorKey({ code: 'INVALID_PASSWORD', status: 400 })).toBe('INVALID_PASSWORD');
    // Better Auth sends the lockout as a 429; the specific code must win over the status.
    expect(authErrorKey({ code: 'ACCOUNT_TEMPORARILY_LOCKED', status: 429 })).toBe(
      'ACCOUNT_TEMPORARILY_LOCKED',
    );
    expect(authErrorValues('ACCOUNT_TEMPORARILY_LOCKED')).toEqual({ minutes: 15 });
    expect(authErrorKey({ code: 'INVALID_BACKUP_CODE', status: 401 })).toBe('INVALID_BACKUP_CODE');
  });

  it('folds code variants into one message', () => {
    expect(authErrorKey({ code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' })).toBe('TOO_MANY_ATTEMPTS');
  });

  it('maps the email confirmation and reset codes', () => {
    expect(authErrorKey({ code: 'INVALID_TOKEN', status: 400 })).toBe('INVALID_TOKEN');
    expect(authErrorKey({ code: 'TOKEN_EXPIRED', status: 400 })).toBe('INVALID_TOKEN');
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
