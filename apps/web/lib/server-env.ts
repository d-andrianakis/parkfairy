import { isIP } from 'node:net';
import { z } from 'zod';

// No 'server-only' here: instrumentation.ts loads this outside the server-component layer.

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

/** This machine: the one place emails may go to files instead of being sent. */
const isLoopback = (url: string) =>
  URL.canParse(url) && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

/** `a@b.gr` or `Name <a@b.gr>`. */
const SENDER = /^(?:[^<>]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;

const ServerEnvSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    TRUSTED_ORIGINS: z.string().default(''),
    /** Shared rate-limit counters; without it each web instance counts on its own. */
    REDIS_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    /**
     * Comma-separated addresses/CIDRs of the proxies in front of the web app, or `none`.
     * `none` means Better Auth trusts a single X-Forwarded-For value, so it is safe only when
     * the platform in front overwrites that header with the client address (or locally):
     * Next.js keeps a header the visitor sent.
     */
    TRUSTED_PROXIES: z.preprocess(emptyToUndefined, z.string().optional()),
    /** Without a key, emails become files in EMAIL_OUTBOX_DIR (default: `.emails` at the root). */
    RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    /** e.g. `Parkfairy <no-reply@parkfairy.gr>`, on a domain verified with Resend. */
    EMAIL_FROM: z.preprocess(emptyToUndefined, z.string().optional()),
    EMAIL_OUTBOX_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
    /** Goes to owners' browsers, so a secret token pasted here would be published. */
    MAPBOX_PUBLIC_TOKEN: z.preprocess(emptyToUndefined, z.string().startsWith('pk.').optional()),
  })
  .refine((env) => env.RESEND_API_KEY || isLoopback(env.BETTER_AUTH_URL), {
    // Keyed on the origin, not NODE_ENV: staging must not write live reset links to disk either.
    message: 'RESEND_API_KEY is required unless BETTER_AUTH_URL is this machine',
    path: ['RESEND_API_KEY'],
  })
  .refine((env) => !env.RESEND_API_KEY || env.EMAIL_FROM, {
    message: 'EMAIL_FROM is required with RESEND_API_KEY',
    path: ['EMAIL_FROM'],
  })
  .refine((env) => !env.EMAIL_FROM || SENDER.test(env.EMAIL_FROM), {
    // Otherwise every send fails at runtime, seen only in the logs.
    message: 'EMAIL_FROM must be an address, or Name <address>',
    path: ['EMAIL_FROM'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.REDIS_URL, {
    message: 'REDIS_URL is required in production (rate limits must be shared across instances)',
    path: ['REDIS_URL'],
  })
  .refine(
    (env) =>
      !env.TRUSTED_PROXIES || env.TRUSTED_PROXIES === 'none' || validProxies(env.TRUSTED_PROXIES),
    {
      // Better Auth drops invalid entries with a warning, which quietly trusts visitors again.
      message: 'TRUSTED_PROXIES must list IP addresses or CIDR ranges (e.g. 10.0.0.0/8)',
      path: ['TRUSTED_PROXIES'],
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.TRUSTED_PROXIES, {
    // Without it Better Auth trusts a single-value X-Forwarded-For, which a visitor can set.
    message: 'TRUSTED_PROXIES is required in production (the proxy addresses, or "none")',
    path: ['TRUSTED_PROXIES'],
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
    resend:
      env.RESEND_API_KEY && env.EMAIL_FROM
        ? { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }
        : undefined,
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
