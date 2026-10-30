/**
 * Single Better Auth configuration shared by the web app (which hosts the auth
 * HTTP handlers) and the API (which only verifies sessions). Both must build the
 * instance from this function so cookie names, secrets and schema always match.
 */
import {
  ACCOUNT_LINK_LIFETIME,
  DEFAULT_LOCALE,
  isLocale,
  PASSWORD_POLICY,
  SignUpInputSchema,
  SUPPORTED_LOCALES,
  TWO_FACTOR_LOCKOUT,
  type Locale,
} from '@parkfairy/contracts';
import { deleteUserVerifications, schema, type Database } from '@parkfairy/database';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import type { RateLimitStorage } from './rate-limit-storage.js';

export {
  authRateLimitKey,
  memoryRateLimitStorage,
  redisRateLimitStorage,
  redisScript,
  runScript,
  type RateLimitStorage,
  type RedisEval,
} from './rate-limit-storage.js';

/** An email Better Auth wants sent, in the language stored on the account. */
export interface AuthEmail {
  kind: 'verify-email' | 'reset-password' | 'password-changed' | 'existing-account';
  to: string;
  locale: Locale;
  /** Where the email's button goes. Built here, so a caller cannot choose the destination. */
  url: string;
}

export interface CreateAuthOptions {
  db: Database;
  /** BETTER_AUTH_SECRET: signs session cookies; must be identical in every service. */
  secret: string;
  /** Public origin hosting the /api/auth handlers (the web app). */
  baseURL: string;
  /** Origins allowed to call auth endpoints with credentials. */
  trustedOrigins: string[];
  /**
   * Shared rate-limit counters (Redis) so limits hold across web instances; omitted, Better
   * Auth counts per process. The API builds this instance only to verify sessions.
   */
  rateLimitStorage?: RateLimitStorage;
  /**
   * Addresses/CIDRs of the proxies in front of the web app. X-Forwarded-For is read right to
   * left past these hops to find the client IP (rate-limit key); unset, only a single-value
   * header is trusted. List the real proxies, not a private range that also covers clients.
   */
  trustedProxies?: string[];
  /**
   * Hands an email over for delivery and returns at once: Better Auth awaits its callbacks,
   * so a slow send would tell a visitor whether an address has an account. Only the web app
   * passes this; the API never serves these flows.
   */
  sendEmail?: (email: AuthEmail) => void;
}

export const AUTH_COOKIE_PREFIX = 'parkfairy';

/** Sessions last a week from their last refresh, which happens at most once a day. */
export const SESSION_TIMING = {
  expiresInSeconds: 60 * 60 * 24 * 7,
  updateAgeSeconds: 60 * 60 * 24,
};

export function createAuth({
  db,
  secret,
  baseURL,
  trustedOrigins,
  rateLimitStorage,
  trustedProxies,
  sendEmail,
}: CreateAuthOptions) {
  const send = (kind: AuthEmail['kind'], user: AccountRef, url: string) => {
    sendEmail?.({ kind, to: user.email, locale: accountLocale(user), url });
    return Promise.resolve();
  };
  const pageUrl = (user: AccountRef, path: string) =>
    new URL(`/${accountLocale(user)}${path}`, baseURL).href;

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
      // Sign-up then opens no session and answers the same whether the address is taken.
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: ACCOUNT_LINK_LIFETIME.resetPasswordMinutes * 60,
      // A reset is how people recover a stolen account, so it must end the thief's sessions.
      revokeSessionsOnPasswordReset: true,
      // Without this the duplicate-address answer lacks our fields and gives the account away.
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        role: 'user',
        locale: DEFAULT_LOCALE,
        twoFactorEnabled: false,
        ...additionalFields,
        id,
      }),
      // A reset consumes only its own token. A thief's saved link must not undo a recovery, so
      // this also removes the other links, pending two-factor sign-ins and trusted devices.
      onPasswordReset: async ({ user }) => {
        await deleteUserVerifications(db, user.id);
        await send('password-changed', user, pageUrl(user, '/forgot-password'));
      },
      ...(sendEmail && {
        sendResetPassword: ({ user, url }) =>
          send('reset-password', user, withCallback(url, `/${accountLocale(user)}/reset-password`)),
        onExistingUserSignUp: ({ user }) =>
          send('existing-account', user, pageUrl(user, '/forgot-password')),
      }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      expiresIn: ACCOUNT_LINK_LIFETIME.verifyEmailHours * 60 * 60,
      // No session from the link. A stranger may have signed up with this address: clicking
      // must not put its owner inside an account whose password the stranger knows.
      autoSignInAfterVerification: false,
      // The link opens our page, where a person presses a button to confirm. Pointed straight
      // at Better Auth's GET, a mail scanner fetching it would confirm the stranger's account.
      ...(sendEmail && {
        sendVerificationEmail: ({ user, token }) =>
          send(
            'verify-email',
            user,
            pageUrl(user, `/verify-email?token=${encodeURIComponent(token)}`),
          ),
      }),
    },
    // A copy of the verifications table must not hand over live password resets.
    verification: {
      storeIdentifier: { default: 'plain', overrides: { 'reset-password': 'hashed' } },
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
      expiresIn: SESSION_TIMING.expiresInSeconds,
      updateAge: SESSION_TIMING.updateAgeSeconds,
      // Cookie caching stays off: the API must see revocations and role changes immediately.
    },
    // `enabled` keeps Better Auth's default (on in production).
    rateLimit: rateLimitStorage ? { customStorage: rateLimitStorage } : undefined,
    advanced: {
      ...(trustedProxies && trustedProxies.length > 0 ? { ipAddress: { trustedProxies } } : {}),
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: baseURL.startsWith('https://'),
      database: { generateId: 'uuid' },
    },
    hooks: { before: validateSignUp, after: endOtherSessionsOnTwoFactorChange },
    plugins: [
      twoFactor({
        issuer: 'Parkfairy',
        // Explicit (these are Better Auth's defaults) because the UI tells people the wait.
        accountLockout: {
          maxFailedAttempts: TWO_FACTOR_LOCKOUT.maxFailedAttempts,
          durationSeconds: TWO_FACTOR_LOCKOUT.minutes * 60,
        },
      }),
    ],
    telemetry: { enabled: false },
  });
}

