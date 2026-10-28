/**
 * Single Better Auth configuration shared by the web app (which hosts the auth
 * HTTP handlers) and the API (which only verifies sessions). Both must build the
 * instance from this function so cookie names, secrets and schema always match.
 */
import { DEFAULT_LOCALE, isLocale, PASSWORD_POLICY, SUPPORTED_LOCALES } from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';

export interface CreateAuthOptions {
  db: Database;
  /** BETTER_AUTH_SECRET: signs session cookies; must be identical in every service. */
  secret: string;
  /** Public origin hosting the /api/auth handlers (the web app). */
  baseURL: string;
  /** Origins allowed to call auth endpoints with credentials. */
  trustedOrigins: string[];
}

export const AUTH_COOKIE_PREFIX = 'parkfairy';

export function createAuth({ db, secret, baseURL, trustedOrigins }: CreateAuthOptions) {
  return betterAuth({
    appName: 'Parkfairy',
    baseURL,
    basePath: '/api/auth',
    secret,
    trustedOrigins,
    database: drizzleAdapter(db, { provider: 'pg', schema: schema.authSchema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_POLICY.minLength,
      maxPasswordLength: PASSWORD_POLICY.maxLength,
      // TODO(phase 2): require verification once transactional email (Resend) is wired up.
      requireEmailVerification: false,
    },
    user: {
      additionalFields: {
        // `input: false` makes Better Auth reject any client attempt to set the role.
        role: { type: ['user', 'admin'], required: true, defaultValue: 'user', input: false },
        // Users choose their language at sign-up and when switching; restricted to shipped locales.
        locale: {
          type: [...SUPPORTED_LOCALES],
          required: false,
          defaultValue: DEFAULT_LOCALE,
          input: true,
        },
      },
    },
    // Better Auth does not enforce enum values on additional fields, so validate before any write.
    databaseHooks: {
      user: {
        create: { before: (user) => withSupportedLocale(user) },
        update: { before: (user) => withSupportedLocale(user) },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Cookie caching stays off: the API must see revocations and role changes immediately.
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: baseURL.startsWith('https://'),
      database: { generateId: 'uuid' },
    },
    plugins: [twoFactor({ issuer: 'Parkfairy' })],
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
export type AuthUser = AuthSession['user'];

export const INVALID_LOCALE = 'INVALID_LOCALE';

/** Database hook: passes the write through, or rejects it if it sets an unsupported locale. */
function withSupportedLocale<T extends Record<string, unknown>>(data: T): Promise<{ data: T }> {
  if (data.locale !== undefined && !isLocale(data.locale)) {
    return Promise.reject(
      new APIError('BAD_REQUEST', { message: 'Unsupported locale', code: INVALID_LOCALE }),
    );
  }
  return Promise.resolve({ data });
}

/** Parses a comma-separated origin list (e.g. TRUSTED_ORIGINS) into normalized origins. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin);
}
