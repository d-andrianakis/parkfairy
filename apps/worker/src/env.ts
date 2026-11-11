import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

/** This machine: the one place emails may go to files instead of being sent. */
const isLoopback = (url: string) =>
  URL.canParse(url) && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

const LOCAL_WEB_URL = 'http://localhost:3000';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    REDIS_URL: z.url(),
    DATABASE_URL: z.url(),
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4100),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** The web app's public origin, for links in emails. */
    BETTER_AUTH_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    EMAIL_FROM: z.preprocess(emptyToUndefined, z.string().optional()),
    EMAIL_OUTBOX_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
    /**
     * How fast the worker sends through Resend. The limit is the account's, shared with the web
     * app's account emails (password resets, which nobody can ask for again), which go at one a
     * second: 1 leaves them the other half of Resend's default 2 a second. Raise both together.
     */
    EMAIL_SENDS_PER_SECOND: z.preprocess(
      emptyToUndefined,
      // At least one send in a run's 25 s: below that the sender would claim nothing, silently.
      z.coerce.number().min(0.04).max(100).default(1),
    ),
  })
  .refine((env) => env.RESEND_API_KEY || isLoopback(env.BETTER_AUTH_URL ?? LOCAL_WEB_URL), {
    // As in the web app: keyed on the origin, so staging never writes emails to disk either.
    message: 'RESEND_API_KEY is required unless BETTER_AUTH_URL is this machine',
    path: ['RESEND_API_KEY'],
  })
  .refine((env) => !env.RESEND_API_KEY || env.EMAIL_FROM, {
    message: 'EMAIL_FROM is required with RESEND_API_KEY',
    path: ['EMAIL_FROM'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.BETTER_AUTH_URL, {
    message: 'BETTER_AUTH_URL is required in production (links in emails need the real origin)',
    path: ['BETTER_AUTH_URL'],
  });

export type Env = ReturnType<typeof loadEnv>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid worker environment:\n${z.prettifyError(parsed.error)}`);
  }
  return { ...parsed.data, webUrl: parsed.data.BETTER_AUTH_URL ?? LOCAL_WEB_URL };
}
