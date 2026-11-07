/**
 * Demo marketplace and demo account for LOCAL databases (`pnpm db:seed`, see main.ts).
 * Idempotent: listings are upserted by slug, and the account is created once.
 */
import { readFile } from 'node:fs/promises';
import { createAuth, parseOrigins } from '@parkfairy/auth';
import { addDays, DEFAULT_TIME_ZONE, wallMinutes, zonedParts } from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { eq, sql } from 'drizzle-orm';
import { NO_PRICE_RULES } from '../parking/pricing.js';
import type { ObjectStore } from '../storage/object-store.js';
import { storePhoto } from '../storage/photo-pipeline.js';
import { DEMO_ACCOUNT, type DemoListing } from './demo-data.js';
import type { DemoPhoto } from './demo-photos.js';

/** From `src/seed` and `dist/seed` alike. */
const PHOTOS_DIRECTORY = new URL('../../seed-assets/photos/', import.meta.url);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The demo password is public, so the seed must never touch a shared database. First check:
 * the URL names this machine. node-postgres lets `?host=`/`?hostaddr=` override the host, so
 * those are refused too, as are session options (`?options=`, PGOPTIONS), which could fake
 * the marker. Tunnels look local, hence the database marker check as well.
 */
export function assertLocalDatabase(
  databaseUrl: string,
  nodeEnv = process.env.NODE_ENV,
  pgOptions = process.env.PGOPTIONS,
): void {
  const url = new URL(databaseUrl);
  const host = url.hostname;
  const overrides =
    ['host', 'hostaddr', 'options'].some((key) => url.searchParams.has(key)) || Boolean(pgOptions);
  if (nodeEnv === 'production' || overrides || !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to seed demo data into ${host} (NODE_ENV=${nodeEnv ?? 'unset'}): local databases only.`,
    );
  }
}

/** Second check: only databases marked local (infra/postgres/init/02-local-marker.sql). */
export async function assertMarkedLocal(db: Database): Promise<void> {
  const result = await db.execute<{ environment: string | null }>(
    sql`select current_setting('parkfairy.environment', true) as environment`,
  );
  if (result.rows[0]?.environment !== 'local') {
    throw new Error(
      'Refusing to seed: this database is not marked as a local copy. For the docker compose ' +
        'database run "pnpm db:up", which sets parkfairy.environment = local.',
    );
  }
}

/** `today` is the Athens date the closures' days count from. */
export async function upsertListing(
  db: Database,
  listing: DemoListing,
  today = zonedParts(new Date(), DEFAULT_TIME_ZONE).date,
): Promise<void> {
  const {
    openingHours,
    hoursExceptions = [],
    spaces,
    priceRules,
    latitude,
    longitude,
    ...columns
  } = listing;
  const values = { ...columns, location: { latitude, longitude }, status: 'published' as const };
  const rules = { ...NO_PRICE_RULES, ...priceRules };
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.parkingLocations)
      .values(values)
      .onConflictDoUpdate({ target: schema.parkingLocations.slug, set: values })
      .returning({ id: schema.parkingLocations.id });
    if (!row) throw new Error(`Upsert of ${listing.slug} returned no row`);
    await tx.delete(schema.parkingSpaces).where(eq(schema.parkingSpaces.locationId, row.id));
    await tx
      .delete(schema.parkingOpeningHours)
      .where(eq(schema.parkingOpeningHours.locationId, row.id));
    await tx
      .delete(schema.parkingPriceRules)
      .where(eq(schema.parkingPriceRules.locationId, row.id));
    await tx
      .delete(schema.parkingStayDiscounts)
      .where(eq(schema.parkingStayDiscounts.locationId, row.id));
    await tx
      .delete(schema.parkingHoursExceptions)
      .where(eq(schema.parkingHoursExceptions.locationId, row.id));
    await tx
      .insert(schema.parkingSpaces)
      .values(spaces.map((space) => ({ ...space, locationId: row.id })));
    await tx
      .insert(schema.parkingOpeningHours)
      .values(openingHours.map((period) => ({ ...period, locationId: row.id })));
    if (hoursExceptions.length > 0) {
      await tx.insert(schema.parkingHoursExceptions).values(
        hoursExceptions.map(({ label, fromDay, toDay, hours: open, closedHours: shut }) => ({
          locationId: row.id,
          label,
          startsOn: addDays(today, fromDay),
          endsOn: addDays(today, toDay),
          opensMinute: open ? wallMinutes(open.opens) : null,
          closesMinute: open ? wallMinutes(open.closes) : null,
          closedFromMinute: shut ? wallMinutes(shut.from) : null,
          closedToMinute: shut ? wallMinutes(shut.to) : null,
        })),
      );
    }
    if (rules.weekendRateMinor !== null) {
      await tx.insert(schema.parkingPriceRules).values({
        locationId: row.id,
        kind: 'weekend',
        hourlyRateMinor: rules.weekendRateMinor,
      });
    }
    if (rules.night) {
      await tx.insert(schema.parkingPriceRules).values({
        locationId: row.id,
        kind: 'night',
        hourlyRateMinor: rules.night.rateMinor,
        fromMinute: rules.night.fromMinute,
        toMinute: rules.night.toMinute,
      });
    }
    if (rules.discounts.length > 0) {
      await tx
        .insert(schema.parkingStayDiscounts)
        .values(rules.discounts.map((discount) => ({ ...discount, locationId: row.id })));
    }
  });
}

/**
 * Puts a listing's photos through the same pipeline as an owner's upload, so demo pages exercise
 * what real ones will. Replaces what was there; the files themselves are named by content, so a
 * second run overwrites them with the same bytes.
 */
export async function seedPhotos(
  db: Database,
  store: ObjectStore,
  slug: string,
  photos: DemoPhoto[],
): Promise<void> {
  const [listing] = await db
    .select({ id: schema.parkingLocations.id })
    .from(schema.parkingLocations)
    .where(eq(schema.parkingLocations.slug, slug));
  if (!listing) throw new Error(`No listing ${slug} to add photos to`);
  const rows = await Promise.all(
    photos.map(async ({ file, alt }, position) => ({
      ...(await storePhoto(await readFile(new URL(file, PHOTOS_DIRECTORY)), store)),
      alt,
      position,
      locationId: listing.id,
    })),
  );
  await db.transaction(async (tx) => {
    await tx.delete(schema.parkingPhotos).where(eq(schema.parkingPhotos.locationId, listing.id));
    await tx.insert(schema.parkingPhotos).values(rows);
  });
}

export async function ensureDemoAccount(db: Database): Promise<'created' | 'exists'> {
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, DEMO_ACCOUNT.email));
  if (existing) {
    await confirmDemoEmail(db); // seeded before sign-in required a confirmed address
    return 'exists';
  }
  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const auth = createAuth({
    db,
    secret: process.env.BETTER_AUTH_SECRET ?? '',
    baseURL,
    trustedOrigins: [baseURL, ...parseOrigins(process.env.TRUSTED_ORIGINS)],
  });
  // Through Better Auth, so the password is hashed exactly as at sign-up.
  await auth.api.signUpEmail({ body: { ...DEMO_ACCOUNT } });
  await confirmDemoEmail(db);
  return 'created';
}

/** The demo address receives no mail, and the account has to work straight away. */
async function confirmDemoEmail(db: Database): Promise<void> {
  await db
    .update(schema.users)
    .set({ emailVerified: true })
    .where(eq(schema.users.email, DEMO_ACCOUNT.email));
}
