import { DEFAULT_TIME_ZONE } from '@parkfairy/contracts';
import { describe, expect, it, vi } from 'vitest';
import { NO_PRICE_RULES, quoteStayMinor, type PriceRules, type Stay } from './pricing.js';

const hourly = (hourlyRateMinor: number, dailyMaxMinor: number | null = null) => ({
  hourlyRateMinor,
  dailyMaxMinor,
});

/** Athens is UTC+3 here, in the middle of a summer with no clock change near. */
const athens = (date: string, time: string) => new Date(`${date}T${time}:00+03:00`);

/** A Monday. */
const MONDAY = '2027-06-07';
const FRIDAY = '2027-06-11';
const SATURDAY = '2027-06-12';

function quote(
  rates: Stay['rates'],
  start: Date,
  minutes: number,
  rules: Partial<PriceRules> = {},
  spaceRateMinor?: number,
): number {
  return quoteStayMinor({
    rates,
    rules: { ...NO_PRICE_RULES, ...rules },
    spaceRateMinor: spaceRateMinor ?? null,
    start,
    end: new Date(start.getTime() + minutes * 60_000),
    timeZone: DEFAULT_TIME_ZONE,
  });
}

const start = athens(MONDAY, '10:00');

describe('the hourly rate and daily cap', () => {
  it('charges the hourly rate pro rata per half hour', () => {
    expect(quote(hourly(300), start, 30)).toBe(150);
    expect(quote(hourly(300), start, 150)).toBe(750);
  });

  it('rounds a half-hour share up to the next cent', () => {
    expect(quote(hourly(275), start, 30)).toBe(138); // 137.5 → 138
  });

  it('caps each 24 hours and the remainder at the daily maximum', () => {
    expect(quote(hourly(300, 2000), start, 8 * 60)).toBe(2000); // 24.00 capped
    expect(quote(hourly(300, 2000), start, 2 * 60)).toBe(600);
    // 2 days 3 hours: 2 × 20.00 + 9.00
    expect(quote(hourly(300, 2000), start, 51 * 60)).toBe(4900);
  });

  it('keeps 30 days at the top rate within integer range', () => {
    expect(quote(hourly(1000, 15_000), start, 30 * 24 * 60)).toBe(450_000);
  });

  it('refuses stays that are not whole half hours, or longer than any stay can be', () => {
    expect(() => quote(hourly(300), start, 45)).toThrow(RangeError);
    expect(() => quote(hourly(300), start, -30)).toThrow(RangeError);
    expect(() => quote(hourly(300), start, 40 * 24 * 60)).toThrow(RangeError);
  });
});

