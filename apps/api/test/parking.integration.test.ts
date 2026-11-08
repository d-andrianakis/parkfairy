import { randomUUID } from 'node:crypto';
import {
  addDays,
  DEFAULT_TIME_ZONE,
  findArea,
  LISTING_SPACES_LIMIT,
  ParkingListingDetailSchema,
  ParkingSearchResponseSchema,
  zonedParts,
  zonedTimeToUtc,
  type AreaId,
} from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { and, eq, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/database/database.module.js';
import {
  ParkingService,
  SEARCH_BATCH,
  SEARCH_MAX_BATCHES,
} from '../src/parking/parking.service.js';
import { createTestApp, type TestApp } from './test-app.js';

// Listings sit in Rethymno, far from every demo area, so seeded data never interferes, and from
// the owner suite's Heraklion, whose live listings pile up there run after run and, past search's
// 50 results, would crowd these out. The 000- prefix sorts them first, so the featured list (top 6
// by slug) includes them.
const HERE = { latitude: 35.3655, longitude: 24.4823 };
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

  describe('opening hours checked in the query', () => {
    // Corfu: nothing else in these tests or the demo data is near.
    const CORFU = { latitude: 39.6243, longitude: 19.9217 };
    const search = async (at: { latitude: number; longitude: number }, window: object) => {
      const response = await request(app.getHttpServer())
        .get('/v1/parking/search')
        .query({ ...at, ...window })
        .expect(200);
      return ParkingSearchResponseSchema.parse(response.body).results.map((r) => r.slug);
    };

    /** The next night Athens goes back from 04:00 to 03:00, at 01:00 UTC on October's last Sunday. */
    const nextFallBack = () => {
      const lastSundayOfOctober = (year: number) => {
        const day = new Date(Date.UTC(year, 9, 31));
        day.setUTCDate(31 - day.getUTCDay());
        return day;
      };
      const thisYear = new Date().getUTCFullYear();
      const night = [thisYear, thisYear + 1]
        .map(lastSundayOfOctober)
        .find((day) => day.getTime() > Date.now() + 86_400_000);
      // Minutes from that Sunday's 00:00 UTC.
      return (minutes: number) => new Date((night?.getTime() ?? 0) + minutes * 60_000);
    };

    // Gone after each test, so the rest of the file never meets them in a search or the featured list.
    afterEach(async () => {
      await db
        .delete(schema.parkingLocations)
        .where(like(schema.parkingLocations.slug, `${PREFIX}${tag}-scale-%`));
    });

    it('finds an open listing behind as many shut at that hour as search has batch places', async () => {
      // Every place of every batch: shut ones must not fill them.
      const shut = Array.from({ length: SEARCH_BATCH * SEARCH_MAX_BATCHES }, (_, index) => ({
        slug: slug(`scale-shut-${index}`),
        name: `Κλειστό ${index}`,
        address: 'Οδός Δοκιμής 1, Κέρκυρα',
        areaId: 'syntagma' as const,
        location: { latitude: CORFU.latitude + index * 0.00001, longitude: CORFU.longitude },
        hourlyRateMinor: 300,
        status: 'published' as const,
      }));
      const rows = await db
        .insert(schema.parkingLocations)
        .values(shut)
        .returning({ id: schema.parkingLocations.id });
      await db
        .insert(schema.parkingSpaces)
        .values(rows.map(({ id }) => ({ locationId: id, label: 'K1' })));
      // Open from midnight to one in the morning only: shut for the stay.
      await db
        .insert(schema.parkingOpeningHours)
        .values(
          rows.flatMap(({ id }) =>
            WEEK.map((weekday) => ({ locationId: id, weekday, opensMinute: 0, closesMinute: 60 })),
          ),
        );
      await addListing(db, 'scale-open-behind', {
        at: { latitude: CORFU.latitude + 0.01, longitude: CORFU.longitude },
        hours: [0, 1440],
        spaces: [{ label: 'O1' }],
      });
      expect(await search(CORFU, { start, end })).toEqual([slug('scale-open-behind')]);
    });

    it('keeps a listing opened by special hours on a day the week has it shut', async () => {
      const id = await addListing(db, 'scale-special-opening', {
        at: { latitude: CORFU.latitude + 0.03, longitude: CORFU.longitude },
        hours: [0, 60],
        spaces: [{ label: 'P1' }],
      });
      await db.insert(schema.parkingHoursExceptions).values({
        locationId: id,
        startsOn: tomorrow,
        endsOn: tomorrow,
        opensMinute: 8 * 60,
        closesMinute: 14 * 60,
      });
      const around = { latitude: CORFU.latitude + 0.03, longitude: CORFU.longitude };
      expect(await search(around, { start, end })).toContain(slug('scale-special-opening'));
    });

    it('follows a night from Sunday into Monday, where the week starts again', async () => {
      const id = await addListing(db, 'scale-sunday-night', {
        at: { latitude: CORFU.latitude - 0.02, longitude: CORFU.longitude },
        hours: [0, 6 * 60],
        spaces: [{ label: 'S1' }],
      });
      await db.insert(schema.parkingOpeningHours).values(
        WEEK.map((weekday) => ({
          locationId: id,
          weekday,
          opensMinute: 20 * 60,
          closesMinute: 1440,
        })),
      );
      const today = zonedParts(new Date(), DEFAULT_TIME_ZONE);
      const sunday = addDays(today.date, 7 - today.isoWeekday || 7);
      const monday = addDays(sunday, 1);
      const night = {
        start: zonedTimeToUtc(sunday, '22:00', DEFAULT_TIME_ZONE)?.toISOString(),
        end: zonedTimeToUtc(monday, '02:00', DEFAULT_TIME_ZONE)?.toISOString(),
      };
      const around = { latitude: CORFU.latitude - 0.02, longitude: CORFU.longitude };
      expect(await search(around, night)).toContain(slug('scale-sunday-night'));
      // Past six on Monday morning it has closed.
      const late = {
        start: night.start,
        end: zonedTimeToUtc(monday, '07:00', DEFAULT_TIME_ZONE)?.toISOString(),
      };
      expect(await search(around, late)).not.toContain(slug('scale-sunday-night'));
      // A weeknight is one range of the week: 20:00–24:00 and 00:00–06:00 join at midnight.
      const tuesday = addDays(today.date, (2 - today.isoWeekday + 7) % 7 || 7);
      const weeknight = {
        start: zonedTimeToUtc(tuesday, '22:00', DEFAULT_TIME_ZONE)?.toISOString(),
        end: zonedTimeToUtc(addDays(tuesday, 1), '02:00', DEFAULT_TIME_ZONE)?.toISOString(),
      };
      expect(await search(around, weeknight)).toContain(slug('scale-sunday-night'));
    });

    it('needs the whole week open for a stay of thirty days, the longest a search allows', async () => {
      const at = { latitude: CORFU.latitude + 0.04, longitude: CORFU.longitude };
      await addListing(db, 'scale-all-week', { at, hours: [0, 1440], spaces: [{ label: 'W1' }] });
      const breakId = await addListing(db, 'scale-wednesday-break', {
        at: { latitude: at.latitude + 0.0005, longitude: at.longitude },
        hours: [0, 1440],
        spaces: [{ label: 'W2' }],
      });
      // Shut 10:00–11:00 on Wednesdays.
      await db
        .delete(schema.parkingOpeningHours)
        .where(
          and(
            eq(schema.parkingOpeningHours.locationId, breakId),
            eq(schema.parkingOpeningHours.weekday, 3),
          ),
        );
      await db.insert(schema.parkingOpeningHours).values([
        { locationId: breakId, weekday: 3, opensMinute: 0, closesMinute: 600 },
        { locationId: breakId, weekday: 3, opensMinute: 660, closesMinute: 1440 },
      ]);
      const month = {
        start,
        end: zonedTimeToUtc(addDays(tomorrow, 30), '10:00', DEFAULT_TIME_ZONE)?.toISOString(),
      };
      const found = await search(at, month);
      expect(found).toContain(slug('scale-all-week'));
      expect(found).not.toContain(slug('scale-wednesday-break'));
    });

    it('reads the night the clocks go back on the wall clock, not by the hours that pass', async () => {
      // Open 00:00–04:00 only. 01:00 summer time to 04:00 winter time is four hours, but on the
      // wall clock it ends at four, when the listing closes.
      const at = { latitude: CORFU.latitude - 0.04, longitude: CORFU.longitude };
      await addListing(db, 'scale-small-hours', { at, hours: [0, 240], spaces: [{ label: 'H1' }] });
      const sunday = nextFallBack();
      const found = await app.get(ParkingService).search({
        ...at,
        start: sunday(-120).toISOString(),
        end: sunday(120).toISOString(),
      });
      expect(found.map((result) => result.slug)).toContain(slug('scale-small-hours'));
    });

    it('answers a stay inside the hour the clocks repeat, which ends before it starts', async () => {
      await addListing(db, 'scale-fall-back', {
        at: { latitude: CORFU.latitude - 0.03, longitude: CORFU.longitude },
        hours: [0, 1440],
        spaces: [{ label: 'R1' }],
      });
      // Straight to the service: the next such night can be further ahead than a search may look.
      const at = nextFallBack();
      // 03:30 summer time to 03:00 winter time: half an hour, though the wall clock goes back.
      const found = await app.get(ParkingService).search({
        latitude: CORFU.latitude - 0.03,
        longitude: CORFU.longitude,
        start: at(30).toISOString(),
        end: at(60).toISOString(),
      });
      expect(found.map((result) => result.slug)).toContain(slug('scale-fall-back'));
    });
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

  it('sends the first spaces of a big garage, counting them all', async () => {
    const count = LISTING_SPACES_LIMIT + 2;
    await addListing(db, 'big', {
      offset: 0.07, // beyond the search radius: the other tests compare exact result lists
      hours: [0, 1440],
      spaces: Array.from({ length: count }, (_, i) => ({
        label: `P${i + 1}`,
        ev: i === count - 1,
      })),
    });

    const response = await request(app.getHttpServer())
      .get(`/v1/parking/${slug('big')}`)
      .query({ start, end })
      .expect(200);
    const listing = ParkingListingDetailSchema.parse(response.body);

    expect(listing.spaces).toHaveLength(LISTING_SPACES_LIMIT);
    expect(listing.spaces.at(-1)?.label).toBe(`P${LISTING_SPACES_LIMIT}`); // label order, not text
    expect(listing.spaceCount).toBe(count);
    expect(listing.availability?.freeSpaces).toBe(count);
    expect(listing.features).toEqual(['evCharging']); // from a space beyond the ones sent
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
