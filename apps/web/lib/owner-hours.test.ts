import { ListingHoursInputSchema } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';
import {
  ALL_WEEK,
  daysToPeriods,
  periodsToDays,
  WEEKDAYS,
  WORKING_WEEK,
  type DayHours,
} from './owner-hours';

const closed: DayHours = { open: false, opens: '08:00', closes: '20:00' };
const week = (monday: DayHours, others: DayHours = closed) => [
  monday,
  ...Array.from({ length: 6 }, () => ({ ...others })),
];

describe('daysToPeriods', () => {
  it('writes a normal day as one period', () => {
    expect(daysToPeriods(week({ open: true, opens: '08:00', closes: '20:00' }))).toEqual([
      { weekday: 1, opens: '08:00', closes: '20:00' },
    ]);
  });

  it('leaves closed days out', () => {
    expect(daysToPeriods(week(closed))).toEqual([]);
  });

  it('splits a night across midnight onto two days', () => {
    expect(daysToPeriods(week({ open: true, opens: '18:00', closes: '02:00' }))).toEqual([
      { weekday: 1, opens: '18:00', closes: '24:00' },
      { weekday: 2, opens: '00:00', closes: '02:00' },
    ]);
  });

  it('carries Sunday night into Monday morning', () => {
    const days = [...Array.from({ length: 6 }, () => ({ ...closed }))];
    days.push({ open: true, opens: '20:00', closes: '03:00' });
    expect(daysToPeriods(days)).toEqual([
      { weekday: 1, opens: '00:00', closes: '03:00' },
      { weekday: 7, opens: '20:00', closes: '24:00' },
    ]);
  });

  it('treats a close at midnight as the end of the day', () => {
    expect(daysToPeriods(week({ open: true, opens: '08:00', closes: '00:00' }))).toEqual([
      { weekday: 1, opens: '08:00', closes: '24:00' },
    ]);
  });

  it('writes what passes the API’s own rules', () => {
    for (const days of [ALL_WEEK, WORKING_WEEK]) {
      expect(ListingHoursInputSchema.safeParse({ periods: daysToPeriods(days) }).success).toBe(
        true,
      );
    }
    const nights = WEEKDAYS.map(() => ({ open: true, opens: '06:00', closes: '02:00' }));
    expect(ListingHoursInputSchema.safeParse({ periods: daysToPeriods(nights) }).success).toBe(
      true,
    );
  });

  it('lets the API refuse a night that runs into the next morning’s opening', () => {
    const days = week(
      { open: true, opens: '18:00', closes: '09:00' },
      { open: true, opens: '08:00', closes: '12:00' },
    );
    expect(ListingHoursInputSchema.safeParse({ periods: daysToPeriods(days) }).success).toBe(false);
  });
});

describe('periodsToDays', () => {
  it('shows closed days as closed', () => {
    expect(periodsToDays([]).every((day) => !day.open)).toBe(true);
  });

  it.each([
    ['all week', ALL_WEEK],
    ['the working week', WORKING_WEEK],
    ['one night', week({ open: true, opens: '18:00', closes: '02:00' })],
    ['every night', WEEKDAYS.map(() => ({ open: true, opens: '06:00', closes: '02:00' }))],
    [
      'Sunday into Monday',
      [
        ...Array.from({ length: 6 }, () => ({ ...closed })),
        { open: true, opens: '20:00', closes: '03:00' },
      ],
    ],
  ])('round-trips %s', (_name, days) => {
    expect(periodsToDays(daysToPeriods(days))).toEqual(days);
  });

  it('keeps an opening day after a full day apart from it', () => {
    const days = periodsToDays([
      { weekday: 1, opens: '00:00', closes: '24:00' },
      { weekday: 2, opens: '00:00', closes: '12:00' },
    ]);
    expect(days[0]).toEqual({ open: true, opens: '00:00', closes: '24:00' });
    expect(days[1]).toEqual({ open: true, opens: '00:00', closes: '12:00' });
  });
});
