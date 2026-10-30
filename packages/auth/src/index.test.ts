import {
  ACCOUNT_LINK_LIFETIME,
  DEFAULT_LOCALE,
  PASSWORD_POLICY,
  SUPPORTED_LOCALES,
} from '@parkfairy/contracts';
import { createDatabase, type Database } from '@parkfairy/database';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_COOKIE_PREFIX,
  createAuth,
  INVALID_LOCALE,
  parseOrigins,
  type AuthEmail,
} from './index.js';

// The pool is lazy: nothing here opens a connection.
const connection = createDatabase({
  connectionString: 'postgres://unused@127.0.0.1:1/unused',
  max: 1,
});
afterAll(() => connection.close());

function build(baseURL = 'http://localhost:3000') {
  return createAuth({
    db: connection.db,
    secret: 'x'.repeat(32),
    baseURL,
    trustedOrigins: ['http://localhost:3000'],
  });
}

describe('createAuth', () => {
  const { options } = build();

  it('applies the shared password policy', () => {
    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      minPasswordLength: PASSWORD_POLICY.minLength,
      maxPasswordLength: PASSWORD_POLICY.maxLength,
    });
  });

  it('never lets clients set their own role', () => {
    expect(options.user?.additionalFields?.role).toMatchObject({
      input: false,
      defaultValue: 'user',
    });
  });

  it('lets users choose only shipped locales', () => {
    expect(options.user?.additionalFields?.locale).toMatchObject({
      type: [...SUPPORTED_LOCALES],
      defaultValue: DEFAULT_LOCALE,
      input: true,
    });
  });

  it('looks sessions up in the database on every request', () => {
    const session = options.session as { cookieCache?: { enabled?: boolean } } | undefined;
    expect(session?.cookieCache?.enabled).not.toBe(true);
  });

  it('namespaces cookies and keeps telemetry off', () => {
    expect(options.advanced?.cookiePrefix).toBe(AUTH_COOKIE_PREFIX);
    expect(options.telemetry?.enabled).toBe(false);
  });

  it('uses Secure cookies exactly when served over https', () => {
    expect(options.advanced?.useSecureCookies).toBe(false);
    expect(build('https://app.example.gr').options.advanced?.useSecureCookies).toBe(true);
  });

  it('opens no account without a confirmed address, nor a session from the emailed link', () => {
    expect(options.emailAndPassword?.requireEmailVerification).toBe(true);
    expect(options.emailVerification?.sendOnSignIn).toBe(true);
    // The email promises this lifetime; Better Auth's default is one hour.
    expect(options.emailVerification?.expiresIn).toBe(
      ACCOUNT_LINK_LIFETIME.verifyEmailHours * 60 * 60,
    );
    // A stranger may have signed up with this address and know the password.
    expect(options.emailVerification?.autoSignInAfterVerification).toBe(false);
  });

  it('protects password resets', () => {
    expect(options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
    expect(options.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(
      ACCOUNT_LINK_LIFETIME.resetPasswordMinutes * 60,
    );
    expect(options.verification?.storeIdentifier).toEqual({
      default: 'plain',
      overrides: { 'reset-password': 'hashed' },
    });
  });

  it('builds a duplicate sign-up answer with every field of a real one', () => {
    const coreFields = {
      name: 'Maria',
      email: 'm@example.gr',
      emailVerified: false,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const fake = options.emailAndPassword?.customSyntheticUser?.({
      coreFields,
      additionalFields: { locale: 'en' },
      id: 'u',
    });
    expect(fake).toMatchObject({ role: 'user', locale: 'en', twoFactorEnabled: false, id: 'u' });
  });

  it('sends nothing from an instance without a sender (the API, the seed)', () => {
    expect(options.emailAndPassword?.sendResetPassword).toBeUndefined();
    expect(options.emailVerification?.sendVerificationEmail).toBeUndefined();
  });

  describe('account emails', () => {
    const sent: AuthEmail[] = [];
    const removed = vi.fn(() => Promise.resolve());
    const { options: sending } = createAuth({
      // Only what the password-reset callback touches; the real thing is in the integration test.
      db: { delete: () => ({ where: removed }) } as unknown as Database,
      secret: 'x'.repeat(32),
      baseURL: 'https://parkfairy.example/',
      trustedOrigins: ['https://parkfairy.example'],
      sendEmail: (email) => sent.push(email),
    });
    const user = {
      id: 'u',
      name: 'Maria',
      email: 'm@example.gr',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const verifyUrl =
      'https://parkfairy.example/api/auth/verify-email?token=t&callbackURL=https%3A%2F%2Fevil.example';
    const resetUrl =
      'https://parkfairy.example/api/auth/reset-password/t?callbackURL=https%3A%2F%2Fevil.example';

    afterEach(() => {
      sent.length = 0;
    });

    it('lands a confirmation link on our page in the account language', async () => {
      await sending.emailVerification?.sendVerificationEmail?.({
        user: { ...user, locale: 'en' } as typeof user,
        url: verifyUrl,
        token: 't',
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ kind: 'verify-email', to: user.email, locale: 'en' });
      // Our page, not Better Auth's GET: a scanner fetching the link must confirm nothing.
      expect(sent[0]?.url).toBe('https://parkfairy.example/en/verify-email?token=t');
    });

    it('escapes the token in the link', async () => {
      await sending.emailVerification?.sendVerificationEmail?.({
        user: { ...user, locale: 'en' } as typeof user,
        url: verifyUrl,
        token: 'a&b=c',
      });
      expect(new URL(sent[0]?.url ?? '').searchParams.get('token')).toBe('a&b=c');
    });

    it('lands a reset link on our page, replacing whatever the request asked for', async () => {
      await sending.emailAndPassword?.sendResetPassword?.({
        user: { ...user, locale: 'el' } as typeof user,
        url: resetUrl,
        token: 't',
      });

      const link = new URL(sent[0]?.url ?? '');
      expect(link.pathname).toBe('/api/auth/reset-password/t');
      expect(link.searchParams.get('callbackURL')).toBe('/el/reset-password');
    });

    it('falls back to the default language for an account without a usable one', async () => {
      await sending.emailAndPassword?.onExistingUserSignUp?.({
        user: { ...user, locale: 'xx' } as typeof user,
      });
      expect(sent[0]).toEqual({
        kind: 'existing-account',
        to: user.email,
        locale: DEFAULT_LOCALE,
        url: `https://parkfairy.example/${DEFAULT_LOCALE}/forgot-password`,
      });
    });

    it('ends the account’s other links and tells the owner when the password changes', async () => {
      await sending.emailAndPassword?.onPasswordReset?.({
        user: { ...user, locale: 'en' } as typeof user,
      });
      expect(removed).toHaveBeenCalledOnce();
      expect(sent[0]).toMatchObject({ kind: 'password-changed', to: user.email, locale: 'en' });
    });
  });

  describe('locale validation hooks', () => {
    const userHooks = options.databaseHooks?.user;
    const user = {
      id: 'u',
      name: 'Maria',
      email: 'm@example.gr',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('accepts supported locales on create and update', async () => {
      await expect(userHooks?.create?.before?.({ ...user, locale: 'en' })).resolves.toBeTruthy();
      await expect(userHooks?.update?.before?.({ locale: 'el' })).resolves.toBeTruthy();
      await expect(userHooks?.update?.before?.({ name: 'Μαρία' })).resolves.toBeTruthy();
    });

    it('rejects anything else before it reaches the database', async () => {
      await expect(userHooks?.create?.before?.({ ...user, locale: 'xx' })).rejects.toMatchObject({
        body: { code: INVALID_LOCALE },
      });
      await expect(userHooks?.update?.before?.({ locale: 42 })).rejects.toMatchObject({
        body: { code: INVALID_LOCALE },
      });
    });
  });
});

describe('parseOrigins', () => {
  it('normalizes a comma-separated list to origins', () => {
    expect(parseOrigins(' https://app.example.gr/path , http://localhost:3000/ ,')).toEqual([
      'https://app.example.gr',
      'http://localhost:3000',
    ]);
  });

  it('returns an empty list when unset', () => {
    expect(parseOrigins(undefined)).toEqual([]);
  });
});
