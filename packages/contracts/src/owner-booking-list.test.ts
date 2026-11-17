import { describe, expect, it } from 'vitest';

import { bookingsCursor } from './bookings.js';
import {
  OWNER_BOOKINGS_DEFAULT_DAYS,
  OWNER_BOOKINGS_WINDOW_DAYS,
  OwnerBookingListItemSchema,
  OwnerBookingListQuerySchema,
  OwnerBookingListSchema,
  ownerBookingsReach,
  ownerBookingsWindow,
  platformToday,
} from './owner-booking-list.js';
import { addDays, daysBetween } from './time.js';

const place = bookingsCursor({
  start: new Date('2026-11-20T10:00:00Z'),
  id: '5b1d3a52-3f0e-4a77-9a5b-9d4d2c4f6a10',
});
/** A day `days` from today (the platform's): what may be asked for moves with the calendar. */
const day = (days: number) => addDays(platformToday(), days);
const listing = { id: '9f8e7d6c-1b2a-4c3d-8e9f-0a1b2c3d4e5f', name: 'Garage', contentLocale: 'en' };

describe('OwnerBookingListQuerySchema', () => {
  it('defaults to the upcoming bookings of every listing', () => {
    expect(OwnerBookingListQuerySchema.parse({})).toEqual({ status: 'upcoming' });
  });

  it('takes a status, a listing, days and one place', () => {
    const query = {
      status: 'past',
      listing: listing.id,
      from: day(-40),
      to: day(-10),
      after: place,
    };
    expect(OwnerBookingListQuerySchema.parse(query)).toEqual(query);
    expect(OwnerBookingListQuerySchema.parse({ before: place })).toEqual({
      status: 'upcoming',
      before: place,
    });
  });

  it.each([
    ['an unknown status', { status: 'all' }],
    ['a listing that is not an id', { listing: 'one' }],
    ['a day that does not exist', { from: `${day(0).slice(0, 4)}-02-30` }],
    ['a day written another way', { from: '1/11/2026' }],
    ['a day long ago', { from: '1999-12-31' }],
    ['a day far off', { to: '9999-12-31' }],
    ['a day before what the calendar reaches', { from: addDays(ownerBookingsReach().min, -1) }],
    ['a day after what the calendar reaches', { to: addDays(ownerBookingsReach().max, 1) }],
    ['a place that was never given out', { after: 'next' }],
    ['a place past year 9999', { before: `${253_402_300_800_000}_${place.split('_')[1]}` }],
    ['both places', { after: place, before: place }],
    ['days the wrong way round', { from: day(-1), to: day(-2) }],
    ['a window over a year', { from: day(-366), to: day(0) }],
    ['a status twice', { status: ['past', 'upcoming'] }],
    ['a listing twice', { listing: [listing.id, listing.id] }],
  ])('refuses %s', (_name, query) => {
    expect(OwnerBookingListQuerySchema.safeParse(query).success).toBe(false);
  });

  it('allows a window of exactly a year, a single day, and the edges of the reach', () => {
    expect(OwnerBookingListQuerySchema.safeParse({ from: day(-365), to: day(0) }).success).toBe(
      true,
    );
    expect(OwnerBookingListQuerySchema.safeParse({ from: day(0), to: day(0) }).success).toBe(true);
    expect(OWNER_BOOKINGS_WINDOW_DAYS).toBe(366);
    const { min, max } = ownerBookingsReach();
    expect(OwnerBookingListQuerySchema.safeParse({ from: min }).success).toBe(true);
    expect(OwnerBookingListQuerySchema.safeParse({ to: max }).success).toBe(true);
  });

  it('answers a refused window with the validation key, on the field', () => {
    const result = OwnerBookingListQuerySchema.safeParse({ from: day(-1), to: day(-2) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ message: 'invalid', path: ['to'] });
  });
});

