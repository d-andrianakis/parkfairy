import { describe, expect, it } from 'vitest';
import {
  isOpenThroughout,
  wallTime,
  type DatedHours,
  type OpeningPeriod,
} from './opening-hours.js';

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

describe('isOpenThroughout with closures and special hours', () => {
  const allDay = everyDay(0, h(24));
  const none = {
    opensMinute: null,
    closesMinute: null,
    closedFromMinute: null,
    closedToMinute: null,
  };
  const closed = (startsOn: string, endsOn = startsOn): DatedHours => ({
    ...none,
    startsOn,
    endsOn,
  });
  const special = (day: string, opens: number, closes: number): DatedHours => ({
    ...none,
    startsOn: day,
    endsOn: day,
    opensMinute: opens,
    closesMinute: closes,
  });
  const closedPart = (day: string, from: number, to: number): DatedHours => ({
    ...none,
    startsOn: day,
    endsOn: day,
    closedFromMinute: from,
    closedToMinute: to,
  });
  const openWith = (exceptions: DatedHours[], start: string, end: string, periods = allDay) =>
    isOpenThroughout(periods, new Date(start), new Date(end), ATHENS, exceptions);

  it('is shut all of a closed day, and open either side of it', () => {
    const christmas = [closed('2026-12-25')];
    // 25 December, 10:00–12:00 in Athens (UTC+2).
    expect(openWith(christmas, '2026-12-25T08:00:00Z', '2026-12-25T10:00:00Z')).toBe(false);
    // 24 December up to midnight, and from midnight into the 26th.
    expect(openWith(christmas, '2026-12-24T20:00:00Z', '2026-12-24T22:00:00Z')).toBe(true);
    expect(openWith(christmas, '2026-12-25T22:00:00Z', '2026-12-26T08:00:00Z')).toBe(true);
    // A stay across the closed day.
    expect(openWith(christmas, '2026-12-24T08:00:00Z', '2026-12-26T08:00:00Z')).toBe(false);
  });

  it('closes every day of a range, both ends included', () => {
    const works = [closed('2026-12-01', '2026-12-03')];
    expect(openWith(works, '2026-12-01T08:00:00Z', '2026-12-01T09:00:00Z')).toBe(false);
    expect(openWith(works, '2026-12-03T20:00:00Z', '2026-12-03T21:00:00Z')).toBe(false);
    expect(openWith(works, '2026-12-04T08:00:00Z', '2026-12-04T09:00:00Z')).toBe(true);
    expect(openWith(works, '2026-11-30T08:00:00Z', '2026-11-30T09:00:00Z')).toBe(true);
  });

  it('keeps special hours in place of the week’s, shorter or longer', () => {
    const eve = [special('2026-12-24', h(8), h(14))];
    expect(openWith(eve, '2026-12-24T06:00:00Z', '2026-12-24T12:00:00Z')).toBe(true); // 08–14
    expect(openWith(eve, '2026-12-24T11:00:00Z', '2026-12-24T13:00:00Z')).toBe(false); // 13–15
    // A listing shut on Sundays, open one Sunday by exception.
    const weekdays = everyDay(h(8), h(20)).filter((period) => period.weekday !== 7);
    const sunday = ['2026-12-20T09:00:00Z', '2026-12-20T11:00:00Z'] as const;
    expect(openWith([special('2026-12-20', h(10), h(16))], ...sunday, weekdays)).toBe(true);
    expect(openWith([], ...sunday, weekdays)).toBe(false);
  });

  it('cuts a closed part out of the week’s hours and keeps the rest', () => {
    const cleaning = [closedPart('2026-12-02', h(10), h(14))];
    const daytime = everyDay(h(8), h(20));
    // 2 December, in Athens: 08:00–10:00 and 14:00–20:00 stay open.
    expect(openWith(cleaning, '2026-12-02T06:00:00Z', '2026-12-02T08:00:00Z', daytime)).toBe(true);
    expect(openWith(cleaning, '2026-12-02T12:00:00Z', '2026-12-02T18:00:00Z', daytime)).toBe(true);
    expect(openWith(cleaning, '2026-12-02T07:30:00Z', '2026-12-02T08:30:00Z', daytime)).toBe(false);
    expect(openWith(cleaning, '2026-12-02T11:00:00Z', '2026-12-02T12:30:00Z', daytime)).toBe(false);
    // The day before and after are untouched.
    expect(openWith(cleaning, '2026-12-01T08:00:00Z', '2026-12-01T13:00:00Z', daytime)).toBe(true);
  });

  it('cuts a closed part across two of the week’s periods, and the night’s small hours', () => {
    const split: OpeningPeriod[] = [
      { weekday: 3, opensMinute: 0, closesMinute: h(2) },
      { weekday: 3, opensMinute: h(8), closesMinute: h(13) },
      { weekday: 3, opensMinute: h(17), closesMinute: h(24) },
    ];
    // Wednesday 2 December closed 12:00–18:00: the morning and the evening each keep their rest.
    const midday = [closedPart('2026-12-02', h(12), h(18))];
    expect(openWith(midday, '2026-12-02T06:00:00Z', '2026-12-02T10:00:00Z', split)).toBe(true);
    expect(openWith(midday, '2026-12-02T16:00:00Z', '2026-12-02T21:00:00Z', split)).toBe(true);
    expect(openWith(midday, '2026-12-02T15:00:00Z', '2026-12-02T17:00:00Z', split)).toBe(false);
    const smallHours = [closedPart('2026-12-02', 0, h(1))];
    expect(openWith(smallHours, '2026-12-01T22:00:00Z', '2026-12-01T23:30:00Z', split)).toBe(false);
    expect(openWith(smallHours, '2026-12-01T23:00:00Z', '2026-12-02T00:00:00Z', split)).toBe(true);
  });

  it('opens nothing a closed part leaves closed anyway', () => {
    const shutSunday = everyDay(h(8), h(20)).filter((period) => period.weekday !== 7);
    const part = [closedPart('2026-12-20', h(10), h(12))];
    expect(openWith(part, '2026-12-20T07:00:00Z', '2026-12-20T08:00:00Z', shutSunday)).toBe(false);
  });

  it('joins special hours that end at midnight to the next day’s', () => {
    const newYear = [special('2026-12-31', h(18), h(24))];
    expect(openWith(newYear, '2026-12-31T20:00:00Z', '2027-01-01T02:00:00Z')).toBe(true);
    const earlyNight = [special('2026-12-31', h(18), h(23))];
    expect(openWith(earlyNight, '2026-12-31T20:00:00Z', '2027-01-01T02:00:00Z')).toBe(false);
  });

  it('reads the closed day on the Athens calendar, not the UTC one', () => {
    // 23:30 on 24 December in UTC is already 01:30 on the 25th in Athens.
    const christmas = [closed('2026-12-25')];
    expect(openWith(christmas, '2026-12-24T23:30:00Z', '2026-12-25T00:00:00Z')).toBe(false);
    expect(openWith(christmas, '2026-12-24T21:00:00Z', '2026-12-24T22:00:00Z')).toBe(true);
  });

  it('closes the whole of the 25-hour day the clocks go back', () => {
    const shut = [closed('2026-10-25')];
    // 00:00 local on the 25th is still UTC+3: 21:00Z on the 24th.
    expect(openWith(shut, '2026-10-24T21:00:00Z', '2026-10-24T21:30:00Z')).toBe(false);
    // 23:00 local, after the change: UTC+2.
    expect(openWith(shut, '2026-10-25T21:00:00Z', '2026-10-25T21:30:00Z')).toBe(false);
    expect(openWith(shut, '2026-10-25T22:00:00Z', '2026-10-25T23:00:00Z')).toBe(true);
  });

  it('keeps special hours and closures on the wall clock across the spring change', () => {
    // 28 March 2027: 03:00–04:00 doesn't happen. 02:00–06:00 local is three hours of real time.
    const early = [special('2027-03-28', h(2), h(6))];
    expect(openWith(early, '2027-03-28T00:00:00Z', '2027-03-28T03:00:00Z')).toBe(true);
    // 23:30 on the 27th to 00:30 on the closed 28th.
    expect(openWith([closed('2027-03-28')], '2027-03-27T21:30:00Z', '2027-03-27T22:30:00Z')).toBe(
      false,
    );
  });

  it('cuts a closed part that spans the missing spring hour', () => {
    const night = [closedPart('2027-03-28', h(2), h(5))];
    // 05:00–06:00 local (UTC+3 by then) is open; 04:30–05:30 is not.
    expect(openWith(night, '2027-03-28T02:00:00Z', '2027-03-28T03:00:00Z')).toBe(true);
    expect(openWith(night, '2027-03-28T01:30:00Z', '2027-03-28T02:30:00Z')).toBe(false);
  });

  it('keeps special hours on the wall clock across the autumn change', () => {
    // 25 October 2026: 01:00–06:00 local is six hours of real time.
    const night = [special('2026-10-25', h(1), h(6))];
    expect(openWith(night, '2026-10-24T22:00:00Z', '2026-10-25T04:00:00Z')).toBe(true);
    expect(openWith(night, '2026-10-25T04:00:00Z', '2026-10-25T05:00:00Z')).toBe(false);
  });
});

describe('wallTime', () => {
  it('formats minutes of the day, with 24:00 for end of day', () => {
    expect(wallTime(0)).toBe('00:00');
    expect(wallTime(h(7, 30))).toBe('07:30');
    expect(wallTime(h(24))).toBe('24:00');
  });
});
