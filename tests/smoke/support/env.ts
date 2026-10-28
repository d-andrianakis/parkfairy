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

/** Browser state of the shared smoke account (created or signed in by auth.setup.ts). */
export const SIGNED_IN_STATE = '.auth/user.json';

/** Pre-provisioned account for runs against shared environments, so smoke runs don't create users. */
export const SMOKE_USER =
  process.env.SMOKE_USER_EMAIL && process.env.SMOKE_USER_PASSWORD
    ? { email: process.env.SMOKE_USER_EMAIL, password: process.env.SMOKE_USER_PASSWORD }
    : undefined;

export const TEST_PASSWORD = 'correct horse battery staple';
