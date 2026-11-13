import { describe, expect, it } from 'vitest';
import { sharesOf } from './shares.js';

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
