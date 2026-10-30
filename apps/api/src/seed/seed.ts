/**
 * Demo marketplace and demo account for LOCAL databases (`pnpm db:seed`, see main.ts).
 * Idempotent: listings are upserted by slug, and the account is created once.
 */
import { createAuth, parseOrigins } from '@parkfairy/auth';
import { schema, type Database } from '@parkfairy/database';
import { eq, sql } from 'drizzle-orm';
import { DEMO_ACCOUNT, type DemoListing } from './demo-data.js';

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

export async function upsertListing(db: Database, listing: DemoListing): Promise<void> {
  const { openingHours, spaces, latitude, longitude, ...columns } = listing;
  const values = { ...columns, location: { latitude, longitude }, status: 'published' as const };
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
      .insert(schema.parkingSpaces)
      .values(spaces.map((space) => ({ ...space, locationId: row.id })));
    await tx
      .insert(schema.parkingOpeningHours)
      .values(openingHours.map((period) => ({ ...period, locationId: row.id })));
  });
}

export async function ensureDemoAccount(db: Database): Promise<'created' | 'exists'> {
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, DEMO_ACCOUNT.email));
  if (existing) return 'exists';
  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const auth = createAuth({
    db,
    secret: process.env.BETTER_AUTH_SECRET ?? '',
    baseURL,
    trustedOrigins: [baseURL, ...parseOrigins(process.env.TRUSTED_ORIGINS)],
  });
  // Through Better Auth, so the password is hashed exactly as at sign-up.
  await auth.api.signUpEmail({ body: { ...DEMO_ACCOUNT } });
  return 'created';
}
