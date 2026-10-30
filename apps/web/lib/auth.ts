import 'server-only';
import { createAuth, parseOrigins, redisRateLimitStorage, type Auth } from '@parkfairy/auth';
import { createDatabase, type DatabaseConnection } from '@parkfairy/database';
import { Redis } from 'ioredis';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const ServerEnvSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    TRUSTED_ORIGINS: z.string().default(''),
    /** Shared rate-limit counters; without it each web instance counts on its own. */
    REDIS_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    /** Comma-separated addresses/CIDRs of the proxies in front of the web app, or `none`. */
    TRUSTED_PROXIES: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.REDIS_URL, {
    message: 'REDIS_URL is required in production (rate limits must be shared across instances)',
    path: ['REDIS_URL'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.TRUSTED_PROXIES, {
    // Without it Better Auth trusts a single-value X-Forwarded-For, which a visitor can set.
    message: 'TRUSTED_PROXIES is required in production (the proxy addresses, or "none")',
    path: ['TRUSTED_PROXIES'],
  });

export function parseServerEnv(source: Record<string, string | undefined>) {
  const env = ServerEnvSchema.parse(source);
  const proxies = env.TRUSTED_PROXIES === 'none' ? '' : (env.TRUSTED_PROXIES ?? '');
  return {
    ...env,
    trustedProxies: proxies
      .split(',')
      .map((proxy) => proxy.trim())
      .filter(Boolean),
  };
}

// Survive hot reloads in development without leaking a new pool on every edit.
const globalForAuth = globalThis as unknown as {
  parkfairyDb?: DatabaseConnection;
  parkfairyRedis?: Redis;
  parkfairyAuth?: Auth;
};

/**
 * Lazily builds the Better Auth instance so `next build` does not need runtime
 * secrets. This app is the only place sessions are issued.
 */
export function getAuth(): Auth {
  if (globalForAuth.parkfairyAuth) return globalForAuth.parkfairyAuth;

  const env = parseServerEnv(process.env);
  globalForAuth.parkfairyDb ??= createDatabase({
    connectionString: env.DATABASE_URL,
    max: 5,
    applicationName: 'parkfairy-web',
    // Every signed-in page render looks the session up; never let one hang the page.
    statementTimeoutMs: 3000,
    connectionTimeoutMs: 2000,
  });
  if (env.REDIS_URL && !globalForAuth.parkfairyRedis) {
    // At start-up commands wait briefly for the connection (no free pass); once connected
    // they fail at once while Redis is away, and the limits fall back to memory.
    const redis = new Redis(env.REDIS_URL, {
      commandTimeout: 500,
      maxRetriesPerRequest: 1,
      connectionName: 'parkfairy-web-rate-limit',
    });
    redis.once('ready', () => {
      redis.options.enableOfflineQueue = false;
    });
    globalForAuth.parkfairyRedis = redis;
  }
  globalForAuth.parkfairyAuth = createAuth({
    db: globalForAuth.parkfairyDb.db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: parseOrigins(env.TRUSTED_ORIGINS),
    rateLimitStorage: globalForAuth.parkfairyRedis
      ? redisRateLimitStorage(globalForAuth.parkfairyRedis)
      : undefined,
    trustedProxies: env.trustedProxies,
  });
  return globalForAuth.parkfairyAuth;
}
