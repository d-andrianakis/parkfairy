import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addMonths,
  CALENDAR_BOOKINGS_MAX,
  CALENDAR_MONTHS_AWAY,
  currentMonth,
  monthsBetween,
  OwnerCalendarQuerySchema,
  OwnerCalendarSchema,
} from './owner-calendar.js';
import { isValidationMessage } from './validation.js';

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const listing = { id: ID, name: 'Garage Kolonaki', contentLocale: 'en' as const };
const booking = {
  id: ID,
  reference: 'K7M4-Q2ZD',
  listing,
  spaceLabel: 'A1',
  start: '2026-11-18T08:00:00.000Z',
  end: '2026-11-18T10:00:00.000Z',
  timeZone: 'Europe/Athens',
  driverName: 'Maria',
  vehiclePlate: 'IKB1234',
};
const calendar = {
  month: '2026-11',
  previous: '2026-10',
  next: '2026-12',
  listing: null,
  listings: [listing],
  days: [{ date: '2026-11-18', bookings: [booking] }],
  truncated: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-30T22:30:00Z')); // already 1 December in Athens
});
afterEach(() => vi.useRealTimers());

describe('months', () => {
  it('go by the platform’s clock: this month ends when Athens’s does', () => {
    expect(currentMonth()).toBe('2026-12');
    expect(currentMonth(new Date('2026-11-30T21:59:00Z'))).toBe('2026-11');
  });

  it('count across a year’s end, either way', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2026-03', -15)).toBe('2024-12');
    expect(addMonths('2026-11', 0)).toBe('2026-11');
  });

  it('tell how far apart two are, signed', () => {
    expect(monthsBetween('2026-11', '2026-11')).toBe(0);
    expect(monthsBetween('2026-11', '2027-02')).toBe(3);
    expect(monthsBetween('2026-11', '2026-01')).toBe(-10);
  });
});

describe('the calendar query', () => {
  it('is this month and every listing with nothing', () => {
    expect(OwnerCalendarQuerySchema.parse({})).toEqual({});
  });

  it('takes a month and a listing', () => {
    expect(OwnerCalendarQuerySchema.parse({ month: '2026-11', listing: ID })).toEqual({
      month: '2026-11',
      listing: ID,
    });
  });

  it('looks no further than two years either way', () => {
    const month = (away: number) =>
      OwnerCalendarQuerySchema.safeParse({ month: addMonths('2026-12', away) });
    expect(month(CALENDAR_MONTHS_AWAY).success).toBe(true);
    expect(month(-CALENDAR_MONTHS_AWAY).success).toBe(true);
    expect(month(CALENDAR_MONTHS_AWAY + 1).success).toBe(false);
    expect(month(-CALENDAR_MONTHS_AWAY - 1).success).toBe(false);
    expect(month(CALENDAR_MONTHS_AWAY + 1).error?.issues[0]?.path).toEqual(['month']);
  });

  it('refuses what is not a month or a listing, with a catalog message', () => {
    for (const query of [
      { month: '2026-13' },
      { month: '2026-1' },
      { month: 'november' },
      { month: '' },
      { listing: 'garage' },
      { listing: '' },
    ]) {
      const result = OwnerCalendarQuerySchema.safeParse(query);
      expect(result.success, JSON.stringify(query)).toBe(false);
      for (const issue of result.error?.issues ?? []) {
        expect(isValidationMessage(issue.message)).toBe(true);
      }
    }
  });
});

describe('the calendar view', () => {
  it('reads what the API answers', () => {
    expect(OwnerCalendarSchema.parse(calendar)).toEqual(calendar);
  });

  it('lists only days that have a booking, and never more than it may cut a month to', () => {
    expect(
      OwnerCalendarSchema.safeParse({ ...calendar, days: [{ date: '2026-11-18', bookings: [] }] })
        .success,
    ).toBe(false);
    const days = Array.from({ length: CALENDAR_BOOKINGS_MAX + 1 }, () => calendar.days[0]);
    expect(OwnerCalendarSchema.safeParse({ ...calendar, days }).success).toBe(false);
  });

  it('refuses a booking with a reference that is not ours, or a name past the limit', () => {
    const bad = (patch: object) =>
      OwnerCalendarSchema.safeParse({
        ...calendar,
        days: [{ date: '2026-11-18', bookings: [{ ...booking, ...patch }] }],
      }).success;
    expect(bad({})).toBe(true);
    expect(bad({ reference: 'IIII-OOOO' })).toBe(false);
    expect(bad({ driverName: 'x'.repeat(500) })).toBe(false);
  });
});
