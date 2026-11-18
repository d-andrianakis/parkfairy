import { randomUUID } from 'node:crypto';

import {
  addDays,
  DEFAULT_TIME_ZONE,
  ParkingListingDetailSchema,
  ParkingSearchResponseSchema,
  type ParkingSearchResult,
  zonedParts,
  zonedTimeToUtc,
} from '@parkfairy/contracts';
import { type Database, schema } from '@parkfairy/database';
import { eq, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newBookingReference } from '../src/bookings/booking-reference.js';
import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, type TestApp, type TestUser } from './test-app.js';

/*
 * The search filters of 5A.1: the features and the vehicle's size are asked of one space, the
 * security of the listing. Chania, far from every other suite's point, so only these listings meet.
 */
const HERE = { latitude: 35.5138, longitude: 24.018 };
const PREFIX = '000-it-filter-';
const tag = randomUUID().slice(0, 8);
const slug = (name: string) => `${PREFIX}${tag}-${name}`;
const WEEK = [1, 2, 3, 4, 5, 6, 7];

const tomorrow = addDays(zonedParts(new Date(), DEFAULT_TIME_ZONE).date, 1);
const start = zonedTimeToUtc(tomorrow, '10:00', DEFAULT_TIME_ZONE)?.toISOString() ?? '';
const end = zonedTimeToUtc(tomorrow, '12:30', DEFAULT_TIME_ZONE)?.toISOString() ?? '';

interface TestSpace {
  label: string;
  covered?: boolean;
  ev?: boolean;
  accessible?: boolean;
  height?: number;
  length?: number;
  width?: number;
  rate?: number;
}

async function addListing(
  db: Database,
  name: string,
  options: {
    offset: number;
    security?: { cctv?: boolean; lit?: boolean; gated?: boolean };
    arrival?: string;
    spaces: TestSpace[];
  },
) {
  const [row] = await db
    .insert(schema.parkingLocations)
    .values({
      slug: slug(name),
      name: `Φίλτρο ${name}`,
      address: 'Οδός Δοκιμής 1, Χανιά',
      areaId: 'syntagma',
      location: { latitude: HERE.latitude + options.offset, longitude: HERE.longitude },
      hourlyRateMinor: 300,
      dailyMaxMinor: 2000,
      status: 'published',
      hasCctv: options.security?.cctv ?? false,
      isLit: options.security?.lit ?? false,
      isGated: options.security?.gated ?? false,
      arrivalInstructions: options.arrival ?? null,
    })
    .returning({ id: schema.parkingLocations.id });
  const locationId = row?.id ?? '';
  const spaces = await db
    .insert(schema.parkingSpaces)
    .values(
      options.spaces.map((space) => ({
        locationId,
        label: space.label,
        isCovered: space.covered ?? false,
        hasEvCharging: space.ev ?? false,
        isAccessible: space.accessible ?? false,
        maxHeightCm: space.height ?? null,
        maxLengthCm: space.length ?? null,
        maxWidthCm: space.width ?? null,
        hourlyRateMinor: space.rate ?? null,
      })),
    )
    .returning({ id: schema.parkingSpaces.id, label: schema.parkingSpaces.label });
  await db
    .insert(schema.parkingOpeningHours)
    .values(WEEK.map((weekday) => ({ locationId, weekday, opensMinute: 0, closesMinute: 1440 })));
  return { locationId, spaces: Object.fromEntries(spaces.map((s) => [s.label, s.id])) };
}

