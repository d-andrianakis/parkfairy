import { fileURLToPath } from 'node:url';
import { parseOrigins } from '@parkfairy/auth';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

/** This machine: the one place uploads may go to files, and a dev key may stand in. */
const isLoopback = (url: string) =>
  URL.canParse(url) && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

/** The repository root, from both `src/config` and `dist/config`. */
export const DEFAULT_OBJECT_STORE_DIR = fileURLToPath(
  new URL('../../../../.uploads', import.meta.url),
);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    BETTER_AUTH_URL: z.url(),
    TRUSTED_ORIGINS: z.string().default(''),
    /**
     * The staff app's origin (apps/admin), allowed to send cookie-authenticated writes to this API.
     * Its own variable, not part of TRUSTED_ORIGINS: that list also feeds the public site's Better
     * Auth, which must not trust the staff origin.
     */
    ADMIN_URL: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
    API_CORS_ORIGINS: z.string().default(''),
    /**
     * Express "trust proxy": the addresses/CIDRs of the web servers (and any proxy between
     * them and the API), "loopback" when they share a host, or "false". Required in
     * production. Not a hop count of the proxies in front of the web app: the web server adds
     * no X-Forwarded-For entry of its own, so counting it trusts a visitor-chosen value.
     */
    TRUST_PROXY: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Shared rate-limit counters across instances; required in production. */
    REDIS_URL: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
    /** Uploads. Without a bucket they become files in OBJECT_STORE_DIR, on this machine only. */
    S3_BUCKET: z.preprocess(emptyToUndefined, z.string().optional()),
    S3_REGION: z.preprocess(emptyToUndefined, z.string().default('eu-central-1')),
    /** For S3-compatible stores; leave empty for AWS. */
    S3_ENDPOINT: z.preprocess(emptyToUndefined, z.url().optional()),
    OBJECT_STORE_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
    /** Base64 of 32 random bytes; encrypts tax numbers and birth dates. */
    OWNER_DATA_KEY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine((key) => Buffer.from(key, 'base64').length === 32, {
          message: 'OWNER_DATA_KEY must be the base64 of 32 bytes',
        })
        .optional(),
    ),
    /**
     * Payments (Phase 4), in Stripe's test mode until #18 and #19 are answered (memory.md #46):
     * the secret key and the webhook endpoint's signing secret, both or neither. Without them,
     * owners can't set up payouts and only a local run books, without paying (#33, #47).
     */
    STRIPE_SECRET_KEY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/, 'STRIPE_SECRET_KEY is not a Stripe secret key')
        .optional(),
    ),
    /**
     * The webhook endpoints' signing secrets, comma-separated: the platform's events and the
     * Connect endpoint's (owners' accounts) come from two endpoints, each with its own.
     */
    STRIPE_WEBHOOK_SECRET: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(
          /^whsec_[A-Za-z0-9]+(,whsec_[A-Za-z0-9]+)*$/,
          'STRIPE_WEBHOOK_SECRET is not a signing secret (or a comma-separated list of them)',
        )
        .optional(),
    ),
    /**
     * Address search (decision #40), from the server. A token without URL restrictions: Mapbox
     * refuses restricted ones without a browser's Referer. On this machine MAPBOX_PUBLIC_TOKEN
     * stands in; elsewhere never, as it reaches every visitor's browser, and making it work from a
     * server would mean lifting its restrictions. With none, address search answers unavailable.
     */
    MAPBOX_SEARCH_TOKEN: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^(pk|sk)\./)
        .optional(),
    ),
    MAPBOX_PUBLIC_TOKEN: z.preprocess(emptyToUndefined, z.string().startsWith('pk.').optional()),
    /** Mapbox calls the whole site may make in a clock hour (each is billed, or part of a session). */
    MAPBOX_SEARCH_HOURLY_LIMIT: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().positive().default(2000),
    ),
  })
  .refine((env) => env.S3_BUCKET || isLoopback(env.BETTER_AUTH_URL), {
    // Keyed on the origin, not NODE_ENV: staging must not keep owners' documents on one disk.
    message: 'S3_BUCKET is required unless BETTER_AUTH_URL is this machine',
    path: ['S3_BUCKET'],
  })
  .refine((env) => env.OWNER_DATA_KEY || isLoopback(env.BETTER_AUTH_URL), {
    message: 'OWNER_DATA_KEY is required unless BETTER_AUTH_URL is this machine',
    path: ['OWNER_DATA_KEY'],
  })
  .refine(
    (env) =>
      !env.MAPBOX_SEARCH_TOKEN ||
      env.MAPBOX_SEARCH_TOKEN !== env.MAPBOX_PUBLIC_TOKEN ||
      isLoopback(env.BETTER_AUTH_URL),
    {
      // The browser's token is public; the server's would then be too, with no limit of ours.
      message:
        'MAPBOX_SEARCH_TOKEN must not be the public token unless BETTER_AUTH_URL is this machine',
      path: ['MAPBOX_SEARCH_TOKEN'],
    },
  )
  .refine((env) => !env.STRIPE_SECRET_KEY === !env.STRIPE_WEBHOOK_SECRET, {
    // A key without its webhook secret would take money it could never hear back about.
    message: 'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET go together',
    path: ['STRIPE_WEBHOOK_SECRET'],
  })
  .refine((env) => !env.STRIPE_SECRET_KEY?.includes('_live_'), {
    // Real money waits for the adviser (#18) and Stripe (#19): memory.md #46.
    message: 'Live Stripe keys are refused until #18 and #19 are answered (memory.md #46)',
    path: ['STRIPE_SECRET_KEY'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.REDIS_URL, {
    message: 'REDIS_URL is required in production (rate limits must be shared across instances)',
    path: ['REDIS_URL'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.TRUST_PROXY !== 'true', {
    // Express would take the left-most X-Forwarded-For entry, which the visitor writes.
    message: 'TRUST_PROXY=true trusts visitors in production; list the web server addresses',
    path: ['TRUST_PROXY'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.TRUST_PROXY, {
    message: 'TRUST_PROXY is required in production (the web server addresses, or "false")',
    path: ['TRUST_PROXY'],
  });

export type Env = ReturnType<typeof loadEnv>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid API environment:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  const authOrigin = new URL(env.BETTER_AUTH_URL).origin;
  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    /** Origins allowed to send cookie-authenticated, state-changing requests. */
    trustedOrigins: [
      ...new Set([
        authOrigin,
        ...parseOrigins(env.TRUSTED_ORIGINS),
        ...(env.ADMIN_URL ? [new URL(env.ADMIN_URL).origin] : []),
      ]),
    ],
    corsOrigins: parseOrigins(env.API_CORS_ORIGINS),
    trustProxy: parseTrustProxy(env.TRUST_PROXY ?? 'loopback'),
    objectStoreDir: env.OBJECT_STORE_DIR ?? DEFAULT_OBJECT_STORE_DIR,
    /** The web app's origin: where Stripe sends an owner back to after onboarding. */
    webOrigin: authOrigin,
    stripe:
      env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
        ? {
            secretKey: env.STRIPE_SECRET_KEY,
            webhookSecrets: env.STRIPE_WEBHOOK_SECRET.split(','),
          }
        : null,
    /**
     * Without Stripe, a hold is confirmed without paying, and only on this machine (decision #33,
     * #47): keyed on the origin, as files for uploads are, so staging and production offer no
     * booking until Stripe takes the money. With Stripe, every booking is paid for.
     */
    bookingWithoutPayment:
      isLoopback(env.BETTER_AUTH_URL) && !(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
    mapboxSearchToken:
      env.MAPBOX_SEARCH_TOKEN ??
      (isLoopback(env.BETTER_AUTH_URL) ? env.MAPBOX_PUBLIC_TOKEN : undefined) ??
      null,
  };
}

/** Maps TRUST_PROXY onto Express's `trust proxy` setting (hop count, boolean, or address list). */
function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
