import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AccountThrottlerGuard } from './account-throttler.guard.js';

class Exposed extends AccountThrottlerGuard {
  tracker(request: Record<string, unknown>) {
    return this.getTracker(request);
  }
}

const guard = new Exposed(
  { throttlers: [{ name: 'default', ttl: 60_000, limit: 10 }] },
  {
    increment: () =>
      Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
  },
  new Reflector(),
);

describe('AccountThrottlerGuard', () => {
  it('counts by the session’s account, wherever the requests come from', async () => {
    expect(await guard.tracker({ user: { id: 'user-1' }, ip: '203.0.113.1' })).toBe(
      'account:user-1',
    );
    expect(await guard.tracker({ user: { id: 'user-1' }, ip: '198.51.100.9' })).toBe(
      'account:user-1',
    );
  });

  it('falls back to the address with no account, so it never counts nobody', async () => {
    expect(await guard.tracker({ ip: '203.0.113.1' })).toBe('203.0.113.1');
    expect(await guard.tracker({ user: { id: 7 }, ip: '203.0.113.1' })).toBe('203.0.113.1');
  });
});