describe('ownerBookingsWindow', () => {
  // 2026-11-16 12:00 in Athens.
  const now = new Date('2026-11-16T10:00:00Z');

  it('leaves upcoming bookings as asked for, unbounded by default', () => {
    expect(ownerBookingsWindow('upcoming', {}, now)).toEqual({ from: null, to: null });
    expect(ownerBookingsWindow('upcoming', { from: '2026-12-01' }, now)).toEqual({
      from: '2026-12-01',
      to: null,
    });
  });

  it('gives past bookings the last 90 days up to today', () => {
    expect(ownerBookingsWindow('past', {}, now)).toEqual({ from: '2026-08-18', to: '2026-11-16' });
    expect(OWNER_BOOKINGS_DEFAULT_DAYS).toBe(90);
  });

  it('gives cancelled bookings the last 90 days and every day after, future stays included', () => {
    expect(ownerBookingsWindow('cancelled', {}, now)).toEqual({ from: '2026-08-18', to: null });
  });

  it.each([
    ['summer time', '2026-07-15T21:30:00Z', '2026-07-16'],
    ['the night the clocks go forward', '2026-03-28T22:30:00Z', '2026-03-29'],
    ['the hour after they go forward', '2026-03-29T21:30:00Z', '2026-03-30'],
    ['the night they go back', '2026-10-24T21:30:00Z', '2026-10-25'],
    ['the hour after they go back', '2026-10-25T22:30:00Z', '2026-10-26'],
  ])('reads the platform day at %s', (_name, instant, day) => {
    expect(platformToday(new Date(instant))).toBe(day);
    expect(ownerBookingsWindow('past', {}, new Date(instant)).to).toBe(day);
  });

  it('reads the platform day, not the UTC one, at the edge of midnight', () => {
    // 22:30 UTC on the 15th is already the 16th in Athens (UTC+2).
    expect(ownerBookingsWindow('past', {}, new Date('2026-11-15T22:30:00Z')).to).toBe('2026-11-16');
  });

  it('bounds a lone `from` by a year, and a past one by today', () => {
    expect(ownerBookingsWindow('cancelled', { from: '2026-01-01' }, now)).toEqual({
      from: '2026-01-01',
      to: '2027-01-01',
    });
    expect(ownerBookingsWindow('past', { from: '2026-01-01' }, now)).toEqual({
      from: '2026-01-01',
      to: '2026-11-16',
    });
  });

  it('bounds a lone `to` by a year before it', () => {
    const window = ownerBookingsWindow('past', { to: '2026-06-30' }, now);
    expect(window.to).toBe('2026-06-30');
    expect(daysBetween(window.from ?? '', window.to ?? '')).toBe(OWNER_BOOKINGS_WINDOW_DAYS - 1);
  });

  it('bounds a lone day for every group, and a first day still to come reads no past stays', () => {
    expect(ownerBookingsWindow('upcoming', { to: '2026-12-31' }, now)).toEqual({
      from: null,
      to: '2026-12-31',
    });
    expect(ownerBookingsWindow('cancelled', { to: '2026-06-30' }, now).from).toBe('2025-06-30');
    expect(ownerBookingsWindow('past', { from: '2024-12-01' }, now)).toEqual({
      from: '2024-12-01',
      to: '2025-12-01',
    });
    // Over before it starts: the window is backwards, and the list is simply empty.
    const ahead = ownerBookingsWindow('past', { from: '2026-12-01' }, now);
    expect(ahead.from && ahead.to && ahead.from > ahead.to).toBe(true);
  });

  it('keeps both days when both are asked for', () => {
    expect(ownerBookingsWindow('past', { from: '2026-10-01', to: '2026-10-05' }, now)).toEqual({
      from: '2026-10-01',
      to: '2026-10-05',
    });
  });

  it('reaches 24 months either side of this month, whole months', () => {
    expect(ownerBookingsReach(now)).toEqual({ min: '2024-11-01', max: '2028-11-30' });
    // Midnight's edge: already December in Athens.
    expect(ownerBookingsReach(new Date('2026-11-30T22:30:00Z')).min).toBe('2024-12-01');
  });

  it('never opens a window further back than may be asked for outright', () => {
    const { min } = ownerBookingsReach(now);
    expect(ownerBookingsWindow('past', { to: addDays(min, 30) }, now)).toEqual({
      from: min,
      to: addDays(min, 30),
    });
    expect(() =>
      ownerBookingsWindow('cancelled', { from: ownerBookingsReach(now).max }, now),
    ).not.toThrow();
  });
});

describe('OwnerBookingListSchema', () => {
  const booking = {
    id: '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a',
    reference: '7K3Q-9XAB',
    listing,
    timeZone: 'Europe/Athens',
    spaceLabel: 'A1',
    start: '2026-11-20T10:00:00.000Z',
    end: '2026-11-20T12:00:00.000Z',
    driverName: 'Maria',
    vehiclePlate: 'IKB1234',
    total: { amountMinor: 800, currency: 'EUR' },
    state: 'upcoming',
    cancelledBy: null,
    cancelledAt: null,
    overstay: null,
    canReportOverstay: false,
  };
  const list = {
    status: 'upcoming',
    listing: null,
    from: null,
    to: null,
    listings: [listing],
    bookings: [booking],
    previous: null,
    next: place,
  };

  it('accepts a page of bookings', () => {
    expect(OwnerBookingListSchema.safeParse(list).success).toBe(true);
  });

  it('carries a report of a car left past the stay, and whether one can still be made (5.2c4)', () => {
    const reported = {
      ...booking,
      state: 'ended',
      overstay: { reportedAt: '2026-11-21T09:00:00.000Z', status: 'open' },
    };
    expect(OwnerBookingListItemSchema.safeParse(reported).success).toBe(true);
    expect(
      OwnerBookingListItemSchema.safeParse({ ...reported, canReportOverstay: true }).success,
    ).toBe(true);
    expect(
      OwnerBookingListItemSchema.safeParse({ ...reported, overstay: { status: 'open' } }).success,
    ).toBe(false);
    // Staff's own note never rides along.
    expect(
      JSON.stringify(
        OwnerBookingListItemSchema.parse({
          ...reported,
          overstay: { ...reported.overstay, resolution: 'Ticket 7001' },
        }),
      ),
    ).not.toContain('7001');
  });

  it('knows who called a booking off, and no one’s earnings', () => {
    const cancelled = {
      ...booking,
      state: 'cancelled',
      cancelledBy: 'owner',
      cancelledAt: '2026-11-18T09:00:00.000Z',
    };
    expect(OwnerBookingListItemSchema.safeParse(cancelled).success).toBe(true);
    // Strict output: an extra field (a share, a payout) is never carried along.
    expect(
      Object.keys(OwnerBookingListItemSchema.parse({ ...cancelled, share: 90 })),
    ).not.toContain('share');
  });

  it('refuses a state it does not know and a page over the size', () => {
    expect(OwnerBookingListItemSchema.safeParse({ ...booking, state: 'held' }).success).toBe(false);
    expect(
      OwnerBookingListSchema.safeParse({ ...list, bookings: Array(21).fill(booking) }).success,
    ).toBe(false);
  });
});
