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
import { BASE_ERROR_CODES, betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getIP, isAPIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { memoryRateLimitStorage, type RateLimitStorage } from './rate-limit-storage.js';

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
  /**
   * Client address of whoever asked for a reset, who may not be the inbox's owner. `unknown`
   * when it can't be told: those visitors then share one bucket, as in Better Auth's limits.
   */
  visitor?: string;
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

/**
 * The least these answers take. A new account writes two rows, a reset token one, and sign-in
 * reads more for a known address: a few milliseconds that tell a free address from a taken one
 * over enough tries. Every answer waits for this floor instead, which is far above that work
 * here and too short to notice. Measure the real work again once production hardware exists:
 * a floor hides nothing below it.
 */
export const ANSWER_FLOOR_MS: Readonly<Record<string, number>> = {
  '/request-password-reset': 250,
  '/sign-in/email': 300,
  '/sign-up/email': 500,
};

/** How long one sign-up holds an address; only needs to outlast the password hash. */
const SIGN_UP_CLAIM = { window: 10, max: 1 };

export function createAuth({
  db,
  secret,
  baseURL,
  trustedOrigins,
  rateLimitStorage,
  trustedProxies,
  sendEmail,
}: CreateAuthOptions) {
  const send = (kind: AuthEmail['kind'], user: AccountRef, url: string, visitor?: string) => {
    sendEmail?.({
      kind,
      to: user.email,
      locale: accountLocale(user),
      url,
      ...(visitor && { visitor }),
    });
    return Promise.resolve();
  };
  const pageUrl = (user: AccountRef, path: string) =>
    new URL(`/${accountLocale(user)}${path}`, baseURL).href;
  const ipAddress = trustedProxies && trustedProxies.length > 0 ? { trustedProxies } : undefined;
  const claims = rateLimitStorage ?? memoryRateLimitStorage();

  return betterAuth({
    appName: 'Parkfairy',
    baseURL,
    basePath: '/api/auth',
    secret,
    trustedOrigins,
    // No `transaction` option: Better Auth would then run each sign-up in one, holding one of the
    // few connections through password hashing and the address claim below.
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
        sendResetPassword: ({ user, url }, request) =>
          send(
            'reset-password',
            user,
            withCallback(url, `/${accountLocale(user)}/reset-password`),
            // Read as the rate limits read it, so a forged header gets no further here.
            (request && getIP(request, { advanced: { ipAddress } })) ?? 'unknown',
          ),
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
        create: {
          // Two sign-ups at once both find the address free, and the loser would hit the unique
          // index: a failure only a free address can produce. The claim turns it into Better
          // Auth's duplicate answer (a 403 here), the one a taken address gets. With Redis down
          // this holds per instance, like the limits it shares a store with.
          before: async (user) => {
            // One clock reading, as in the answer a taken address gets.
            const checked = await withSupportedLocale({ ...user, updatedAt: user.createdAt });
            const { allowed } = await claims.consume(`sign-up:${user.email}`, SIGN_UP_CLAIM);
            if (!allowed) throw new APIError('FORBIDDEN');
            return checked;
          },
        },
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
      ...(ipAddress && { ipAddress }),
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: baseURL.startsWith('https://'),
      database: { generateId: 'uuid' },
    },
    hooks: { before: beforeRequest, after: afterRequest },
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

const answerStartedAt = new WeakMap<Request, number>();

const beforeRequest = createAuthMiddleware((ctx) => {
  if (ANSWER_FLOOR_MS[ctx.path] && ctx.request) answerStartedAt.set(ctx.request, performance.now());
  return ctx.path === '/sign-up/email' ? validateSignUp(ctx.body) : Promise.resolve();
});

/**
 * Refuses a bad sign-up before anything looks the address up. Only a new account reaches the
 * insert, so anything that fails there (an unsupported locale, a NUL in the name) would tell a
 * free address from a taken one, which gets the generic answer first.
 */
function validateSignUp(body: unknown) {
  const { name, locale, image } = (body ?? {}) as Record<string, unknown>;
  if (locale !== undefined && !isLocale(locale)) return Promise.reject(unsupportedLocale());
  const parsed = SignUpInputSchema.shape.name.safeParse(name);
  // Only the parsed copy is trimmed, and the raw name is what gets stored: the form sends it
  // trimmed, so a padded one is a way around the length limit.
  const valid = image === undefined && parsed.success && parsed.data === name;
  return valid
    ? Promise.resolve()
    : Promise.reject(
        new APIError('BAD_REQUEST', { message: 'Invalid sign-up', code: INVALID_SIGN_UP }),
      );
}

/** Holds an answer until its `ANSWER_FLOOR_MS` after the request began. */
async function holdAnswer(path: string, request: Request | undefined) {
  const startedAt = request && answerStartedAt.get(request);
  const floor = ANSWER_FLOOR_MS[path];
  if (startedAt === undefined || floor === undefined) return;
  const left = startedAt + floor - performance.now();
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
}

/**
 * An unconfirmed address gets the wrong-password answer. Anyone can sign up with an address and
 * sign in with the password they chose: a different answer means the address was free, and the
 * wrong password means it was taken. The message speaks to both cases, and the right password
 * still sends a new link (`sendOnSignIn`). A Response, because Better Auth keeps the original
 * status for a replaced error: throwing here would answer 403 with the wrong-password body.
 */
function hideUnconfirmedAddress(returned: unknown): Response | undefined {
  if (!isAPIError(returned) || returned.body?.code !== 'EMAIL_NOT_VERIFIED') return undefined;
  const { body, statusCode, status } = APIError.from(
    'UNAUTHORIZED',
    BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD,
  );
  return Response.json(body, { status: statusCode, statusText: status.toString() });
}

/** Requests that switch two-factor on (a code verified from a signed-in session) or off. */
const TWO_FACTOR_CHANGES = new Set(['/two-factor/verify-totp', '/two-factor/disable']);

const afterRequest = createAuthMiddleware(async (ctx) => {
  await holdAnswer(ctx.path, ctx.request);
  // Only over HTTP: a server-side `auth.api` caller must keep seeing the error thrown.
  if (ctx.path === '/sign-in/email' && ctx.request) {
    return hideUnconfirmedAddress(ctx.context.returned);
  }
  if (!TWO_FACTOR_CHANGES.has(ctx.path)) return undefined;
  // Turning two-factor on or off replaces the current session; end the user's other sessions
  // too. Admin routes check the user's flag, so a session that never passed a second factor
  // (say, opened with a phished password before enrolment) must not ride on it. A two-factor
  // sign-in has no prior session and leaves other devices alone.
  const fresh = ctx.context.newSession;
  if (!fresh || !ctx.context.session?.session) return undefined;
  const sessions = await ctx.context.internalAdapter.listSessions(fresh.user.id);
  const others = sessions
    .map((session) => session.token)
    .filter((token) => token !== fresh.session.token);
  if (others.length > 0) await ctx.context.internalAdapter.deleteSessions(others);
  return undefined;
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
