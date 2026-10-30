import { describe, expect, it } from 'vitest';
import { isOpenThroughout, wallTime, type OpeningPeriod } from './opening-hours.js';

const ATHENS = 'Europe/Athens';
const h = (hh: number, mm = 0) => hh * 60 + mm;
const everyDay = (opens: number, closes: number): OpeningPeriod[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensMinute: opens, closesMinute: closes }));
const open = (periods: OpeningPeriod[], start: string, end: string) =>
  isOpenThroughout(periods, new Date(start), new Date(end), ATHENS);

describe('isOpenThroughout (Europe/Athens wall clock)', () => {
  const daytime = everyDay(h(7), h(23));

  it('accepts a window inside the day’s hours (Thursday 09:00–17:00 local)', () => {
    expect(open(daytime, '2026-10-29T07:00:00Z', '2026-10-29T15:00:00Z')).toBe(true);
  });

  it('rejects a window that starts before opening or runs past closing', () => {
    expect(open(daytime, '2026-10-29T04:30:00Z', '2026-10-29T06:00:00Z')).toBe(false); // 06:30
    expect(open(daytime, '2026-10-29T20:00:00Z', '2026-10-29T21:30:00Z')).toBe(false); // 23:30
  });

  it('allows a window ending exactly at closing time', () => {
    expect(open(daytime, '2026-10-29T19:00:00Z', '2026-10-29T21:00:00Z')).toBe(true); // →23:00
  });

  it('treats …–24:00 and 00:00–… on the next day as continuous', () => {
    const allDay = everyDay(0, h(24));
    expect(open(allDay, '2026-10-29T18:00:00Z', '2026-11-02T06:00:00Z')).toBe(true);
    expect(open(daytime, '2026-10-29T18:00:00Z', '2026-10-30T06:00:00Z')).toBe(false);
  });

  it('joins split shifts only where they touch', () => {
    const split: OpeningPeriod[] = [
      { weekday: 4, opensMinute: h(8), closesMinute: h(14) },
      { weekday: 4, opensMinute: h(14), closesMinute: h(20) },
      { weekday: 5, opensMinute: h(8), closesMinute: h(13) },
      { weekday: 5, opensMinute: h(17), closesMinute: h(21) },
    ];
    expect(open(split, '2026-10-29T08:00:00Z', '2026-10-29T15:00:00Z')).toBe(true); // Thu 10–17
    expect(open(split, '2026-10-30T09:00:00Z', '2026-10-30T12:00:00Z')).toBe(false); // Fri 11–14
  });

  it('respects days that are closed', () => {
    const closedSunday = everyDay(h(8), h(20)).filter((period) => period.weekday !== 7);
    expect(open(closedSunday, '2026-11-01T08:00:00Z', '2026-11-01T09:00:00Z')).toBe(false);
    expect(open(closedSunday, '2026-10-31T08:00:00Z', '2026-10-31T09:00:00Z')).toBe(true);
  });

  it('reads hours on the wall clock across the autumn DST change (25 October 2026)', () => {
    // Sunday 01:00–06:00 local is 22:00Z Sat – 04:00Z Sun: six hours of real time.
    const nightOwl: OpeningPeriod[] = [{ weekday: 7, opensMinute: h(1), closesMinute: h(6) }];
    expect(open(nightOwl, '2026-10-24T22:00:00Z', '2026-10-25T04:00:00Z')).toBe(true);
    expect(open(nightOwl, '2026-10-24T21:30:00Z', '2026-10-25T04:00:00Z')).toBe(false);
  });

  it('reads hours on the wall clock across spring-forward (29 March 2026)', () => {
    // Sunday 02:00–05:00 local; 03:00–04:00 does not exist that night: 00:00Z–02:00Z.
    const early: OpeningPeriod[] = [{ weekday: 7, opensMinute: h(2), closesMinute: h(5) }];
    expect(open(early, '2026-03-29T00:00:00Z', '2026-03-29T02:00:00Z')).toBe(true);
    expect(open(early, '2026-03-28T23:30:00Z', '2026-03-29T02:00:00Z')).toBe(false);
  });

  // An endless walk would hang here until the test times out.
  it('refuses windows the API must never walk (past year 9999, over 31 days)', () => {
    const allDay = everyDay(0, h(24));
    // Local date 10000-01-01: once an endless loop that hung the whole API process.
    expect(open(allDay, '9999-12-31T22:00:00Z', '9999-12-31T23:30:00Z')).toBe(false);
    expect(open(allDay, '9999-12-31T20:00:00Z', '9999-12-31T23:30:00Z')).toBe(false);
    expect(open(allDay, '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z')).toBe(false);
  });

  it('rejects empty or inverted windows', () => {
    const allDay = everyDay(0, h(24));
    expect(open(allDay, '2026-10-29T10:00:00Z', '2026-10-29T10:00:00Z')).toBe(false);
    expect(open(allDay, '2026-10-29T12:00:00Z', '2026-10-29T10:00:00Z')).toBe(false);
  });
});

describe('wallTime', () => {
  it('formats minutes of the day, with 24:00 for end of day', () => {
    expect(wallTime(0)).toBe('00:00');
    expect(wallTime(h(7, 30))).toBe('07:30');
    expect(wallTime(h(24))).toBe('24:00');
  });
});
