import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOKING_REFERENCE_PATTERN,
  BookingConfirmInputSchema,
  BookingHoldInputSchema,
  BookingListQuerySchema,
  BOOKINGS_MAX_PAGE,
  isVehiclePlate,
  normalizeVehiclePlate,
  OwnerBookingsQuerySchema,
  VEHICLE_PLATE_LIMITS,
} from './bookings.js';
import { isValidationMessage } from './validation.js';

const NOW = new Date('2026-10-29T08:12:00Z'); // 10:12 in Athens

function issues(result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return result.error?.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`) ?? [];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('vehicle plates', () => {
  it('reads Greek capitals as the Latin letters they look like', () => {
    expect(normalizeVehiclePlate('ΙΚΒ-1234')).toBe('IKB1234');
    expect(normalizeVehiclePlate('ΥΧΑ 9876')).toBe('YXA9876');
  });

  it('is the same car however it is typed', () => {
    const spellings = ['IKB 1234', 'ikb-1234', 'ικβ1234', 'Ικβ·1234', ' ΙΚΒ.1234 ', 'ΙΚΒ 1234'];
    for (const spelling of spellings) expect(normalizeVehiclePlate(spelling)).toBe('IKB1234');
  });

  it('drops accents, as a Greek keyboard can add them', () => {
    expect(normalizeVehiclePlate('ΆΒΈ-123')).toBe('ABE123');
  });

  it('accepts plates from elsewhere in the EU', () => {
    for (const plate of ['M-AB 1234', 'AB-123-CD', 'W 12345 X', '1-ABC-234']) {
      expect(isVehiclePlate(plate), plate).toBe(true);
    }
  });

  it('refuses Greek letters no plate uses, symbols, and wrong lengths', () => {
    for (const plate of ['ΔΛΦ-1234', 'IKB/1234', 'A', 'ABCDEFGHIJK', '<script>', '']) {
      expect(isVehiclePlate(plate), plate).toBe(false);
    }
  });

  it('refuses a long input before reading it', () => {
    expect(isVehiclePlate(`${' '.repeat(VEHICLE_PLATE_LIMITS.input)}AB12`)).toBe(false);
  });
});

describe('BookingConfirmInputSchema', () => {
  it('asks for a plate, then a readable one', () => {
    expect(issues(BookingConfirmInputSchema.safeParse({}))).toEqual(['vehiclePlate:plateRequired']);
    expect(issues(BookingConfirmInputSchema.safeParse({ vehiclePlate: '   ' }))).toEqual([
      'vehiclePlate:plateRequired',
    ]);
    expect(issues(BookingConfirmInputSchema.safeParse({ vehiclePlate: 'Δ-1' }))).toEqual([
      'vehiclePlate:plateInvalid',
    ]);
  });

  it('keeps what was typed; the API stores the normalized form', () => {
    expect(BookingConfirmInputSchema.parse({ vehiclePlate: ' ΙΚΒ-1234 ' })).toEqual({
      vehiclePlate: 'ΙΚΒ-1234',
    });
  });

  it('refuses fields it does not know', () => {
    expect(
      BookingConfirmInputSchema.safeParse({ vehiclePlate: 'IKB1234', status: 'confirmed' }).success,
    ).toBe(false);
  });
});

describe('BookingHoldInputSchema', () => {
  const hold = {
    listing: 'syntagma-square-garage',
    spaceId: '6f1c0a52-8c1e-4f0e-9b7a-2d3e4f5a6b7c',
    start: '2026-10-29T09:00:00Z',
    end: '2026-10-29T11:30:00Z',
  };

  it('accepts a listing, a space and a stay', () => {
    expect(BookingHoldInputSchema.parse(hold)).toEqual(hold);
  });

  it('checks the stay as a search does', () => {
    expect(
      issues(
        BookingHoldInputSchema.safeParse({
          ...hold,
          start: '2026-10-29T06:00:00Z',
          end: '2026-10-29T06:15:00Z',
        }),
      ),
    ).toEqual(['end:timeNotOnStep', 'start:startInPast']);
  });

  it('refuses a malformed listing or space, and owner or status fields', () => {
    expect(issues(BookingHoldInputSchema.safeParse({ ...hold, listing: '../admin' }))).toEqual([
      'listing:invalid',
    ]);
    expect(issues(BookingHoldInputSchema.safeParse({ ...hold, spaceId: 'A1' }))).toEqual([
      'spaceId:invalid',
    ]);
    expect(BookingHoldInputSchema.safeParse({ ...hold, userId: hold.spaceId }).success).toBe(false);
  });

  it('only reports catalog keys', () => {
    const result = BookingHoldInputSchema.safeParse({ listing: 1, spaceId: 2, start: 'x' });
    for (const issue of result.error?.issues ?? []) {
      expect(isValidationMessage(issue.message), issue.message).toBe(true);
    }
  });
});

describe('booking lists', () => {
  it('default to the first page of upcoming bookings', () => {
    expect(BookingListQuerySchema.parse({})).toEqual({ when: 'upcoming', page: 1 });
    expect(BookingListQuerySchema.parse({ when: 'past', page: '3' })).toEqual({
      when: 'past',
      page: 3,
    });
  });

  it('stop at a page nobody reads', () => {
    expect(BookingListQuerySchema.safeParse({ page: BOOKINGS_MAX_PAGE + 1 }).success).toBe(false);
    expect(OwnerBookingsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(OwnerBookingsQuerySchema.safeParse({ page: '1.5' }).success).toBe(false);
  });
});

it('writes references without letters people misread', () => {
  expect(BOOKING_REFERENCE_PATTERN.test('K7M4-Q2ZD')).toBe(true);
  for (const reference of ['K7M4Q2ZD', 'K7M4-Q2ZO', 'I7M4-Q2ZD', 'k7m4-q2zd']) {
    expect(BOOKING_REFERENCE_PATTERN.test(reference), reference).toBe(false);
  }
});