describe('the most specific price wins each half hour', () => {
  const rates = hourly(300);
  const night = { rateMinor: 100, fromMinute: 22 * 60, toMinute: 6 * 60 };

  it('charges a night rate only inside its hours, across midnight', () => {
    // 21:00–23:00: an hour at 3.00, an hour at 1.00.
    expect(quote(rates, athens(MONDAY, '21:00'), 120, { night })).toBe(400);
    // 05:00–07:00 the next morning: an hour at 1.00, an hour at 3.00.
    expect(quote(rates, athens('2027-06-08', '05:00'), 120, { night })).toBe(400);
  });

  it('includes the night window start and excludes its end', () => {
    expect(quote(rates, athens(MONDAY, '22:00'), 30, { night })).toBe(50);
    expect(quote(rates, athens('2027-06-08', '06:00'), 30, { night })).toBe(150);
  });

  it('handles a night window that does not cross midnight', () => {
    const early = { rateMinor: 100, fromMinute: 60, toMinute: 300 };
    expect(quote(rates, athens(MONDAY, '02:00'), 60, { night: early })).toBe(100);
    expect(quote(rates, athens(MONDAY, '23:00'), 60, { night: early })).toBe(300);
  });

  it('charges the weekend rate from Saturday 00:00 to Sunday 24:00', () => {
    const rules = { weekendRateMinor: 200 };
    expect(quote(rates, athens(FRIDAY, '23:00'), 120, rules)).toBe(500); // 3.00 + 2.00
    expect(quote(rates, athens('2027-06-13', '23:00'), 120, rules)).toBe(500); // Sun → Mon
  });

  it('prefers the weekend to the night', () => {
    expect(quote(rates, athens(SATURDAY, '23:00'), 60, { weekendRateMinor: 200, night })).toBe(200);
  });

  it('prefers a dated price to the weekend and the night', () => {
    const dated = [{ startsOn: SATURDAY, endsOn: SATURDAY, rateMinor: 900 }];
    expect(
      quote(rates, athens(SATURDAY, '23:00'), 60, { weekendRateMinor: 200, night, dated }),
    ).toBe(900);
  });

  it('counts both ends of a dated range, on the wall clock', () => {
    const dated = [{ startsOn: MONDAY, endsOn: '2027-06-08', rateMinor: 900 }];
    expect(quote(rates, athens(MONDAY, '00:00'), 60, { dated })).toBe(900);
    expect(quote(rates, athens('2027-06-08', '23:00'), 60, { dated })).toBe(900);
    expect(quote(rates, athens('2027-06-09', '00:00'), 60, { dated })).toBe(300);
    // 22:30 UTC is already the 7th in Athens: the day must not be read in UTC.
    expect(quote(rates, new Date('2027-06-06T22:30:00Z'), 60, { dated })).toBe(900);
  });

  it('caps each 24 hours of a stay with mixed rates', () => {
    // Saturday at 6.00 an hour: 144.00 a day against a cap of 20.00, then an hour at 6.00.
    const capped = hourly(300, 2000);
    expect(quote(capped, athens(SATURDAY, '00:00'), 25 * 60, { weekendRateMinor: 600 })).toBe(2600);
  });
});

describe('clock changes', () => {
  // Spring forward: 2027-03-28 03:00 EET jumps to 04:00 EEST (01:00 UTC).
  // Autumn back: 2027-10-31 04:00 EEST falls to 03:00 EET (01:00 UTC).
  const rates = hourly(300);

  it('charges real elapsed time across the spring change', () => {
    const before = new Date('2027-03-28T00:00:00Z'); // 02:00 EET
    expect(quote(rates, before, 120)).toBe(600);
  });

  it('reads the wall clock on the far side of the spring change', () => {
    const night = { rateMinor: 100, fromMinute: 0, toMinute: 4 * 60 };
    // 00:00Z 02:00 and 00:30Z 02:30 are night; 01:00Z is already 04:00, so day.
    expect(quote(rates, new Date('2027-03-28T00:00:00Z'), 120, { night })).toBe(100 + 300);
  });

  it('reads the wall clock on the far side of the autumn change', () => {
    const night = { rateMinor: 100, fromMinute: 3 * 60, toMinute: 4 * 60 };
    // 00:00Z 03:00 EEST (night), 01:00Z 03:00 EET (night again), 02:00Z 04:00 EET (day).
    expect(quote(rates, new Date('2027-10-31T00:00:00Z'), 180, { night })).toBe(100 + 100 + 300);
  });

  it('sees a dated price after a clock change partway through a long stay', () => {
    const dated = [{ startsOn: '2027-03-29', endsOn: '2027-03-29', rateMinor: 900 }];
    // 28 hours of real time from Sunday 02:00 reach Monday 07:00 on the wall clock.
    const hoursOnMonday = 7;
    const expected = (28 - hoursOnMonday) * 300 + hoursOnMonday * 900;
    expect(quote(rates, new Date('2027-03-28T00:00:00Z'), 28 * 60, { dated })).toBe(expected);
  });

  it('gives a stay of a wall-clock week its discount across the spring change', () => {
    // 22 March 10:00 to 29 March 10:00 is seven days on the clock but 167 hours of real time.
    const from = new Date('2027-03-22T08:00:00Z');
    const discounts = [{ minDays: 7, percent: 50 }];
    expect(quote(rates, from, 167 * 60, { discounts })).toBe((167 * 300) / 2);
  });
});

