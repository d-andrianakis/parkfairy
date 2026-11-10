import { describe, expect, it, vi } from 'vitest';
import { PlacesBudget } from './places-budget.js';

const HOUR_MS = 60 * 60_000;

/** Redis as far as the budget uses it, in memory. */
function fakeRedis() {
  const values = new Map<string, number>();
  return {
    values,
    incr: vi.fn((key: string) => {
      values.set(key, (values.get(key) ?? 0) + 1);
      return Promise.resolve(values.get(key) ?? 0);
    }),
    pexpire: vi.fn(() => Promise.resolve(1)),
    set: vi.fn((key: string) => {
      if (values.has(key)) return Promise.resolve(null);
      values.set(key, 1);
      return Promise.resolve('OK');
    }),
  };
}

describe('PlacesBudget', () => {
  it('without Redis, counts per clock hour and starts again with the next', async () => {
    let now = 5 * HOUR_MS + 10;
    const budget = new PlacesBudget(2, null, vi.fn(), () => now);
    expect(await budget.spend()).toBe(true);
    expect(await budget.spend()).toBe(true);
    expect(await budget.spend()).toBe(false);
    now = 6 * HOUR_MS;
    expect(await budget.spend()).toBe(true);
  });

  it('counts a session once, as Mapbox bills it, however many calls it takes', async () => {
    const redis = fakeRedis();
    const budget = new PlacesBudget(2, redis as never, vi.fn(), () => 7 * HOUR_MS + 1);
    for (let n = 0; n < 6; n++) expect(await budget.spend('session-a')).toBe(true);
    expect(redis.values.get('places:budget:7')).toBe(1);
    expect(await budget.spend('session-b')).toBe(true);
    // A third unit is past the budget; a session under way goes on, its unit spent.
    expect(await budget.spend()).toBe(false);
    expect(await budget.spend('session-a')).toBe(true);
    expect(redis.pexpire).toHaveBeenCalledExactlyOnceWith('places:budget:7', 2 * HOUR_MS);
    expect(redis.set).toHaveBeenCalledWith('places:session:session-a', '1', 'PX', HOUR_MS, 'NX');
  });

  it('counts sessions once in memory too', async () => {
    const budget = new PlacesBudget(1, null, vi.fn(), () => HOUR_MS);
    expect(await budget.spend('session-a')).toBe(true);
    expect(await budget.spend('session-a')).toBe(true);
    expect(await budget.spend('session-b')).toBe(false);
  });

  it('counts in this instance while Redis fails, and reports it', async () => {
    const onError = vi.fn();
    const failure = new Error('down');
    const redis = { incr: vi.fn(), pexpire: vi.fn(), set: vi.fn(() => Promise.reject(failure)) };
    const budget = new PlacesBudget(1, redis, onError, () => 3 * HOUR_MS);
    expect(await budget.spend('session-a')).toBe(true);
    expect(await budget.spend('session-b')).toBe(false);
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
