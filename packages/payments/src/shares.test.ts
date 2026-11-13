import { describe, expect, it } from 'vitest';
import { sharesOf, splitShares } from './shares.js';

describe('sharesOf', () => {
  it('gives Parkfairy its 10% and the owner the rest of a booking kept whole', () => {
    expect(sharesOf({ totalMinor: 2000, refundMinor: 0, commissionBps: 1000 })).toEqual({
      keptMinor: 2000,
      commissionMinor: 200,
      ownerMinor: 1800,
    });
  });

  it('counts the commission on what’s kept when part went back (#50)', () => {
    expect(sharesOf({ totalMinor: 2000, refundMinor: 1000, commissionBps: 1000 })).toEqual({
      keptMinor: 1000,
      commissionMinor: 100,
      ownerMinor: 900,
    });
  });

  it('leaves nothing to share when all of it went back', () => {
    expect(sharesOf({ totalMinor: 2000, refundMinor: 2000, commissionBps: 1000 })).toEqual({
      keptMinor: 0,
      commissionMinor: 0,
      ownerMinor: 0,
    });
  });

  it('rounds the commission half up, the cent left over the owner’s', () => {
    // 10% of 405 is 40.5: Parkfairy 41, the owner 364.
    expect(sharesOf({ totalMinor: 405, refundMinor: 0, commissionBps: 1000 })).toMatchObject({
      commissionMinor: 41,
      ownerMinor: 364,
    });
    // 12.5% of 333 is 41.625: 42.
    expect(sharesOf({ totalMinor: 333, refundMinor: 0, commissionBps: 1250 })).toMatchObject({
      commissionMinor: 42,
      ownerMinor: 291,
    });
    // The parts always add up to what's kept.
    for (let total = 0; total < 3000; total += 7) {
      for (const bps of [0, 999, 1000, 1500, 10_000]) {
        const { keptMinor, commissionMinor, ownerMinor } = sharesOf({
          totalMinor: total,
          refundMinor: Math.floor(total / 3),
          commissionBps: bps,
        });
        expect(commissionMinor + ownerMinor).toBe(keptMinor);
        expect(ownerMinor).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('refuses what can’t be: fractions of a cent, refunds over the total, rates past 100%', () => {
    expect(() => sharesOf({ totalMinor: 10.5, refundMinor: 0, commissionBps: 1000 })).toThrow(
      RangeError,
    );
    expect(() => sharesOf({ totalMinor: 100, refundMinor: 101, commissionBps: 1000 })).toThrow(
      RangeError,
    );
    expect(() => sharesOf({ totalMinor: 100, refundMinor: 0, commissionBps: 10_001 })).toThrow(
      RangeError,
    );
  });
});

describe('splitShares', () => {
  const payee = (ownerId: string, shareBps: number, primary = false) => ({
    ownerId,
    shareBps,
    primary,
  });

  it('gives each payee their share of the owners’ part, all of it and no more', () => {
    expect(
      Object.fromEntries(splitShares(1800, [payee('a', 7000, true), payee('b', 3000)])),
    ).toEqual({ a: 1260, b: 540 });
    expect(Object.fromEntries(splitShares(1800, [payee('a', 10_000, true)]))).toEqual({
      a: 1800,
    });
  });

  it('hands the cents left over to the largest remainders, the primary first on a tie', () => {
    // A third each of 100: 33.33 each, one cent over, to the primary.
    expect(
      Object.fromEntries(
        splitShares(100, [payee('c', 3334), payee('a', 3333, true), payee('b', 3333)]),
      ),
    ).toEqual({ c: 34, a: 33, b: 33 });
    expect(Object.fromEntries(splitShares(1, [payee('z', 5000), payee('y', 5000, true)]))).toEqual({
      z: 0,
      y: 1,
    });
    // Without a primary in the tie, by owner id: the same split every time.
    expect(Object.fromEntries(splitShares(1, [payee('z', 5000), payee('m', 5000)]))).toEqual({
      z: 0,
      m: 1,
    });
  });

  it('always adds up exactly', () => {
    const payees = [payee('a', 4100, true), payee('b', 3300), payee('c', 1700), payee('d', 900)];
    for (let total = 0; total < 2000; total += 13) {
      const parts = [...splitShares(total, payees).values()];
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
      expect(Math.min(...parts)).toBeGreaterThanOrEqual(0);
    }
  });

  it('refuses what can’t be split', () => {
    expect(() => splitShares(10, [])).toThrow(RangeError);
    expect(() => splitShares(10.5, [payee('a', 10_000)])).toThrow(RangeError);
    expect(() => splitShares(10, [payee('a', 0)])).toThrow(RangeError);
  });
});
