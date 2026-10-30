import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Where the smoke suite points. Locally and in CI it boots the built apps itself.
 * Post-deploy, set SMOKE_WEB_URL (and SMOKE_API_URL / SMOKE_WORKER_URL if those are
 * reachable from the runner); checks that need an unreachable service are skipped.
 */
const external = Boolean(process.env.SMOKE_WEB_URL);

export const WEB_URL = process.env.SMOKE_WEB_URL ?? 'http://localhost:3000';
export const API_URL =
  process.env.SMOKE_API_URL ?? (external ? undefined : 'http://localhost:4000');
export const WORKER_URL =
  process.env.SMOKE_WORKER_URL ?? (external ? undefined : 'http://localhost:4100');

/**
 * Where the web app on this machine writes emails. A deployed site really sends them, unless
 * EMAIL_OUTBOX_DIR says the target is another local run (e.g. beside `pnpm dev`, on other ports).
 */
export const EMAIL_OUTBOX =
  process.env.EMAIL_OUTBOX_DIR ??
  (external ? undefined : fileURLToPath(new URL('../../../.emails', import.meta.url)));

/**
 * Whether the demo listings from `pnpm db:seed` exist (always locally and in CI; a shared
 * environment opts in with SMOKE_DEMO_DATA=true).
 */
export const DEMO_DATA = !external || process.env.SMOKE_DEMO_DATA === 'true';

/** An address in the range reserved for benchmarking (198.18.0.0/15, RFC 2544). */
export function visitorAddress(): string {
  const host = randomInt(2 ** 17);
  return `198.${18 + (host >> 16)}.${(host >> 8) & 255}.${host & 255}`;
}

/**
 * Rate limits count per client, and everything local arrives from 127.0.0.1, so each worker
 * process is a visitor of its own: a re-run meets none of the last run's counters. Works because
 * the local web app (TRUSTED_PROXIES=none) trusts a single forwarded address; the limits stay
 * as they are. Specs that sign in repeatedly go further with `ownVisitor`.
 */
export const VISITOR_HEADERS: Record<string, string> =
  external && !process.env.EMAIL_OUTBOX_DIR ? {} : { 'x-forwarded-for': visitorAddress() };

/** Browser state of the shared smoke account (created or signed in by auth.setup.ts). */
export const SIGNED_IN_STATE = '.auth/user.json';

/** Pre-provisioned account for runs against shared environments, so smoke runs don't create users. */
export const SMOKE_USER =
  process.env.SMOKE_USER_EMAIL && process.env.SMOKE_USER_PASSWORD
    ? { email: process.env.SMOKE_USER_EMAIL, password: process.env.SMOKE_USER_PASSWORD }
    : undefined;

export const TEST_PASSWORD = 'correct horse battery staple';