describe('long-stay discounts', () => {
  const discounts = [
    { minDays: 7, percent: 10 },
    { minDays: 14, percent: 20 },
  ];

  it('applies nothing below the shortest stay', () => {
    expect(quote(hourly(100), start, 6 * 24 * 60, { discounts })).toBe(14_400);
  });

  it('applies the largest discount the stay reaches', () => {
    expect(quote(hourly(100), start, 7 * 24 * 60, { discounts })).toBe(15_120); // 16,800 − 10%
    expect(quote(hourly(100), start, 14 * 24 * 60, { discounts })).toBe(26_880); // 33,600 − 20%
  });

  it('never stacks with the cap: the driver pays the lower total', () => {
    // 7 days: uncapped 168.00, 10% off is 151.20; capped at 10.00 a day is 70.00.
    expect(quote(hourly(100, 1000), start, 7 * 24 * 60, { discounts })).toBe(7000);
    // Capped at 23.00 a day is 161.00, above the discounted 151.20.
    expect(quote(hourly(100, 2300), start, 7 * 24 * 60, { discounts })).toBe(15_120);
  });

  it('rounds the discounted total up to the cent', () => {
    expect(
      quote(hourly(333), start, 7 * 24 * 60, { discounts: [{ minDays: 7, percent: 33 }] }),
    ).toBe(
      37_483, // 559.44 × 0.67 = 374.8248
    );
  });
});

describe('a space with its own rate', () => {
  it('scales the hourly rate', () => {
    expect(quote(hourly(300), start, 120, {}, 360)).toBe(720);
  });

  it('scales the cap', () => {
    expect(quote(hourly(300, 2000), start, 24 * 60, {}, 360)).toBe(2400);
  });

  it('scales weekend, night and dated prices too', () => {
    const weekend = { weekendRateMinor: 200 };
    expect(quote(hourly(300), athens(SATURDAY, '10:00'), 60, weekend, 450)).toBe(300); // 2.00 × 1.5
    const night = { night: { rateMinor: 100, fromMinute: 0, toMinute: 360 } };
    expect(quote(hourly(300), athens(MONDAY, '01:00'), 60, night, 150)).toBe(50);
    const dated = { dated: [{ startsOn: MONDAY, endsOn: MONDAY, rateMinor: 600 }] };
    expect(quote(hourly(300), start, 60, dated, 150)).toBe(300);
  });

  it('keeps a cheaper space cheaper across every rate', () => {
    const rules = {
      weekendRateMinor: 500,
      night: { rateMinor: 200, fromMinute: 22 * 60, toMinute: 6 * 60 },
    };
    for (const from of [athens(MONDAY, '20:00'), athens(SATURDAY, '20:00')]) {
      expect(quote(hourly(300), from, 8 * 60, rules, 240)).toBeLessThan(
        quote(hourly(300), from, 8 * 60, rules),
      );
    }
  });

  it('prices like the listing when its rate equals the listing’s', () => {
    expect(quote(hourly(275), start, 30, {}, 275)).toBe(quote(hourly(275), start, 30));
  });
});

describe('speed', () => {
  it('never asks the time zone about each half hour of a long stay', () => {
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    const rules: Partial<PriceRules> = {
      weekendRateMinor: 200,
      night: { rateMinor: 100, fromMinute: 22 * 60, toMinute: 6 * 60 },
    };
    // Thirty days across the autumn change: 1,440 half hours, and a change to find.
    quote(hourly(300, 2000), new Date('2027-10-15T09:00:00Z'), 30 * 24 * 60, rules);
    expect(format.mock.calls.length).toBeLessThan(20);
    format.mockRestore();
  });
});
