import { describe, expect, it } from 'vitest';
import { bookingsCursor } from './bookings.js';
import {
  EARNING_HOLDS,
  EARNING_STATES,
  EARNINGS_IN_PROGRESS_MAX,
  EARNINGS_MONTHS,
  EARNINGS_PAGE_SIZE,
  EarningLineSchema,
  OwnerEarningsQuerySchema,
  OwnerEarningsSchema,
} from './earnings.js';
import { isValidationMessage } from './validation.js';

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' as const });
const listing = { id: ID, name: 'Garage Kolonaki', contentLocale: 'en' as const };
const line = {
  id: ID,
  reference: 'K7M4-Q2ZD',
  listing,
  end: '2026-11-10T09:00:00.000Z',
  state: 'sent' as const,
  amount: eur(1_800),
  sentAt: '2026-11-11T10:00:00.000Z',
  hold: null,
};
const earnings = {
  sent: eur(1_800),
  sending: eur(0),
  coming: 2,
  held: { account: 0, dispute: 0 },
  months: [{ month: '2026-11', amount: eur(1_800) }],
  listings: [{ listing, amount: eur(1_800) }],
  inProgress: [],
  lines: [line],
  next: null,
};

describe('the earnings query', () => {
  it('starts at the first page with nothing, and after a place a page gave out', () => {
    expect(OwnerEarningsQuerySchema.safeParse({}).success).toBe(true);
    const place = bookingsCursor({ start: new Date('2026-11-11T10:00:00Z'), id: ID });
    expect(OwnerEarningsQuerySchema.parse({ after: place })).toEqual({ after: place });
  });

  it('refuses a place no page gave out, with a catalog message', () => {
    for (const after of ['', 'later', '12_x', `99999999999999999_${ID}`]) {
      const result = OwnerEarningsQuerySchema.safeParse({ after });
      expect(result.success, after).toBe(false);
      for (const issue of result.error?.issues ?? []) {
        expect(isValidationMessage(issue.message)).toBe(true);
      }
    }
  });
});

describe('the earnings view', () => {
  it('reads what the API answers', () => {
    expect(OwnerEarningsSchema.parse(earnings)).toEqual(earnings);
  });

  it('names why a part worked out has not gone, and only then', () => {
    expect(EARNING_HOLDS).toEqual(['account', 'dispute']);
    expect(EARNING_STATES).toEqual(['sending', 'sent']);
    for (const hold of EARNING_HOLDS) {
      expect(
        EarningLineSchema.safeParse({ ...line, state: 'sending', sentAt: null, hold }).success,
      ).toBe(true);
    }
    expect(EarningLineSchema.safeParse({ ...line, hold: 'bank' }).success).toBe(false);
  });

  it('keeps every list within what a page can carry', () => {
    const many = (count: number) => Array.from({ length: count }, () => line);
    expect(
      OwnerEarningsSchema.safeParse({ ...earnings, lines: many(EARNINGS_PAGE_SIZE) }).success,
    ).toBe(true);
    expect(
      OwnerEarningsSchema.safeParse({ ...earnings, lines: many(EARNINGS_PAGE_SIZE + 1) }).success,
    ).toBe(false);
    expect(
      OwnerEarningsSchema.safeParse({ ...earnings, inProgress: many(EARNINGS_IN_PROGRESS_MAX + 1) })
        .success,
    ).toBe(false);
    const months = Array.from({ length: EARNINGS_MONTHS + 1 }, (_, i) => ({
      month: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
      amount: eur(1),
    }));
    expect(OwnerEarningsSchema.safeParse({ ...earnings, months }).success).toBe(false);
  });

  it('refuses a month that is not one, a negative amount and a reference that is not ours', () => {
    const bad = (patch: object) => OwnerEarningsSchema.safeParse({ ...earnings, ...patch }).success;
    expect(bad({ months: [{ month: '2026-13', amount: eur(1) }] })).toBe(false);
    expect(bad({ months: [{ month: '26-11', amount: eur(1) }] })).toBe(false);
    expect(bad({ sent: eur(-1) })).toBe(false);
    expect(bad({ lines: [{ ...line, reference: 'IIII-OOOO' }] })).toBe(false);
    expect(bad({ coming: -1 })).toBe(false);
  });

  it('carries the next place only as one a page can be asked for', () => {
    const place = bookingsCursor({ start: new Date('2026-11-11T10:00:00Z'), id: ID });
    expect(OwnerEarningsSchema.parse({ ...earnings, next: place }).next).toBe(place);
    expect(OwnerEarningsSchema.safeParse({ ...earnings, next: 'soon' }).success).toBe(false);
  });
});
