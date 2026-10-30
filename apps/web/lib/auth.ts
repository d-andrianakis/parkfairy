import 'server-only';
import {
  createAuth,
  memoryRateLimitStorage,
  parseOrigins,
  redisRateLimitStorage,
  type Auth,
  type RateLimitStorage,
} from '@parkfairy/auth';
import { createDatabase, type DatabaseConnection } from '@parkfairy/database';
import { resolve } from 'node:path';
import { after } from 'next/server';
import { Redis } from 'ioredis';
import { createEmailDelivery } from './email/delivery';
import { outboxTransport, resendTransport } from './email/transport';
import { parseServerEnv, type ServerEnv } from './server-env';

/** Account emails: through Resend with a key, otherwise to files (`parseServerEnv` guards that). */
export function emailDelivery(env: ServerEnv, limits: RateLimitStorage) {
  return createEmailDelivery({
    transport: env.resend
      ? resendTransport(env.resend)
      : outboxTransport(env.EMAIL_OUTBOX_DIR ?? resolve(process.cwd(), '../../.emails')),
    limits,
    schedule: (work) => after(work),
  });
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
    // Commands never queue: while Redis is away (or still connecting) they fail at once and
    // the limits count in this process's memory instead, so nothing waits and no free pass
    // is given. A hung connection is dropped after a second without data.
    globalForAuth.parkfairyRedis = new Redis(env.REDIS_URL, {
      commandTimeout: 500,
      socketTimeout: 1000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectionName: 'parkfairy-web-rate-limit',
    });
  }
  const rateLimitStorage = globalForAuth.parkfairyRedis
    ? redisRateLimitStorage(globalForAuth.parkfairyRedis)
    : undefined;
  globalForAuth.parkfairyAuth = createAuth({
    db: globalForAuth.parkfairyDb.db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: parseOrigins(env.TRUSTED_ORIGINS),
    rateLimitStorage,
    trustedProxies: env.trustedProxies,
    sendEmail: emailDelivery(env, rateLimitStorage ?? memoryRateLimitStorage()),
  });
  return globalForAuth.parkfairyAuth;
}
