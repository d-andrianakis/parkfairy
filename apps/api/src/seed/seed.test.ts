import { existsSync, statSync } from 'node:fs';

import {
  addDays,
  DEFAULT_TIME_ZONE,
  findArea,
  LISTING_LIMITS,
  ListingHoursExceptionsInputSchema,
  PASSWORD_POLICY,
  SEARCH_RADIUS_METERS,
  SPACE_LIMITS_CM,
  zonedParts,
} from '@parkfairy/contracts';
import { PHOTO_LIMITS } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';

import { DEMO_ACCOUNT, DEMO_LISTINGS } from './demo-data.js';
import { DEMO_PHOTOS } from './demo-photos.js';
import { assertLocalDatabase } from './seed.js';

describe('demo photos', () => {
  it('gives every listing a photo and nothing else one', () => {
    expect(Object.keys(DEMO_PHOTOS).sort()).toEqual(DEMO_LISTINGS.map((l) => l.slug).sort());
  });

  it('points only at files that exist, within the limits', () => {
    for (const photos of Object.values(DEMO_PHOTOS)) {
      expect(photos.length).toBeGreaterThan(0);
      expect(photos.length).toBeLessThanOrEqual(PHOTO_LIMITS.maxPerListing);
      for (const { file, alt } of photos) {
        const url = new URL(`../../seed-assets/photos/${file}`, import.meta.url);
        expect(existsSync(url), file).toBe(true);
        expect(statSync(url).size).toBeLessThan(PHOTO_LIMITS.maxBytes);
        expect(alt.length, file).toBeGreaterThan(10);
        expect(alt.length, file).toBeLessThanOrEqual(PHOTO_LIMITS.alt);
      }
    }
  });

  it('describes each photo differently', () => {
    const texts = Object.values(DEMO_PHOTOS).flatMap((photos) => photos.map((p) => p.alt));
    expect(new Set(texts).size).toBe(texts.length);
  });
});

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

  it('has closures and special hours an owner could have saved', () => {
    const today = zonedParts(new Date(), DEFAULT_TIME_ZONE).date;
    for (const listing of DEMO_LISTINGS) {
      const exceptions = (listing.hoursExceptions ?? []).map(({ fromDay, toDay, ...entry }) => ({
        ...entry,
        startsOn: addDays(today, fromDay),
        endsOn: addDays(today, toDay),
      }));
      const parsed = ListingHoursExceptionsInputSchema.safeParse({ exceptions });
      expect(parsed.error?.issues, listing.slug).toBeUndefined();
    }
  });

  it('puts a closure inside the window the API latency budget searches', () => {
    // tests/smoke/specs/performance.smoke.ts: Syntagma, two days after the seed in CI.
    const met = DEMO_LISTINGS.filter(
      (listing) =>
        listing.areaId === 'syntagma' &&
        listing.hoursExceptions?.some(({ fromDay, toDay }) => fromDay <= 2 && toDay >= 2),
    );
    expect(met.length).toBeGreaterThan(0);
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

describe('demo security, sizes and arrival instructions (5A.1)', () => {
  const listing = (slug: string) => {
    const found = DEMO_LISTINGS.find((l) => l.slug === slug);
    if (!found) throw new Error(`No demo listing ${slug}`);
    return found;
  };

  it('keeps every size within what a car park holds', () => {
    for (const { slug, spaces } of DEMO_LISTINGS) {
      for (const space of spaces) {
        for (const [key, dimension] of [
          ['maxHeightCm', 'height'],
          ['maxLengthCm', 'length'],
          ['maxWidthCm', 'width'],
        ] as const) {
          const value = space[key];
          if (value === undefined) continue;
          const { min, max } = SPACE_LIMITS_CM[dimension];
          expect(value, `${slug} ${space.label} ${key}`).toBeGreaterThanOrEqual(min);
          expect(value, `${slug} ${space.label} ${key}`).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it('keeps arrival instructions within their length, and out of the public description', () => {
    for (const { slug, arrivalInstructions, description } of DEMO_LISTINGS) {
      if (arrivalInstructions === undefined) continue;
      expect(arrivalInstructions.length, slug).toBeGreaterThan(0);
      expect(arrivalInstructions.length, slug).toBeLessThanOrEqual(
        LISTING_LIMITS.arrivalInstructions,
      );
      expect(description, slug).not.toContain(arrivalInstructions);
    }
  });

  // tests/smoke/specs/arrival-and-fit.smoke.ts searches by these: a change here changes what it sees.
  it('has what the smoke test searches by', () => {
    const garage = listing('syntagma-square-garage');
    expect([garage.hasCctv, garage.isLit, garage.isGated]).toEqual([true, true, true]);
    expect(new Set(garage.spaces.map((s) => s.maxHeightCm))).toEqual(new Set([190, 210]));
    expect(garage.spaces.some((s) => s.maxWidthCm === 210)).toBe(true);
    // The word the smoke test looks for in public pages, and finds only here.
    expect(garage.arrivalInstructions).toContain('φαρμακείο');
    expect(garage.description).not.toContain('φαρμακείο');

    const ermou = listing('ermou-parking');
    expect(ermou.hasCctv).toBe(true);
    expect(ermou.isGated).toBeFalsy();
    expect(new Set(ermou.spaces.map((s) => s.maxHeightCm))).toEqual(new Set([200]));

    const lot = listing('monastiraki-open-lot');
    expect([lot.hasCctv, lot.isLit, lot.isGated]).toEqual([undefined, true, undefined]);
    expect(lot.spaces.every((s) => s.maxHeightCm === undefined)).toBe(true);
  });
});
