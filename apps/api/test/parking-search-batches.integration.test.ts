import { randomUUID } from 'node:crypto';
import {
  addDays,
  DEFAULT_TIME_ZONE,
  ParkingSearchResponseSchema,
  zonedParts,
  zonedTimeToUtc,
} from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/database/database.module.js';
import { createTestApp, type TestApp } from './test-app.js';

// Chania: far from Heraklion (parking.integration.test.ts) and from every demo area. The
// 000-it- prefix is cleaned up by both suites.
const CHANIA = { latitude: 35.5138, longitude: 24.018 };
const PREFIX = `000-it-batch-${randomUUID().slice(0, 8)}-`;
const CLOSED_NEARER = 101; // more than one batch (100)

const tomorrow = addDays(zonedParts(new Date(), DEFAULT_TIME_ZONE).date, 1);
const start = zonedTimeToUtc(tomorrow, '10:00', DEFAULT_TIME_ZONE)?.toISOString() ?? '';
const end = zonedTimeToUtc(tomorrow, '12:30', DEFAULT_TIME_ZONE)?.toISOString() ?? '';

async function addListings(
  db: Database,
  listings: { slug: string; offset: number; hours: [number, number] }[],
) {
  const rows = await db
    .insert(schema.parkingLocations)
    .values(
      listings.map((listing) => ({
        slug: listing.slug,
        name: `Δοκιμή ${listing.slug}`,
        address: 'Οδός Δοκιμής 1, Χανιά',
        areaId: 'syntagma' as const,
        location: { latitude: CHANIA.latitude + listing.offset, longitude: CHANIA.longitude },
        hourlyRateMinor: 300,
        dailyMaxMinor: 2000,
        status: 'published' as const,
      })),
    )
    .returning({ id: schema.parkingLocations.id, slug: schema.parkingLocations.slug });
  await db
    .insert(schema.parkingSpaces)
    .values(rows.map((row) => ({ locationId: row.id, label: 'P1' })));
  const hours = new Map(listings.map((listing) => [listing.slug, listing.hours]));
  await db.insert(schema.parkingOpeningHours).values(
    rows.flatMap((row) => {
      const [opensMinute, closesMinute] = hours.get(row.slug) ?? [0, 0];
      return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        locationId: row.id,
        weekday,
        opensMinute,
        closesMinute,
      }));
    }),
  );
}

describe('search reads past the first batch of candidates', () => {
  let app: TestApp;
  let db: Database;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
    await addListings(db, [
      ...Array.from({ length: CLOSED_NEARER }, (_, i) => ({
        slug: `${PREFIX}closed-${String(i).padStart(3, '0')}`,
        offset: 0.00001 * (i + 1), // all within ~110 m
        hours: [0, 60] as [number, number], // open only 00:00–01:00
      })),
      { slug: `${PREFIX}open`, offset: 0.01, hours: [0, 1440] }, // ~1.1 km
    ]);
  });

  afterAll(async () => {
    await db
      .delete(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    await app.close();
  });

  it('finds an open listing behind more than 100 nearer closed ones', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/parking/search')
      .query({ ...CHANIA, start, end })
      .expect(200);
    const slugs = ParkingSearchResponseSchema.parse(response.body).results.map((r) => r.slug);
    expect(slugs).toEqual([`${PREFIX}open`]);
  });
});
