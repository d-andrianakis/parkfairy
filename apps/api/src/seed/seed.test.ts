import { findArea, PASSWORD_POLICY, SEARCH_RADIUS_METERS } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNT, DEMO_LISTINGS } from './demo-data.js';
import { assertLocalDatabase } from './seed.js';

describe('assertLocalDatabase', () => {
  it('allows local databases outside production', () => {
    expect(() =>
      assertLocalDatabase('postgres://u:p@localhost:5434/parkfairy', 'development', ''),
    ).not.toThrow();
    expect(() => assertLocalDatabase('postgres://u:p@127.0.0.1:5432/x', 'test', '')).not.toThrow();
  });

  it('refuses URLs whose ?host= or ?hostaddr= points elsewhere (node-postgres honours them)', () => {
    for (const url of [
      'postgres://u:p@localhost:5432/x?host=db.example.gr',
      'postgres://u:p@localhost/x?host=/cloudsql/proj:europe-west1:prod',
      'postgres://u:p@127.0.0.1/x?hostaddr=10.0.0.5',
      // Session options could set the local marker on any database.
      'postgres://u:p@localhost/x?options=-c%20parkfairy.environment%3Dlocal',
    ]) {
      expect(() => assertLocalDatabase(url, 'development', ''), url).toThrow(
        /local databases only/,
      );
    }
    expect(() =>
      assertLocalDatabase(
        'postgres://u:p@localhost/x',
        'development',
        '-c parkfairy.environment=local',
      ),
    ).toThrow(/local databases only/);
  });

  it('refuses remote hosts and production, because the demo password is public', () => {
    expect(() => assertLocalDatabase('postgres://u:p@db.example.gr:5432/x', 'development')).toThrow(
      /local databases only/,
    );
    expect(() => assertLocalDatabase('postgres://u:p@localhost:5432/x', 'production')).toThrow(
      /local databases only/,
    );
  });
});

describe('demo data', () => {
  it('has unique slugs and unique space labels per listing', () => {
    expect(new Set(DEMO_LISTINGS.map((l) => l.slug)).size).toBe(DEMO_LISTINGS.length);
    for (const listing of DEMO_LISTINGS) {
      const labels = listing.spaces.map((space) => space.label);
      expect(new Set(labels).size, listing.slug).toBe(labels.length);
      expect(labels.length, listing.slug).toBeGreaterThan(0);
    }
  });

  it('has opening periods the database accepts (in range, not overlapping)', () => {
    for (const listing of DEMO_LISTINGS) {
      for (const day of [1, 2, 3, 4, 5, 6, 7]) {
        const periods = listing.openingHours
          .filter((period) => period.weekday === day)
          .sort((a, b) => a.opensMinute - b.opensMinute);
        for (const [i, period] of periods.entries()) {
          expect(period.opensMinute).toBeLessThan(period.closesMinute);
          expect(period.closesMinute).toBeLessThanOrEqual(1440);
          expect(period.opensMinute).toBeGreaterThanOrEqual(periods[i - 1]?.closesMinute ?? 0);
        }
      }
    }
  });

  it('uses a demo password that meets the password policy', () => {
    expect(DEMO_ACCOUNT.password.length).toBeGreaterThanOrEqual(PASSWORD_POLICY.minLength);
    expect(DEMO_ACCOUNT.password.length).toBeLessThanOrEqual(PASSWORD_POLICY.maxLength);
  });

  it('puts every listing within search range of its area, with opening hours', () => {
    const metres = (a: { latitude: number; longitude: number }, b: typeof a) => {
      const rad = Math.PI / 180;
      const x = (b.longitude - a.longitude) * rad * Math.cos(((a.latitude + b.latitude) / 2) * rad);
      const y = (b.latitude - a.latitude) * rad;
      return Math.hypot(x, y) * 6_371_000;
    };
    for (const listing of DEMO_LISTINGS) {
      const area = findArea(listing.areaId);
      expect(area, listing.slug).toBeDefined();
      if (area) expect(metres(listing, area), listing.slug).toBeLessThan(SEARCH_RADIUS_METERS);
      expect(listing.openingHours.length, listing.slug).toBeGreaterThan(0);
    }
  });
});
