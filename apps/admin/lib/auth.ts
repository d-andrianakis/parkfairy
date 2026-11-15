import 'server-only';
import { createAuth, parseOrigins, redisRateLimitStorage, type Auth } from '@parkfairy/auth';
import { createDatabase, type DatabaseConnection } from '@parkfairy/database';
import { Redis } from 'ioredis';
import { parseServerEnv } from './server-env';

// Survive hot reloads in development without leaking a new pool on every edit.
const globalForAuth = globalThis as unknown as {
  parkfairyAdminDb?: DatabaseConnection;
  parkfairyAdminRedis?: Redis;
  parkfairyAdminAuth?: Auth;
};

/**
 * The same Better Auth as the public site (same database and secret, so the API reads the cookie
 * it sets), served from this app's own origin so the cookie never reaches the public one. Built on
 * first use so `next build` needs no runtime secrets. Only sign-in and sign-out are reachable
 * through `app/api/auth` (`lib/auth-routes.ts`); nothing here can create an account.
 */
export function getAuth(): Auth {
  if (globalForAuth.parkfairyAdminAuth) return globalForAuth.parkfairyAdminAuth;

  const env = parseServerEnv(process.env);
  globalForAuth.parkfairyAdminDb ??= createDatabase({
    connectionString: env.DATABASE_URL,
    max: 3,
    applicationName: 'parkfairy-admin',
    // Every signed-in page render looks the session up; never let one hang the page.
    statementTimeoutMs: 3000,
    connectionTimeoutMs: 2000,
  });
  if (env.REDIS_URL && !globalForAuth.parkfairyAdminRedis) {
    // As on the public site: commands never queue, and the limits count in memory meanwhile.
    globalForAuth.parkfairyAdminRedis = new Redis(env.REDIS_URL, {
      commandTimeout: 500,
      socketTimeout: 1000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectionName: 'parkfairy-admin-rate-limit',
    });
  }
  globalForAuth.parkfairyAdminAuth = createAuth({
    db: globalForAuth.parkfairyAdminDb.db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.ADMIN_URL,
    trustedOrigins: parseOrigins(new URL(env.ADMIN_URL).origin),
    rateLimitStorage: globalForAuth.parkfairyAdminRedis
      ? redisRateLimitStorage(globalForAuth.parkfairyAdminRedis)
      : undefined,
    trustedProxies: env.trustedProxies,
    // Staff have confirmed addresses already, and a reset is done on the public site. Nothing is
    // sent from here: a refused sign-in must not mail anyone.
    sendEmail: () => undefined,
  });
  return globalForAuth.parkfairyAdminAuth;
}
