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
    trustedOrigins: [...new Set([authOrigin, ...parseOrigins(env.TRUSTED_ORIGINS)])],
    corsOrigins: parseOrigins(env.API_CORS_ORIGINS),
    trustProxy: parseTrustProxy(env.TRUST_PROXY ?? 'loopback'),
    objectStoreDir: env.OBJECT_STORE_DIR ?? DEFAULT_OBJECT_STORE_DIR,
  };
}

/** Maps TRUST_PROXY onto Express's `trust proxy` setting (hop count, boolean, or address list). */
function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
