import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PLACES_PER_VISITOR_HOUR, PlacesVisitorGuard } from './places-visitor.guard.js';

const HOUR_MS = 60 * 60_000;

function contextFor(handler: string, headers: Record<string, string> = {}) {
  const request = { headers, ip: '203.0.113.9' };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ header: vi.fn() }) }),
    getHandler: () => ({ name: handler }),
    getClass: () => ({ name: 'PlacesController' }),
  } as unknown as ExecutionContext;
}

async function guarded() {
  const increment = vi.fn(() =>
    Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
  );
  const guard = new PlacesVisitorGuard(
    { throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }] },
    { increment },
    new Reflector(),
  );
  await guard.onModuleInit();
  return { guard, increment };
}

describe('PlacesVisitorGuard', () => {
  it('caps each visitor per hour under one key, whichever route they call', async () => {
    const { guard, increment } = await guarded();
    await guard.canActivate(contextFor('getPlaceSuggestions'));
    await guard.canActivate(contextFor('retrievePlace'));
    const [first, second] = increment.mock.calls as unknown as [string, number, number, number][];
    expect(first?.[0]).toBe(second?.[0]);
    expect(first?.slice(1, 4)).toEqual([HOUR_MS, PLACES_PER_VISITOR_HOUR, HOUR_MS]);
  });

  it('refuses what another site’s page sends from a visitor’s browser', async () => {
    const { guard, increment } = await guarded();
    for (const site of ['cross-site', 'same-site']) {
      await expect(
        guard.canActivate(contextFor('findPlaces', { 'sec-fetch-site': site })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(increment).not.toHaveBeenCalled();
  });

  it('lets our own pages, typed addresses and the web server through', async () => {
    const { guard } = await guarded();
    const cases: Record<string, string>[] = [
      { 'sec-fetch-site': 'same-origin' },
      { 'sec-fetch-site': 'none' },
      {},
    ];
    for (const headers of cases) {
      await expect(guard.canActivate(contextFor('findPlaces', headers))).resolves.toBe(true);
    }
  });
});
