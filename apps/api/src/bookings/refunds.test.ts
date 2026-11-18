import { describe, expect, it } from 'vitest';

import { fullRefundUntil, refundMinor } from './refunds.js';

const start = new Date('2026-12-10T10:00:00Z');
const before = (hours: number, minutes = 0) =>
  new Date(start.getTime() - (hours * 60 + minutes) * 60_000);
const refund = (policy: Parameters<typeof refundMinor>[0]['policy'], at: Date, totalMinor = 1001) =>
  refundMinor({ policy, totalMinor, start, at, by: 'driver' });

describe('refundMinor', () => {
  it('gives everything back until an hour before, then nothing (oneHour)', () => {
    expect(refund('oneHour', before(1))).toBe(1001);
    expect(refund('oneHour', before(0, 59))).toBe(0);
  });

  it('gives everything back until 24 hours before, then nothing (oneDay)', () => {
    expect(refund('oneDay', before(24))).toBe(1001);
    expect(refund('oneDay', before(23, 59))).toBe(0);
  });

  it('gives half from 24 hours before until the start, rounded for the driver (oneDayThenHalf)', () => {
    expect(refund('oneDayThenHalf', before(24))).toBe(1001);
    expect(refund('oneDayThenHalf', before(23, 59))).toBe(501);
    expect(refund('oneDayThenHalf', before(0, 1))).toBe(501);
    expect(refund('oneDayThenHalf', before(0, 1), 1000)).toBe(500);
  });

  it('gives nothing once the stay has started', () => {
    for (const policy of ['oneHour', 'oneDay', 'oneDayThenHalf'] as const) {
      expect(refund(policy, start)).toBe(0);
      expect(refund(policy, before(-1))).toBe(0);
    }
  });

  it('refunds in full when the owner calls it off, whatever the policy and time', () => {
    for (const at of [before(48), before(0, 5)]) {
      expect(refundMinor({ policy: 'oneHour', totalMinor: 750, start, at, by: 'owner' })).toBe(750);
    }
  });
});

describe('fullRefundUntil', () => {
  it('is the last moment a cancel still gives everything back, for each policy', () => {
    expect(fullRefundUntil('oneHour', start)).toEqual(before(1));
    expect(fullRefundUntil('oneDay', start)).toEqual(before(24));
    expect(fullRefundUntil('oneDayThenHalf', start)).toEqual(before(24));
  });

  it('agrees with refundMinor: full at that moment, less a moment later', () => {
    for (const policy of ['oneHour', 'oneDay', 'oneDayThenHalf'] as const) {
      const until = fullRefundUntil(policy, start);
      expect(refund(policy, until)).toBe(1001);
      expect(refund(policy, new Date(until.getTime() + 1))).toBeLessThan(1001);
    }
  });
});