/**
 * Refuses a bad sign-up before anything looks the address up. Only a new account reaches the
 * insert, so anything that fails there (an unsupported locale, a NUL in the name) would tell a
 * free address from a taken one, which gets the generic answer first.
 */
const validateSignUp = createAuthMiddleware((ctx) => {
  if (ctx.path !== '/sign-up/email') return Promise.resolve();
  const { name, locale, image } = (ctx.body ?? {}) as Record<string, unknown>;
  if (locale !== undefined && !isLocale(locale)) return Promise.reject(unsupportedLocale());
  const valid = image === undefined && SignUpInputSchema.shape.name.safeParse(name).success;
  return valid
    ? Promise.resolve()
    : Promise.reject(
        new APIError('BAD_REQUEST', { message: 'Invalid sign-up', code: INVALID_SIGN_UP }),
      );
});

/** Requests that switch two-factor on (a code verified from a signed-in session) or off. */
const TWO_FACTOR_CHANGES = new Set(['/two-factor/verify-totp', '/two-factor/disable']);

/**
 * Turning two-factor on or off replaces the current session; end the user's other sessions
 * too. Admin routes check the user's flag, so a session that never passed a second factor
 * (say, opened with a phished password before enrolment) must not ride on it. A two-factor
 * sign-in has no prior session and leaves other devices alone.
 */
const endOtherSessionsOnTwoFactorChange = createAuthMiddleware(async (ctx) => {
  if (!TWO_FACTOR_CHANGES.has(ctx.path)) return;
  const fresh = ctx.context.newSession;
  if (!fresh || !ctx.context.session?.session) return;
  const sessions = await ctx.context.internalAdapter.listSessions(fresh.user.id);
  const others = sessions
    .map((session) => session.token)
    .filter((token) => token !== fresh.session.token);
  if (others.length > 0) await ctx.context.internalAdapter.deleteSessions(others);
});

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
export type AuthUser = AuthSession['user'];

export const INVALID_LOCALE = 'INVALID_LOCALE';
export const INVALID_SIGN_UP = 'INVALID_SIGN_UP';

/** The account fields an email needs; Better Auth types `user` without our additional fields. */
type AccountRef = { email: string; locale?: unknown };

function accountLocale(user: AccountRef): Locale {
  return isLocale(user.locale) ? user.locale : DEFAULT_LOCALE;
}

/** Better Auth's link with our landing page, whatever `callbackURL` the request carried. */
function withCallback(url: string, callbackURL: string): string {
  const link = new URL(url);
  link.searchParams.set('callbackURL', callbackURL);
  return link.href;
}

/** Database hook: passes the write through, or rejects it if it sets an unsupported locale. */
function withSupportedLocale<T extends Record<string, unknown>>(data: T): Promise<{ data: T }> {
  if (data.locale !== undefined && !isLocale(data.locale)) {
    return Promise.reject(unsupportedLocale());
  }
  return Promise.resolve({ data });
}

function unsupportedLocale() {
  return new APIError('BAD_REQUEST', { message: 'Unsupported locale', code: INVALID_LOCALE });
}

/** Parses a comma-separated origin list (e.g. TRUSTED_ORIGINS) into normalized origins. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin);
}
