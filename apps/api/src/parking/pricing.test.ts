import { describe, expect, it } from 'vitest';
import { quoteTotalMinor } from './pricing.js';

const hourly = (hourlyRateMinor: number, dailyMaxMinor: number | null = null) => ({
  hourlyRateMinor,
  dailyMaxMinor,
});

describe('quoteTotalMinor', () => {
  it('charges the hourly rate pro rata per half hour', () => {
    expect(quoteTotalMinor(hourly(300), 30)).toBe(150);
    expect(quoteTotalMinor(hourly(300), 150)).toBe(750);
  });

  it('rounds a half-hour share up to the next cent', () => {
    expect(quoteTotalMinor(hourly(275), 30)).toBe(138); // 137.5 → 138
  });

  it('caps each 24 hours and the remainder at the daily maximum', () => {
    expect(quoteTotalMinor(hourly(300, 2000), 8 * 60)).toBe(2000); // 24.00 capped
    expect(quoteTotalMinor(hourly(300, 2000), 2 * 60)).toBe(600);
    // 2 days 3 hours: 2 × 20.00 + 9.00
    expect(quoteTotalMinor(hourly(300, 2000), 51 * 60)).toBe(4900);
  });

  it('keeps 30 days at the top rate within integer range', () => {
    expect(quoteTotalMinor(hourly(1000, 15_000), 30 * 24 * 60)).toBe(450_000);
  });

  it('refuses stays that are not whole half hours', () => {
    expect(() => quoteTotalMinor(hourly(300), 45)).toThrow(RangeError);
    expect(() => quoteTotalMinor(hourly(300), -30)).toThrow(RangeError);
  });
});
