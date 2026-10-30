import { SESSION_TIMING } from '@parkfairy/auth';

/**
 * Whether Better Auth would extend this session now: once it is more than `updateAge` old,
 * i.e. its expiry is less than `expiresIn - updateAge` away.
 */
export function sessionRefreshDue(expiresAt: Date | string, now = Date.now()): boolean {
  const { expiresInSeconds, updateAgeSeconds } = SESSION_TIMING;
  return new Date(expiresAt).getTime() - (expiresInSeconds - updateAgeSeconds) * 1000 <= now;
}
