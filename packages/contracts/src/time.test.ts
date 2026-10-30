import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  isoWeekday,
  wallClockMs,
  zonedParts,
  zonedTimeToUtc,
} from './time.js';

const ATHENS = 'Europe/Athens';
const iso = (date: Date | null) => date?.toISOString();

describe('zonedTimeToUtc (Europe/Athens)', () => {
  it('uses UTC+2 in winter and UTC+3 in summer', () => {
    expect(iso(zonedTimeToUtc('2026-01-15', '09:00', ATHENS))).toBe('2026-01-15T07:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-07-15', '09:00', ATHENS))).toBe('2026-07-15T06:00:00.000Z');
  });

  it('moves a time skipped by spring-forward past the gap (29 March 2026, 03:00 → 04:00)', () => {
    expect(iso(zonedTimeToUtc('2026-03-29', '02:30', ATHENS))).toBe('2026-03-29T00:30:00.000Z');
    expect(iso(zonedTimeToUtc('2026-03-29', '03:30', ATHENS))).toBe('2026-03-29T01:30:00.000Z');
    expect(iso(zonedTimeToUtc('2026-03-29', '04:00', ATHENS))).toBe('2026-03-29T01:00:00.000Z');
  });

  it('picks the earlier instant for a time that occurs twice (25 October 2026)', () => {
    expect(iso(zonedTimeToUtc('2026-10-25', '03:30', ATHENS))).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(zonedTimeToUtc('2026-10-25', '04:00', ATHENS))).toBe('2026-10-25T02:00:00.000Z');
  });

  it('rejects input that is not a real date and time', () => {
    expect(zonedTimeToUtc('2026-02-30', '09:00', ATHENS)).toBeNull();
    expect(zonedTimeToUtc('2026-01-15', '24:00', ATHENS)).toBeNull();
    expect(zonedTimeToUtc('15/01/2026', '09:00', ATHENS)).toBeNull();
    expect(zonedTimeToUtc('2026-01-15', '9:00', ATHENS)).toBeNull();
  });
});

describe('zonedParts', () => {
  it('reads the Athens wall clock, including the date change after UTC midnight', () => {
    expect(zonedParts(new Date('2026-10-28T23:30:00Z'), ATHENS)).toEqual({
      date: '2026-10-29',
      time: '01:30',
      isoWeekday: 4,
      minuteOfDay: 90,
    });
  });

  it('round-trips with zonedTimeToUtc across both DST changes', () => {
    for (const [date, time] of [
      ['2026-03-28', '23:30'],
      ['2026-03-29', '05:00'],
      ['2026-10-24', '22:00'],
      ['2026-10-25', '05:30'],
    ] as const) {
      const instant = zonedTimeToUtc(date, time, ATHENS);
      expect(instant).not.toBeNull();
      expect(zonedParts(instant as Date, ATHENS)).toMatchObject({ date, time });
    }
  });
});

describe('calendar helpers', () => {
  it('numbers weekdays the ISO way (Monday = 1, Sunday = 7)', () => {
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(isoWeekday('2026-10-29')).toBe(4);
    expect(isoWeekday('2026-11-01')).toBe(7);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('refuses dates past year 9999 instead of writing +010000', () => {
    expect(() => addDays('9999-12-31', 1)).toThrow(RangeError);
  });

  it('counts calendar days and reads the wall clock as UTC milliseconds', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    // 25 Oct 2026 has 25 hours in Athens; the wall clock still advances by one day.
    const sat = zonedTimeToUtc('2026-10-24', '12:00', ATHENS) as Date;
    const sun = zonedTimeToUtc('2026-10-25', '12:00', ATHENS) as Date;
    expect(sun.getTime() - sat.getTime()).toBe(25 * 3_600_000);
    expect(wallClockMs(sun, ATHENS) - wallClockMs(sat, ATHENS)).toBe(24 * 3_600_000);
  });
});
