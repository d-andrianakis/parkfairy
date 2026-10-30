import { SESSION_TIMING } from '@parkfairy/auth';
import { describe, expect, it } from 'vitest';
import { sessionRefreshDue } from './session-refresh';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 2, 9);
const fullLife = SESSION_TIMING.expiresInSeconds * 1000;

describe('sessionRefreshDue', () => {
  it('is not due for a session refreshed less than a day ago', () => {
    expect(sessionRefreshDue(new Date(NOW + fullLife), NOW)).toBe(false);
    expect(sessionRefreshDue(new Date(NOW + fullLife - DAY + 60_000), NOW)).toBe(false);
  });

  it('is due once the session is a day old, as Better Auth sees it', () => {
    expect(sessionRefreshDue(new Date(NOW + fullLife - DAY), NOW)).toBe(true);
    expect(sessionRefreshDue(new Date(NOW + DAY).toISOString(), NOW)).toBe(true);
  });
});
