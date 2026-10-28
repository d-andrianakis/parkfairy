import 'server-only';
import { createAuth, parseOrigins, type Auth } from '@parkfairy/auth';
import { createDatabase, type DatabaseConnection } from '@parkfairy/database';
import { z } from 'zod';

const ServerEnvSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  TRUSTED_ORIGINS: z.string().default(''),
});

// Survive hot reloads in development without leaking a new pool on every edit.
const globalForAuth = globalThis as unknown as {
  parkfairyDb?: DatabaseConnection;
  parkfairyAuth?: Auth;
};

/**
 * Lazily builds the Better Auth instance so `next build` does not need runtime
 * secrets. This app is the only place sessions are issued.
 */
export function getAuth(): Auth {
  if (globalForAuth.parkfairyAuth) return globalForAuth.parkfairyAuth;

  const env = ServerEnvSchema.parse(process.env);
  globalForAuth.parkfairyDb ??= createDatabase({
    connectionString: env.DATABASE_URL,
    max: 5,
    applicationName: 'parkfairy-web',
  });
  globalForAuth.parkfairyAuth = createAuth({
    db: globalForAuth.parkfairyDb.db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: parseOrigins(env.TRUSTED_ORIGINS),
  });
  return globalForAuth.parkfairyAuth;
}
