import { randomUUID } from 'node:crypto';
import type { Auth } from '@parkfairy/auth';
import { schema, type Database } from '@parkfairy/database';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH } from '../src/auth/auth.tokens.js';
import { DB } from '../src/database/database.module.js';
import { DEMO_ACCOUNT, type DemoListing } from '../src/seed/demo-data.js';
import { assertMarkedLocal, ensureDemoAccount, upsertListing } from '../src/seed/seed.js';
import { createTestApp, type TestApp } from './test-app.js';

const listing: DemoListing = {
  slug: `000-seed-${randomUUID().slice(0, 8)}`,
  name: 'Δοκιμαστικό γκαράζ',
  address: 'Οδός Δοκιμής 2, Ηράκλειο',
  description: 'Για τον έλεγχο του seed.',
  areaId: 'syntagma',
  latitude: 35.33,
  longitude: 25.14,
  hourlyRateMinor: 300,
  dailyMaxMinor: 2000,
  openingHours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    opensMinute: 0,
    closesMinute: 1440,
  })),
  hoursExceptions: [
    { label: 'Αργία', fromDay: 3, toDay: 3, hours: null, closedHours: null },
    {
      label: null,
      fromDay: 5,
      toDay: 6,
      hours: { opens: '08:00', closes: '14:30' },
      closedHours: null,
    },
    {
      label: 'Έργα',
      fromDay: 8,
      toDay: 8,
      hours: null,
      closedHours: { from: '14:00', to: '16:00' },
    },
  ],
  spaces: [{ label: 'A1' }, { label: 'A2', hasEvCharging: true }],
  cancellationPolicy: 'oneDay',
};

describe('demo seed', () => {
  let app: TestApp;
  let db: Database;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
  });

  afterAll(async () => {
    await db.delete(schema.parkingLocations).where(eq(schema.parkingLocations.slug, listing.slug));
    await app.close();
  });

  it('only runs against databases marked local', async () => {
    await expect(assertMarkedLocal(db)).resolves.toBeUndefined(); // pnpm db:up / CI mark it
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local parkfairy.environment = 'shared'`);
      await expect(assertMarkedLocal(tx as unknown as Database)).rejects.toThrow(/not marked/);
    });
  });

  it('upserts listings: running twice leaves one listing with the same spaces and hours', async () => {
    await upsertListing(db, listing);
    await upsertListing(db, { ...listing, hourlyRateMinor: 350 });

    const rows = await db
      .select({ id: schema.parkingLocations.id, rate: schema.parkingLocations.hourlyRateMinor })
      .from(schema.parkingLocations)
      .where(eq(schema.parkingLocations.slug, listing.slug));
    expect(rows).toEqual([{ id: expect.any(String) as string, rate: 350 }]);
    const id = rows[0]?.id ?? '';
    const [spaces] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.parkingSpaces)
      .where(eq(schema.parkingSpaces.locationId, id));
    const [periods] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.parkingOpeningHours)
      .where(eq(schema.parkingOpeningHours.locationId, id));
    expect(spaces?.n).toBe(2);
    expect(periods?.n).toBe(7);
  });

  it('dates closures from the day it runs, replacing the last run’s', async () => {
    const closures = () =>
      db
        .select({
          startsOn: schema.parkingHoursExceptions.startsOn,
          endsOn: schema.parkingHoursExceptions.endsOn,
          opensMinute: schema.parkingHoursExceptions.opensMinute,
          closesMinute: schema.parkingHoursExceptions.closesMinute,
          closedFromMinute: schema.parkingHoursExceptions.closedFromMinute,
          closedToMinute: schema.parkingHoursExceptions.closedToMinute,
          label: schema.parkingHoursExceptions.label,
        })
        .from(schema.parkingHoursExceptions)
        .innerJoin(
          schema.parkingLocations,
          eq(schema.parkingLocations.id, schema.parkingHoursExceptions.locationId),
        )
        .where(eq(schema.parkingLocations.slug, listing.slug))
        .orderBy(schema.parkingHoursExceptions.startsOn);
    await upsertListing(db, listing, '2030-03-01');
    await upsertListing(db, listing, '2030-03-10');
    expect(await closures()).toEqual([
      {
        startsOn: '2030-03-13',
        endsOn: '2030-03-13',
        opensMinute: null,
        closesMinute: null,
        closedFromMinute: null,
        closedToMinute: null,
        label: 'Αργία',
      },
      {
        startsOn: '2030-03-15',
        endsOn: '2030-03-16',
        opensMinute: 480,
        closesMinute: 870,
        closedFromMinute: null,
        closedToMinute: null,
        label: null,
      },
      {
        startsOn: '2030-03-18',
        endsOn: '2030-03-18',
        opensMinute: null,
        closesMinute: null,
        closedFromMinute: 840,
        closedToMinute: 960,
        label: 'Έργα',
      },
    ]);
    await upsertListing(db, { ...listing, hoursExceptions: [] });
    expect(await closures()).toEqual([]);
  });

  it('creates the demo account once, and its documented password signs in', async () => {
    await ensureDemoAccount(db);
    expect(await ensureDemoAccount(db)).toBe('exists');

    const auth = app.get<Auth>(AUTH);
    const response = await auth.api.signInEmail({
      body: { email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
  });

  it('confirms a demo account seeded before sign-in needed a confirmed address', async () => {
    await ensureDemoAccount(db);
    await db
      .update(schema.users)
      .set({ emailVerified: false })
      .where(eq(schema.users.email, DEMO_ACCOUNT.email));

    expect(await ensureDemoAccount(db)).toBe('exists');

    const [demo] = await db
      .select({ emailVerified: schema.users.emailVerified })
      .from(schema.users)
      .where(eq(schema.users.email, DEMO_ACCOUNT.email));
    expect(demo?.emailVerified).toBe(true);
  });
});
