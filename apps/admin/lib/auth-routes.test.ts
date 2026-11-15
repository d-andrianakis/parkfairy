import { describe, expect, it } from 'vitest';
import { bodyIsAllowed, isAllowedAuthRequest } from './auth-routes';

describe('which Better Auth endpoints the staff origin serves', () => {
  it.each([
    ['POST', '/api/auth/sign-in/email'],
    ['POST', '/api/auth/two-factor/verify-totp'],
    ['POST', '/api/auth/two-factor/verify-backup-code'],
    ['POST', '/api/auth/sign-out'],
    ['post', '/api/auth/sign-out/'],
  ])('serves %s %s', (method, path) => {
    expect(isAllowedAuthRequest(method, path)).toBe(true);
  });

  it.each([
    ['POST', '/api/auth/sign-up/email'],
    ['POST', '/api/auth/request-password-reset'],
    ['POST', '/api/auth/reset-password'],
    ['POST', '/api/auth/update-user'],
    ['POST', '/api/auth/change-password'],
    ['POST', '/api/auth/two-factor/enable'],
    ['POST', '/api/auth/two-factor/disable'],
    ['GET', '/api/auth/get-session'],
    ['GET', '/api/auth/list-sessions'],
    ['GET', '/api/auth/sign-in/email'],
    ['GET', '/api/auth/verify-email'],
    ['DELETE', '/api/auth/sign-out'],
    ['POST', '/api/auth/sign-in/email/extra'],
    ['POST', '/api/auth/sign-in/social'],
    ['POST', '/api/auth/../auth/sign-up/email'],
    ['POST', '/api/authx/sign-out'],
    ['POST', '/api/auth'],
    ['POST', '/sign-out'],
  ])('answers 404 to %s %s', (method, path) => {
    expect(isAllowedAuthRequest(method, path)).toBe(false);
  });
});

describe('the smaller cases of a path', () => {
  it.each([
    ['POST', '/API/auth/sign-out'],
    ['POST', '/api/auth//sign-out'],
    ['POST', '/api/auth/sign-out;x'],
    ['POST', '/api/auth/%2e%2e/sign-up/email'],
    ['POST', '/api/auth/sign-in%2femail'],
    ['HEAD', '/api/auth/sign-out'],
    ['OPTIONS', '/api/auth/sign-out'],
    ['POST', '/api/auth/two-factor/get-totp-uri'],
    ['POST', '/api/auth/two-factor/generate-backup-codes'],
    ['POST', '/api/auth/two-factor/send-otp'],
    ['POST', '/api/auth/revoke-session'],
    ['POST', '/api/auth/delete-user'],
    ['POST', '/api/auth/send-verification-email'],
    ['POST', '/api/auth/change-email'],
  ])('does not serve %s %s', (method, path) => {
    expect(isAllowedAuthRequest(method, path)).toBe(false);
  });
});

describe('the options of an allowed endpoint that nobody may send', () => {
  it('refuses a request to remember the device, in any shape it is true', () => {
    for (const body of [
      { trustDevice: true },
      { code: '1', trustDevice: 'yes' },
      { trustDevice: 1 },
    ]) {
      expect(bodyIsAllowed(body), JSON.stringify(body)).toBe(false);
    }
  });

  it('allows the rest, a body that is not an object included', () => {
    for (const body of [
      { code: '123456' },
      { trustDevice: false },
      null,
      'text',
      5,
      [],
      undefined,
    ]) {
      expect(bodyIsAllowed(body), JSON.stringify(body)).toBe(true);
    }
  });
});
