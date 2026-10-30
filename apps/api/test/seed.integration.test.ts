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
  spaces: [{ label: 'A1' }, { label: 'A2', hasEvCharging: true }],
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
});
