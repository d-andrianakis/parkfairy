import { parseOrigins } from '@parkfairy/auth';
import { z } from 'zod';

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
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.REDIS_URL, {
    message: 'REDIS_URL is required in production (rate limits must be shared across instances)',
    path: ['REDIS_URL'],
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
  };
}

/** Maps TRUST_PROXY onto Express's `trust proxy` setting (hop count, boolean, or address list). */
function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
