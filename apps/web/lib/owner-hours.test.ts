import { ListingHoursInputSchema, type OpeningPeriod } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';
import {
  ALL_WEEK,
  closedPartProblem,
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
const byDayAndTime = (a: OpeningPeriod, b: OpeningPeriod) =>
  a.weekday - b.weekday || a.opens.localeCompare(b.opens);

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

  it('takes a closed part out of the day, leaving two periods', () => {
    const lunch = {
      open: true,
      opens: '08:00',
      closes: '20:00',
      closedPart: { from: '14:00', to: '17:00' },
    };
    expect(daysToPeriods(week(lunch))).toEqual([
      { weekday: 1, opens: '08:00', closes: '14:00' },
      { weekday: 1, opens: '17:00', closes: '20:00' },
    ]);
  });

  it('takes a closed part out of the evening of a night that runs past midnight', () => {
    const night = {
      open: true,
      opens: '18:00',
      closes: '02:00',
      closedPart: { from: '20:00', to: '21:00' },
    };
    expect(daysToPeriods(week(night))).toEqual([
      { weekday: 1, opens: '18:00', closes: '20:00' },
      { weekday: 1, opens: '21:00', closes: '24:00' },
      { weekday: 2, opens: '00:00', closes: '02:00' },
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
    // The most a week can hold: every night past midnight, every day with a break.
    const busiest = nights.map((day) => ({ ...day, closedPart: { from: '14:00', to: '17:00' } }));
    expect(daysToPeriods(busiest)).toHaveLength(21);
    expect(ListingHoursInputSchema.safeParse({ periods: daysToPeriods(busiest) }).success).toBe(
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
      'a lunch break',
      week({
        open: true,
        opens: '08:00',
        closes: '20:00',
        closedPart: { from: '14:00', to: '17:00' },
      }),
    ],
    [
      'a break in a night',
      week({
        open: true,
        opens: '18:00',
        closes: '02:00',
        closedPart: { from: '20:00', to: '21:00' },
      }),
    ],
    [
      'a break on a day that closes at midnight',
      week({
        open: true,
        opens: '08:00',
        closes: '24:00',
        closedPart: { from: '13:00', to: '14:00' },
      }),
    ],
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

  it('keeps a day that opens at midnight its own when the night before ends at midnight', () => {
    // Monday evening to midnight, Tuesday from midnight to 20:00: once read as Monday 18:00 to
    // 20:00, so saving the page untouched lost Tuesday.
    const periods = [
      { weekday: 1, opens: '18:00', closes: '24:00' },
      { weekday: 2, opens: '00:00', closes: '20:00' },
    ];
    const days = periodsToDays(periods);
    expect(days[0]).toEqual({ open: true, opens: '18:00', closes: '24:00' });
    expect(days[1]).toEqual({ open: true, opens: '00:00', closes: '20:00' });
    expect(daysToPeriods(days)).toEqual(periods);
  });

  it('reads a break the day after a night, three periods on one day', () => {
    const days = week({ open: true, opens: '18:00', closes: '02:00' });
    days[1] = {
      open: true,
      opens: '08:00',
      closes: '20:00',
      closedPart: { from: '13:00', to: '16:00' },
    };
    expect(daysToPeriods(days).filter((period) => period.weekday === 2)).toHaveLength(3);
    expect(periodsToDays(daysToPeriods(days))).toEqual(days);
  });

  it('keeps the hours of a week open all day with a daily break, however it reads them back', () => {
    // Every day 00:00–14:00 and 17:00–24:00 reads equally well as 17:00 to 14:00 each night,
    // which is how it comes back. The hours saved again are the same hours.
    const lunch = ALL_WEEK.map((day) => ({ ...day, closedPart: { from: '14:00', to: '17:00' } }));
    const periods = daysToPeriods(lunch);
    expect(daysToPeriods(periodsToDays(periods)).toSorted(byDayAndTime)).toEqual(
      periods.toSorted(byDayAndTime),
    );
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

describe('closedPartProblem', () => {
  const day = (opens: string, closes: string, from: string, to: string): DayHours => ({
    open: true,
    opens,
    closes,
    closedPart: { from, to },
  });

  it('wants open time either side of the closed part, and says which end is wrong', () => {
    expect(closedPartProblem(day('08:00', '20:00', '14:00', '17:00'))).toBeNull();
    expect(closedPartProblem(day('08:00', '20:00', '08:00', '17:00'))).toEqual({
      field: 'from',
      reason: 'outside',
    });
    expect(closedPartProblem(day('08:00', '20:00', '07:00', '09:00'))).toEqual({
      field: 'from',
      reason: 'outside',
    });
    expect(closedPartProblem(day('08:00', '20:00', '14:00', '20:00'))).toEqual({
      field: 'to',
      reason: 'outside',
    });
  });

  it('wants it the right way round, said on its end', () => {
    expect(closedPartProblem(day('08:00', '20:00', '17:00', '14:00'))).toEqual({
      field: 'to',
      reason: 'order',
    });
    expect(closedPartProblem(day('08:00', '20:00', '14:00', '14:00'))?.reason).toBe('order');
  });

  it('keeps it before midnight on a night that runs past it', () => {
    expect(closedPartProblem(day('18:00', '02:00', '22:00', '23:30'))).toBeNull();
    expect(closedPartProblem(day('18:00', '02:00', '00:30', '01:00'))?.field).toBe('from');
  });

  it('has nothing to check on a day without one', () => {
    expect(closedPartProblem({ open: true, opens: '08:00', closes: '20:00' })).toBeNull();
  });
});
