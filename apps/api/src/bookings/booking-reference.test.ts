import { BOOKING_REFERENCE_PATTERN } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';
import { newBookingReference } from './booking-reference.js';

describe('newBookingReference', () => {
  it('writes what the contract and the database accept', () => {
    for (let i = 0; i < 200; i++) {
      expect(newBookingReference()).toMatch(BOOKING_REFERENCE_PATTERN);
    }
  });

  it('uses every letter of the alphabet and none other', () => {
    const all = newBookingReference(Buffer.from([0, 1, 2, 3, 28, 29, 30, 31]));
    expect(all).toBe('0123-WXYZ');
    // The high bits don't matter: 0xff is 31 too.
    expect(newBookingReference(Buffer.from([0xff, 0xe0, 0x12, 0x33, 0, 0, 0, 0]))).toBe(
      'Z0JK-0000',
    );
  });

  it('rarely repeats', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => newBookingReference()));
    expect(seen.size).toBe(1000);
  });
});