describe('search filters (5A.1)', () => {
  let app: TestApp;
  let db: Database;
  let driver: TestUser;
  let garage: Awaited<ReturnType<typeof addListing>>;

  type Query = Record<string, string | string[]>;
  /** The results that are ours (other suites' listings are far away, but a leftover is not ours). */
  const search = async (query: Query = {}): Promise<ParkingSearchResult[]> => {
    const response = await request(app.getHttpServer())
      .get('/v1/parking/search')
      .query({ ...HERE, start, end, ...query })
      .expect(200);
    return ParkingSearchResponseSchema.parse(response.body).results.filter((result) =>
      result.slug.startsWith(`${PREFIX}${tag}-`),
    );
  };
  const refused = (query: Query) =>
    request(app.getHttpServer())
      .get('/v1/parking/search')
      .query({ ...HERE, start, end, ...query })
      .expect(400);
  /** Our listings' names, sorted. */
  const found = async (query: Query = {}) =>
    (await search(query)).map((result) => result.slug.slice(`${PREFIX}${tag}-`.length)).sort();
  const row = async (name: string, query: Query = {}) =>
    (await search(query)).find((result) => result.slug === slug(name));

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
    await db
      .delete(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    driver = await signUpUser(app);

    // CCTV and a gate. G2 is covered with a charger and takes 210 cm; G1 is covered and low.
    garage = await addListing(db, 'garage', {
      offset: 0.001,
      security: { cctv: true, gated: true },
      arrival: 'Code 4821, second level.',
      spaces: [
        { label: 'G1', covered: true, height: 190, length: 480, width: 210 },
        { label: 'G2', covered: true, ev: true, height: 210, rate: 450 },
        { label: 'G3' },
      ],
    });
    // Lit and open. Nothing stated, so any vehicle fits.
    await addListing(db, 'lot', {
      offset: 0.002,
      security: { lit: true },
      spaces: [{ label: 'O1' }, { label: 'O2', accessible: true }],
    });
    // Has covered and EV, but never in one space: the features are asked of one space.
    await addListing(db, 'split', {
      offset: 0.003,
      security: { cctv: true },
      spaces: [
        { label: 'T1', covered: true, height: 180 },
        { label: 'T2', ev: true },
      ],
    });
    // Every space states a limit, so a tall vehicle fits none.
    await addListing(db, 'tight', {
      offset: 0.004,
      spaces: [
        { label: 'K1', height: 170 },
        { label: 'K2', height: 175 },
      ],
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.bookings)
      .where(eq(schema.bookings.userId, driver.id))
      .catch(() => undefined);
    await db
      .delete(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}${tag}-%`));
    await app.close();
  });

  it('lists every listing when no filter is asked', async () => {
    expect(await found()).toEqual(['garage', 'lot', 'split', 'tight']);
  });

  describe('features, asked of one space', () => {
    it('keeps the listings with a space that has the feature', async () => {
      expect(await found({ features: 'covered' })).toEqual(['garage', 'split']);
      expect(await found({ features: 'evCharging' })).toEqual(['garage', 'split']);
      expect(await found({ features: 'accessible' })).toEqual(['lot']);
    });

    it('wants all of them in one space, not each somewhere in the listing', async () => {
      // `split` has a covered space and a charging space, but no space with both.
      expect(await found({ features: ['covered', 'evCharging'] })).toEqual(['garage']);
      expect(await found({ features: 'covered,evCharging' })).toEqual(['garage']);
      expect(await found({ features: ['covered', 'accessible'] })).toEqual([]);
    });
  });

  describe('security, asked of the listing', () => {
    it('keeps the listings that have it', async () => {
      expect(await found({ security: 'cctv' })).toEqual(['garage', 'split']);
      expect(await found({ security: 'lit' })).toEqual(['lot']);
      expect(await found({ security: 'gated' })).toEqual(['garage']);
    });

    it('wants all of them', async () => {
      expect(await found({ security: ['cctv', 'gated'] })).toEqual(['garage']);
      expect(await found({ security: ['cctv', 'lit'] })).toEqual([]);
    });

    it('combines with the space features', async () => {
      expect(await found({ security: 'cctv', features: 'evCharging' })).toEqual([
        'garage',
        'split',
      ]);
      expect(await found({ security: 'lit', features: 'covered' })).toEqual([]);
    });
  });

  describe('the vehicle’s size', () => {
    it('leaves out a space whose stated limit is below it, and keeps one with none stated', async () => {
      // `tight` states 170 and 175 everywhere; the rest have a space that fits or states nothing.
      expect(await found({ vehicleHeightCm: '180' })).toEqual(['garage', 'lot', 'split']);
      expect(await found({ vehicleHeightCm: '170' })).toEqual(['garage', 'lot', 'split', 'tight']);
      expect(await found({ vehicleHeightCm: '171' })).toEqual(['garage', 'lot', 'split', 'tight']);
      expect(await found({ vehicleHeightCm: '176' })).toEqual(['garage', 'lot', 'split']);
    });

    it('takes a limit equal to the vehicle as fitting', async () => {
      expect(await found({ vehicleHeightCm: '175' })).toContain('tight');
      expect(await found({ vehicleHeightCm: '176' })).not.toContain('tight');
    });

    describe('length and width, in a listing where every space states them', () => {
      beforeAll(async () => {
        await addListing(db, 'sized', {
          offset: 0.005,
          spaces: [
            { label: 'S1', length: 480, width: 200 },
            { label: 'S2', length: 450, width: 190 },
          ],
        });
      });
      afterAll(async () => {
        await db
          .delete(schema.parkingLocations)
          .where(eq(schema.parkingLocations.slug, slug('sized')));
      });
      const has = async (query: Query) => (await found(query)).includes('sized');

      it('keeps it for a vehicle that fits one space, and leaves it out for one that fits none', async () => {
        expect(await has({ vehicleLengthCm: '480' })).toBe(true);
        expect(await has({ vehicleLengthCm: '481' })).toBe(false);
        expect(await has({ vehicleWidthCm: '200' })).toBe(true);
        expect(await has({ vehicleWidthCm: '201' })).toBe(false);
      });

      it('asks them of the same space: S1 is long enough and S2 wide enough only singly', async () => {
        // S1 takes 480 x 200 and S2 450 x 190: 470 x 195 fits S1.
        expect(await has({ vehicleLengthCm: '470', vehicleWidthCm: '195' })).toBe(true);
        // No space takes 460 long and 205 wide: S1 is too narrow, S2 too short.
        expect(await has({ vehicleLengthCm: '460', vehicleWidthCm: '205' })).toBe(false);
        expect(await has({ vehicleLengthCm: '460', vehicleWidthCm: '195' })).toBe(true);
      });
    });

    it('asks length and width of the space as well', async () => {
      // Only G1 states them (480 and 210); the other spaces state nothing, and so fit.
      expect(await found({ vehicleLengthCm: '500' })).toEqual(['garage', 'lot', 'split', 'tight']);
      // G1 is out for both; the garage stays through G2 and G3 (nothing stated).
      expect(await found({ vehicleLengthCm: '500', vehicleWidthCm: '250' })).toContain('garage');
    });

    it('asks it of the same space as the features', async () => {
      // Covered and 200 cm high: G2 (covered, 210) does; `split`'s covered space states 180.
      expect(await found({ features: 'covered', vehicleHeightCm: '200' })).toEqual(['garage']);
      // At 190 the covered `split` space (180) is out, and the garage stays through G1 and G2.
      expect(await found({ features: 'covered', vehicleHeightCm: '190' })).toEqual(['garage']);
      expect(await found({ features: 'covered', vehicleHeightCm: '180' })).toEqual([
        'garage',
        'split',
      ]);
      // Taller than any covered space says: none, though G3 (nothing stated) takes any height.
      expect(await found({ features: 'covered', vehicleHeightCm: '250' })).toEqual([]);
    });
  });

  describe('what a result shows', () => {
    it('counts only the free spaces that meet the filter', async () => {
      expect((await row('garage'))?.freeSpaces).toBe(3);
      const filtered = await row('garage', {
        features: ['covered', 'evCharging'],
        vehicleHeightCm: '200',
      });
      expect(filtered?.freeSpaces).toBe(1);
    });

    it('quotes from the cheapest space that meets the filter', async () => {
      // G3 takes the listing's 3.00 an hour and is the cheapest overall; G2 alone costs 4.50.
      const cheapest = (await row('garage'))?.total.amountMinor ?? 0;
      const evOnly = (await row('garage', { features: 'evCharging' }))?.total.amountMinor ?? 0;
      expect(cheapest).toBeGreaterThan(0);
      expect(cheapest).toBeLessThan(evOnly);
    });

    it('shows each listing’s security, whichever filter found it', async () => {
      expect((await row('garage'))?.security).toEqual(['cctv', 'gated']);
      expect((await row('lot'))?.security).toEqual(['lit']);
      expect((await row('tight'))?.security).toEqual([]);
    });
  });

  describe('a space that is taken', () => {
    const take = (label: string) =>
      db.insert(schema.bookings).values({
        reference: newBookingReference(),
        userId: driver.id,
        locationId: garage.locationId,
        spaceId: garage.spaces[label] ?? null,
        spaceLabel: label,
        listingLocale: 'el' as const,
        startsAt: new Date(start),
        endsAt: new Date(end),
        gapMinutes: 0,
        blockedUntil: new Date(end),
        status: 'confirmed' as const,
        holdExpiresAt: new Date(start),
        totalMinor: 400,
        currency: 'EUR',
        cancellationPolicy: 'oneDay' as const,
        commissionBps: 1000,
        vehiclePlate: 'IKB1234',
        confirmedAt: new Date(),
      });

    it('counts against a filter only when it is one that meets it', async () => {
      expect(await found({ features: ['covered', 'evCharging'] })).toEqual(['garage']);
      // G1 is covered but has no charger: taking it leaves G2, which has both.
      await take('G1');
      expect(await found({ features: ['covered', 'evCharging'] })).toEqual(['garage']);
      expect(await found({ features: 'evCharging' })).toEqual(['garage', 'split']);
      const left = await row('garage', { features: 'evCharging' });
      // One free space meets it (G2); the booked space that does not is not subtracted from it.
      expect(left?.freeSpaces).toBe(1);
      expect((await row('garage'))?.freeSpaces).toBe(2);
    });

    it('leaves nothing for a filter once the only space that meets it is taken', async () => {
      // G2 is the only covered space with a charger.
      await take('G2');
      expect(await found({ features: ['covered', 'evCharging'] })).toEqual([]);
      expect(await found({ features: 'evCharging' })).toEqual(['split']);
      // Only G3 is free now, and it states no limit and has no features.
      expect((await row('garage'))?.freeSpaces).toBe(1);
      expect(await found({ vehicleHeightCm: '250' })).toContain('garage');
    });
  });

  describe('a request that is not a filter', () => {
    it.each<Record<string, string>>([
      { features: 'hovercraft' },
      { security: 'moat' },
      { features: 'cctv' },
      { vehicleHeightCm: '99' },
      { vehicleHeightCm: '501' },
      { vehicleLengthCm: '1501' },
      { vehicleWidthCm: '50' },
      { vehicleHeightCm: '190.5' },
      { vehicleHeightCm: 'tall' },
    ])('is refused: %j', async (query) => {
      await refused(query);
    });

    it('is not an injection: a quote or a statement in a size or a feature is only refused', async () => {
      await refused({ vehicleHeightCm: '1; drop table parking_spaces; --' });
      await refused({ features: "covered' or true --" });
      expect(await found()).toEqual(['garage', 'lot', 'split', 'tight']);
    });
  });

  describe('the listing page', () => {
    it('shows security and each space’s limits, and never the arrival instructions', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/parking/${slug('garage')}`)
        .expect(200);
      const detail = ParkingListingDetailSchema.parse(response.body);
      expect(detail.security).toEqual(['cctv', 'gated']);
      const space = (label: string) => detail.spaces.find((s) => s.label === label);
      expect(space('G1')).toMatchObject({ maxHeightCm: 190, maxLengthCm: 480, maxWidthCm: 210 });
      expect(space('G2')).toMatchObject({ maxHeightCm: 210, maxLengthCm: null });
      expect(space('G3')).toMatchObject({ maxHeightCm: null, maxLengthCm: null, maxWidthCm: null });
      // A gate code is for the driver of a booking: not in the page, the search or the featured list.
      expect(JSON.stringify(response.body)).not.toContain('4821');
      expect(JSON.stringify(response.body)).not.toMatch(/arrival/i);
      const searched = await request(app.getHttpServer())
        .get('/v1/parking/search')
        .query({ ...HERE, start, end });
      expect(JSON.stringify(searched.body)).not.toContain('4821');
      const featured = await request(app.getHttpServer()).get('/v1/parking/featured');
      // It is in the list (the prefix sorts first), so the check means something.
      const listed = (featured.body as { listings: { slug: string; security: string[] }[] })
        .listings;
      expect(listed.find((l) => l.slug === slug('garage'))?.security).toEqual(['cctv', 'gated']);
      expect(JSON.stringify(featured.body)).not.toContain('4821');
    });
  });
});
