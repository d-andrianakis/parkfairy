import { isIP } from 'node:net';

import { z } from 'zod';

// No 'server-only' here: instrumentation.ts loads this outside the server-component layer.

/** This machine: the one place the staff app may share a hostname with the public site. */
const isLoopback = (url: string) =>
  URL.canParse(url) && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const ServerEnvSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    DATABASE_URL: z.url(),
    /** The same secret as every other service: it signs the session cookie the API reads. */
    BETTER_AUTH_SECRET: z.string().min(32),
    /** The staff app's own public origin: where its sign-in handlers live and its cookie belongs. */
    ADMIN_URL: z.url(),
    /** The public site's origin, for sending staff to enrol a second factor there. */
    BETTER_AUTH_URL: z.url(),
    /** The API the rewrite and the page loaders call; no default where it matters, see below. */
    API_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    REDIS_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    /** As for the web app: the proxies in front of this one, or `none`. */
    TRUSTED_PROXIES: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.REDIS_URL, {
    message: 'REDIS_URL is required in production (rate limits must be shared across instances)',
    path: ['REDIS_URL'],
  })
  .refine(
    (env) =>
      !env.TRUSTED_PROXIES || env.TRUSTED_PROXIES === 'none' || validProxies(env.TRUSTED_PROXIES),
    {
      message: 'TRUSTED_PROXIES must list IP addresses or CIDR ranges (e.g. 10.0.0.0/8)',
      path: ['TRUSTED_PROXIES'],
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.TRUSTED_PROXIES, {
    message: 'TRUSTED_PROXIES is required in production (the proxy addresses, or "none")',
    path: ['TRUSTED_PROXIES'],
  })
  .refine((env) => new URL(env.ADMIN_URL).origin !== new URL(env.BETTER_AUTH_URL).origin, {
    // One origin for both would put staff screens beside the public pages, which #66 rules out.
    message: 'ADMIN_URL must be an origin of its own, not the public site',
    path: ['ADMIN_URL'],
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      isLoopback(env.ADMIN_URL) ||
      new URL(env.ADMIN_URL).hostname !== new URL(env.BETTER_AUTH_URL).hostname,
    {
      // Keyed on the origin, not NODE_ENV: the smoke suite runs production builds on this machine.
      // Cookies ignore ports: two origins on one hostname share one cookie jar, so the staff
      // session would reach the public site and the other way round.
      message: 'In production ADMIN_URL needs a hostname of its own, not just another port',
      path: ['ADMIN_URL'],
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      isLoopback(env.ADMIN_URL) ||
      env.ADMIN_URL.startsWith('https://'),
    {
      // The session cookie is only marked Secure (and prefixed) when the origin is https.
      message: 'ADMIN_URL must be https in production',
      path: ['ADMIN_URL'],
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || isLoopback(env.ADMIN_URL) || env.API_URL, {
    // The rewrite is built from it at build time; without it staff calls fail with 5xx.
    message: 'API_URL is required in production',
    path: ['API_URL'],
  });

/** Every entry an IPv4/IPv6 address or a CIDR range of one. */
function validProxies(list: string): boolean {
  return list.split(',').every((entry) => {
    const [address = '', bits, ...rest] = entry.trim().split('/');
    const version = isIP(address);
    if (!version || rest.length > 0) return false;
    if (bits === undefined) return true;
    const prefix = Number(bits);
    return /^\d+$/.test(bits) && prefix <= (version === 4 ? 32 : 128);
  });
}

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

export type ServerEnv = ReturnType<typeof parseServerEnv>;

/** For server start: exits, because Next only logs a failed `register()` and serves on. */
export function requireServerEnv(source: Record<string, string | undefined>): void {
  try {
    parseServerEnv(source);
  } catch (error) {
    console.error('Invalid configuration, not starting', error);
    process.exit(1);
  }
}
