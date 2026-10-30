import { randomUUID } from 'node:crypto';
import {
  addDays,
  DEFAULT_TIME_ZONE,
  findArea,
  ParkingListingDetailSchema,
  ParkingSearchResponseSchema,
  zonedParts,
  zonedTimeToUtc,
  type AreaId,
} from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { eq, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/database/database.module.js';
import { createTestApp, type TestApp } from './test-app.js';

// Listings sit in Heraklion, far from every demo area, so seeded data never interferes.
// The 000- prefix sorts them first, so the featured list (top 6 by slug) includes them.
const HERE = { latitude: 35.3387, longitude: 25.1442 };
const PREFIX = '000-it-';
const tag = randomUUID().slice(0, 8);
const slug = (name: string) => `${PREFIX}${tag}-${name}`;
const WEEK = [1, 2, 3, 4, 5, 6, 7];

// Tomorrow 10:00–12:30 on the Athens wall clock.
const tomorrow = addDays(zonedParts(new Date(), DEFAULT_TIME_ZONE).date, 1);
const start = zonedTimeToUtc(tomorrow, '10:00', DEFAULT_TIME_ZONE)?.toISOString() ?? '';
const end = zonedTimeToUtc(tomorrow, '12:30', DEFAULT_TIME_ZONE)?.toISOString() ?? '';

interface TestSpace {
  label: string;
  active?: boolean;
  ev?: boolean;
  accessible?: boolean;
}

async function addListing(
  db: Database,
  name: string,
  options: {
    /** Degrees of latitude north of HERE (0.001 ≈ 111 m). */
    offset?: number;
    at?: { latitude: number; longitude: number };
    area?: AreaId;
    status?: 'draft' | 'published' | 'suspended';
    hours: [number, number];
    spaces: TestSpace[];
  },
) {
  const [row] = await db
    .insert(schema.parkingLocations)
    .values({
      slug: slug(name),
      name: `Δοκιμή ${name}`,
      address: 'Οδός Δοκιμής 1, Ηράκλειο',
      areaId: options.area ?? 'syntagma',
      location: options.at ?? {
        latitude: HERE.latitude + (options.offset ?? 0),
        longitude: HERE.longitude,
      },
      hourlyRateMinor: 300,
      dailyMaxMinor: 2000,
      status: options.status ?? 'published',
    })
    .returning({ id: schema.parkingLocations.id });
  const locationId = row?.id ?? '';
  if (options.spaces.length > 0) {
    await db.insert(schema.parkingSpaces).values(
      options.spaces.map((space) => ({
        locationId,
        label: space.label,
        isActive: space.active ?? true,
        hasEvCharging: space.ev ?? false,
        isAccessible: space.accessible ?? false,
      })),
    );
  }
  const [opensMinute, closesMinute] = options.hours;
  await db
    .insert(schema.parkingOpeningHours)
    .values(WEEK.map((weekday) => ({ locationId, weekday, opensMinute, closesMinute })));
  return locationId;
}

const ours = (slugs: string[]) => slugs.filter((s) => s.startsWith(`${PREFIX}${tag}-`));

describe('public parking catalogue', () => {
  let app: TestApp;
  let db: Database;
  let nightOnlyId: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
    // Leftovers from crashed runs would crowd the featured list.
    await db
      .delete(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));

    const allDay: [number, number] = [0, 1440];
    await addListing(db, 'open', {
      offset: 0.001,
      hours: allDay,
      spaces: [
        { label: 'A10' },
        { label: 'A2' },
        { label: 'A1', ev: true },
        // Inactive: must not count, show, or lend its features.
        { label: 'X1', active: false, accessible: true },
      ],
    });
    await addListing(db, 'second', { offset: 0.004, hours: allDay, spaces: [{ label: 'B1' }] });
    nightOnlyId = await addListing(db, 'night-only', {
      offset: 0.002,
      hours: [0, 60],
      spaces: [{ label: 'N1' }],
    });
    await addListing(db, 'draft', { status: 'draft', hours: allDay, spaces: [{ label: 'D1' }] });
    await addListing(db, 'suspended', {
      offset: 0.0005,
      status: 'suspended',
      hours: allDay,
      spaces: [{ label: 'S1' }],
    });
    await addListing(db, 'no-spaces', { offset: 0.003, hours: allDay, spaces: [] });
    await addListing(db, 'inactive-only', {
      offset: 0.0035,
      hours: allDay,
      spaces: [{ label: 'I1', active: false }],
    });
    await addListing(db, 'far', { offset: 0.06, hours: allDay, spaces: [{ label: 'F1' }] }); // ~6.7 km
    // Nearest of all but inserted last and last by slug: only distance puts it first.
    await addListing(db, 'zz-nearest', {
      offset: 0.0002,
      hours: allDay,
      spaces: [{ label: 'Z1' }],
    });
    const ladadika = findArea('ladadika');
    await addListing(db, 'ladadika', {
      at: { latitude: (ladadika?.latitude ?? 0) + 0.001, longitude: ladadika?.longitude ?? 0 },
      area: 'ladadika',
      hours: allDay,
      spaces: [{ label: 'L1' }],
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    await app.close();
  });

  it('lets anonymous visitors search near a position: open, published, with spaces, nearest first', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/parking/search')
      .query({ ...HERE, start, end })
      .expect(200);

    const body = ParkingSearchResponseSchema.parse(response.body);
    // Not: draft, suspended, closed (night-only), no or only inactive spaces, beyond 5 km.
    expect(ours(body.results.map((result) => result.slug))).toEqual([
      slug('zz-nearest'),
      slug('open'),
      slug('second'),
    ]);
    const [open] = body.results.filter((result) => result.slug === slug('open'));
    expect(open).toMatchObject({
      freeSpaces: 3,
      spaceCount: 3,
      features: ['evCharging'],
      // 2 h 30 at €3.00/h
      total: { amountMinor: 750, currency: 'EUR' },
    });
    expect(open?.distanceMeters).toBeGreaterThan(100);
    expect(open?.distanceMeters).toBeLessThan(120);
  });

  it('searches around a curated area', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/parking/search')
      .query({ area: 'ladadika', start, end })
      .expect(200);
    const slugs = ParkingSearchResponseSchema.parse(response.body).results.map((r) => r.slug);
    expect(ours(slugs)).toEqual([slug('ladadika')]);
  });

  it('answers invalid searches and half windows with 400 and translation keys', async () => {
    const search = await request(app.getHttpServer())
      .get('/v1/parking/search')
      .query({ start: end, end: start })
      .expect(400);
    expect(search.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['locationRequired', 'endBeforeStart'],
      code: 'VALIDATION_FAILED',
    });
    const listing = await request(app.getHttpServer())
      .get(`/v1/parking/${slug('open')}`)
      .query({ start })
      .expect(400);
    expect(listing.body).toMatchObject({ code: 'VALIDATION_FAILED', message: ['invalid'] });
  });

  it('refuses a far-future window instead of walking it (once an endless loop)', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/parking/search')
      .query({ ...HERE, start: '9999-12-31T22:00:00Z', end: '9999-12-31T23:30:00Z' })
      .expect(400);
    expect(response.body).toMatchObject({ message: ['startTooFar'] });
  });

  it('shows a listing’s active spaces, hours and availability to anonymous visitors', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/parking/${slug('open')}`)
      .query({ start, end })
      .expect(200);
    const listing = ParkingListingDetailSchema.parse(response.body);

    expect(listing.spaces.map((space) => space.label)).toEqual(['A1', 'A2', 'A10']);
    expect(listing.features).toEqual(['evCharging']);
    expect(listing.openingHours).toHaveLength(7);
    expect(listing.openingHours[0]).toEqual({ weekday: 1, opens: '00:00', closes: '24:00' });
    expect(listing.latitude).toBeCloseTo(HERE.latitude + 0.001, 6);
    expect(listing.availability).toMatchObject({ open: true, freeSpaces: 3 });
    expect(response.body).not.toHaveProperty('id');
  });

  it('says when a listing is closed during the window', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/parking/${slug('night-only')}`)
      .query({ start, end })
      .expect(200);
    expect(ParkingListingDetailSchema.parse(response.body).availability?.open).toBe(false);
  });

  it('shows a published listing without active spaces as having none free', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/parking/${slug('no-spaces')}`)
      .query({ start, end })
      .expect(200);
    const listing = ParkingListingDetailSchema.parse(response.body);
    expect(listing.spaceCount).toBe(0);
    expect(listing.availability).toMatchObject({ open: true, freeSpaces: 0 });
  });

  it('hides drafts, suspended and unknown listings behind the same 404', async () => {
    for (const name of ['draft', 'suspended', 'missing']) {
      const response = await request(app.getHttpServer())
        .get(`/v1/parking/${slug(name)}`)
        .expect(404);
      expect(response.body).toMatchObject({ code: 'LISTING_NOT_FOUND' });
    }
  });

  it('features published listings that have active spaces', async () => {
    const response = await request(app.getHttpServer()).get('/v1/parking/featured').expect(200);
    const slugs = (response.body as { listings: { slug: string }[] }).listings.map((l) => l.slug);
    expect(ours(slugs)).toEqual(
      expect.arrayContaining([slug('open'), slug('second'), slug('night-only')]),
    );
    for (const hidden of ['draft', 'suspended', 'no-spaces', 'inactive-only']) {
      expect(slugs).not.toContain(slug(hidden));
    }
  });

  describe('database constraints', () => {
    const cause = (constraint: string) => ({ cause: { constraint } });

    it('rejects overlapping opening periods, but allows touching ones ([start, end))', async () => {
      await expect(
        db
          .insert(schema.parkingOpeningHours)
          .values({ locationId: nightOnlyId, weekday: 1, opensMinute: 30, closesMinute: 90 }),
      ).rejects.toMatchObject(cause('parking_opening_hours_no_overlap'));

      const [touching] = await db
        .insert(schema.parkingOpeningHours)
        .values({ locationId: nightOnlyId, weekday: 1, opensMinute: 60, closesMinute: 120 })
        .returning({ id: schema.parkingOpeningHours.id });
      await db
        .delete(schema.parkingOpeningHours)
        .where(eq(schema.parkingOpeningHours.id, touching?.id ?? ''));
    });

    it('rejects periods outside the day and duplicate space labels', async () => {
      await expect(
        db
          .insert(schema.parkingOpeningHours)
          .values({ locationId: nightOnlyId, weekday: 2, opensMinute: 1400, closesMinute: 1441 }),
      ).rejects.toMatchObject(cause('parking_opening_hours_period_check'));
      await expect(
        db.insert(schema.parkingSpaces).values({ locationId: nightOnlyId, label: 'N1' }),
      ).rejects.toMatchObject(cause('parking_spaces_location_label_unique'));
    });

    it('rejects bad prices, statuses, slugs and time zones', async () => {
      const base = {
        slug: slug('bad'),
        name: 'x',
        address: 'x',
        areaId: 'syntagma' as const,
        location: HERE,
        hourlyRateMinor: 300,
      };
      const insert = (values: Partial<typeof schema.parkingLocations.$inferInsert>) =>
        db.insert(schema.parkingLocations).values({ ...base, ...values });

      await expect(insert({ hourlyRateMinor: 0 })).rejects.toMatchObject(
        cause('parking_locations_hourly_rate_check'),
      );
      await expect(insert({ status: 'hidden' as 'draft' })).rejects.toMatchObject(
        cause('parking_locations_status_check'),
      );
      await expect(insert({ slug: 'Bad Slug' })).rejects.toMatchObject(
        cause('parking_locations_slug_check'),
      );
      await expect(insert({ timeZone: 'Mars/Olympus_Mons' })).rejects.toMatchObject(
        cause('parking_locations_time_zone_check'),
      );
      await expect(insert({ name: '' })).rejects.toMatchObject(
        cause('parking_locations_text_length_check'),
      );
    });
  });
});
