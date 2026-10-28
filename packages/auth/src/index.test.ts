import { DEFAULT_LOCALE, PASSWORD_POLICY, SUPPORTED_LOCALES } from '@parkfairy/contracts';
import { createDatabase } from '@parkfairy/database';
import { afterAll, describe, expect, it } from 'vitest';
import { AUTH_COOKIE_PREFIX, createAuth, INVALID_LOCALE, parseOrigins } from './index.js';

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
