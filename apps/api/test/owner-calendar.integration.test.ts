import { randomUUID } from 'node:crypto';

import {
  addMonths,
  CALENDAR_BOOKINGS_MAX,
  CALENDAR_MONTHS_AWAY,
  currentMonth,
  type OwnerCalendar,
  OwnerCalendarSchema,
} from '@parkfairy/contracts';
import { type Database, schema } from '@parkfairy/database';
import { eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newBookingReference } from '../src/bookings/booking-reference.js';
import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, type TestApp, type TestUser } from './test-app.js';

// The owner's calendar (5.1). Heraklion: far from the demo areas and every other suite's point.
const HERE = { latitude: 35.3387, longitude: 25.1442 };
const PREFIX = 'it-cal-';
const tag = randomUUID().slice(0, 8);
// Far enough ahead to be ours alone, near enough to be allowed.
const MONTH = addMonths(currentMonth(), 7);

describe('owner calendar (5.1)', () => {
  let app: TestApp;
  let db: Database;
  const users: TestUser[] = [];
  const visitors = new Map<string, string>();

  const call = (user: TestUser | null, query = '') => {
    const req = request(app.getHttpServer()).get(`/v1/owner/calendar${query}`);
    if (!user) return req;
    let address = visitors.get(user.id);
    if (!address) {
      address = `198.51.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
      visitors.set(user.id, address);
    }
    return req.set('Cookie', user.cookie).set('X-Forwarded-For', address);
  };
  const calendar = async (user: TestUser, query = ''): Promise<OwnerCalendar> =>
    OwnerCalendarSchema.parse((await call(user, query).expect(200)).body);

  async function person(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }

  async function owner() {
    const user = await person();
    const [profile] = await db
      .insert(schema.ownerProfiles)
      .values({ userId: user.id, kind: 'individual' })
      .returning({ id: schema.ownerProfiles.id });
    return { user, profileId: profile?.id ?? '' };
  }

  async function listingOf(name: string, primary: string, co?: string) {
    const [row] = await db
      .insert(schema.parkingLocations)
      .values({
        ownerId: primary,
        slug: `${PREFIX}${tag}-${name}`,
        name: `Ημερολόγιο ${name}`,
        address: 'Οδός Δοκιμής 7, Ηράκλειο',
        areaId: 'syntagma',
        location: HERE,
        hourlyRateMinor: 200,
        bookingGapMinutes: 0,
        cancellationPolicy: 'oneDay',
        status: 'published',
      })
      .returning({ id: schema.parkingLocations.id });
    const id = row?.id ?? '';
    await db.insert(schema.listingOwners).values({
      locationId: id,
      ownerId: primary,
      role: 'primary',
      shareBps: co ? 7000 : 10_000,
    });
    if (co) {
      await db
        .insert(schema.listingOwners)
        .values({ locationId: id, ownerId: co, role: 'co_owner', shareBps: 3000 });
    }
    return id;
  }

  const booking = (
    driver: TestUser,
    locationId: string,
    startsAt: string,
    extra: Partial<typeof schema.bookings.$inferInsert> = {},
  ) => {
    const starts = new Date(startsAt);
    const endsAt = new Date(starts.getTime() + 2 * 3_600_000);
    return {
      reference: newBookingReference(),
      userId: driver.id,
      locationId,
      spaceLabel: 'A1',
      listingLocale: 'el' as const,
      startsAt: starts,
      endsAt,
      gapMinutes: 0,
      blockedUntil: endsAt,
      status: 'confirmed' as const,
      holdExpiresAt: starts,
      totalMinor: 400,
      currency: 'EUR',
      cancellationPolicy: 'oneDay' as const,
      commissionBps: 1000,
      vehiclePlate: 'IKB1234',
      confirmedAt: new Date(),
      ...extra,
    };
  };
  const insert = (...rows: ReturnType<typeof booking>[]) =>
    db.insert(schema.bookings).values(rows).returning({ id: schema.bookings.id });

  async function removeOurs() {
    const ours = await db
      .select({ id: schema.parkingLocations.id })
      .from(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    const ids = ours.map((found) => found.id);
    if (ids.length === 0) return;
    await db.delete(schema.bookings).where(inArray(schema.bookings.locationId, ids));
    await db.delete(schema.listingOwners).where(inArray(schema.listingOwners.locationId, ids));
    await db.delete(schema.parkingLocations).where(inArray(schema.parkingLocations.id, ids));
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
    await removeOurs();
  });

  afterAll(async () => {
    await removeOurs();
    const ids = users.map((user) => user.id);
    if (ids.length > 0) {
      await db.delete(schema.ownerProfiles).where(inArray(schema.ownerProfiles.userId, ids));
      await db.delete(schema.users).where(inArray(schema.users.id, ids));
    }
    await app.close();
  });

  it('needs an account', async () => {
    await call(null).expect(401);
  });

  it('refuses a month or a listing that is not one, and a month too far off', async () => {
    const { user } = await owner();
    for (const query of [
      '?month=2026-13',
      '?month=soon',
      '?month=',
      '?listing=garage',
      `?month=${addMonths(currentMonth(), CALENDAR_MONTHS_AWAY + 1)}`,
      `?month=${addMonths(currentMonth(), -CALENDAR_MONTHS_AWAY - 1)}`,
    ]) {
      const response = await call(user, query).expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    await call(user, `?month=${addMonths(currentMonth(), CALENDAR_MONTHS_AWAY)}`).expect(200);
  });

  it('is empty this month for someone with no listings, with the month’s neighbours to go to', async () => {
    const nobody = await person();
    const seen = await calendar(nobody);
    expect(seen).toMatchObject({
      month: currentMonth(),
      previous: addMonths(currentMonth(), -1),
      next: addMonths(currentMonth(), 1),
      listing: null,
      listings: [],
      days: [],
      truncated: false,
    });
  });

  it('stops offering months at the edge of what can be looked at', async () => {
    const { user } = await owner();
    const far = await calendar(user, `?month=${addMonths(currentMonth(), CALENDAR_MONTHS_AWAY)}`);
    expect(far.next).toBeNull();
    expect(far.previous).not.toBeNull();
    const back = await calendar(user, `?month=${addMonths(currentMonth(), -CALENDAR_MONTHS_AWAY)}`);
    expect(back.previous).toBeNull();
    expect(back.next).not.toBeNull();
  });

  it('shows a co-owner the bookings of a shared listing, grouped by the day they start, and a stranger none', async () => {
    const driver = await person();
    const primary = await owner();
    const co = await owner();
    const stranger = await owner();
    const id = await listingOf('shared', primary.profileId, co.profileId);
    const [first, second, third] = await insert(
      booking(driver, id, `${MONTH}-10T09:00:00Z`),
      booking(driver, id, `${MONTH}-10T14:00:00Z`, { spaceLabel: 'A2' }),
      booking(driver, id, `${MONTH}-12T09:00:00Z`),
    );
    // Not confirmed, or in another month: not here.
    await insert(
      booking(driver, id, `${MONTH}-11T09:00:00Z`, {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: 'driver',
        refundMinor: 400,
      }),
      booking(driver, id, `${addMonths(MONTH, 1)}-10T09:00:00Z`),
      // A hold nobody paid for, and holds that ran out or were let go: no one is coming.
      booking(driver, id, `${MONTH}-13T09:00:00Z`, { status: 'held' }),
      booking(driver, id, `${MONTH}-14T09:00:00Z`, { status: 'expired' }),
      booking(driver, id, `${MONTH}-15T09:00:00Z`, { status: 'released' }),
    );

    for (const who of [primary.user, co.user]) {
      const seen = await calendar(who, `?month=${MONTH}`);
      expect(seen.days.map((day) => day.date)).toEqual([`${MONTH}-10`, `${MONTH}-12`]);
      expect(seen.days[0]?.bookings.map((found) => found.id)).toEqual([first?.id, second?.id]);
      expect(seen.days[1]?.bookings.map((found) => found.id)).toEqual([third?.id]);
      expect(seen.days[0]?.bookings[0]).toMatchObject({
        spaceLabel: 'A1',
        vehiclePlate: 'IKB1234',
        driverName: 'Test Driver',
        timeZone: 'Europe/Athens',
        listing: { id, name: 'Ημερολόγιο shared', contentLocale: 'el' },
      });
      expect(seen.listings).toEqual([expect.objectContaining({ id })]);
      expect(seen.truncated).toBe(false);
    }
    const none = await calendar(stranger.user, `?month=${MONTH}`);
    expect(none.days).toEqual([]);
    expect(none.listings).toEqual([]);
  });

  it('shows a co-owner no stay that ended before they joined, the primary owner all of it', async () => {
    const driver = await person();
    const primary = await owner();
    const co = await owner();
    const id = await listingOf('joined', primary.profileId, co.profileId);
    const past = addMonths(currentMonth(), -2);
    // The listing is older than the stays; the co-owner joined after the first, during the second.
    await db
      .update(schema.listingOwners)
      .set({ createdAt: new Date(`${addMonths(past, -1)}-01T00:00:00Z`) })
      .where(eq(schema.listingOwners.ownerId, primary.profileId));
    await db
      .update(schema.listingOwners)
      .set({ createdAt: new Date(`${past}-15T12:00:00Z`) })
      .where(eq(schema.listingOwners.ownerId, co.profileId));
    const [before, during, after] = await insert(
      booking(driver, id, `${past}-10T09:00:00Z`),
      booking(driver, id, `${past}-15T11:00:00Z`),
      booking(driver, id, `${past}-20T09:00:00Z`),
    );
    const ids = (seen: OwnerCalendar) =>
      seen.days.flatMap((day) => day.bookings.map((found) => found.id));
    expect(ids(await calendar(primary.user, `?month=${past}`))).toEqual([
      before?.id,
      during?.id,
      after?.id,
    ]);
    // A stay under way when they joined is theirs to see; one over before is not.
    expect(ids(await calendar(co.user, `?month=${past}`))).toEqual([during?.id, after?.id]);
  });

  it('puts a booking on the day it starts by its listing’s own clock', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const id = await listingOf('midnight', profileId);
    // 22:30 UTC on the last day of the month is already 00:30 on the first of the next, in Athens
    // (summer or winter: the offset is at least two hours).
    const lastDay = `${MONTH}-${new Date(Date.UTC(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5)), 0)).getUTCDate()}`;
    const [late] = await insert(booking(driver, id, `${lastDay}T22:30:00Z`));
    const thisMonth = await calendar(user, `?month=${MONTH}`);
    expect(thisMonth.days.flatMap((day) => day.bookings.map((found) => found.id))).not.toContain(
      late?.id,
    );
    const next = await calendar(user, `?month=${addMonths(MONTH, 1)}`);
    expect(next.days[0]).toMatchObject({ date: `${addMonths(MONTH, 1)}-01` });
    expect(next.days[0]?.bookings.map((found) => found.id)).toContain(late?.id);
  });

  it('filters to one listing, and treats someone else’s as no filter at all', async () => {
    const driver = await person();
    const mine = await owner();
    const other = await owner();
    const idA = await listingOf('filter-a', mine.profileId);
    const idB = await listingOf('filter-b', mine.profileId);
    const idOther = await listingOf('filter-other', other.profileId);
    await insert(
      booking(driver, idA, `${MONTH}-05T09:00:00Z`),
      booking(driver, idB, `${MONTH}-06T09:00:00Z`),
      booking(driver, idOther, `${MONTH}-07T09:00:00Z`),
    );
    const all = await calendar(mine.user, `?month=${MONTH}`);
    expect(all.days.map((day) => day.date)).toEqual([`${MONTH}-05`, `${MONTH}-06`]);
    expect(all.listings.map((found) => found.id).sort()).toEqual([idA, idB].sort());

    const justB = await calendar(mine.user, `?month=${MONTH}&listing=${idB}`);
    expect(justB.listing).toBe(idB);
    expect(justB.days.map((day) => day.date)).toEqual([`${MONTH}-06`]);

    // Another owner's listing: nothing of it, and not even that it exists.
    const theirs = await calendar(mine.user, `?month=${MONTH}&listing=${idOther}`);
    expect(theirs.listing).toBeNull();
    expect(theirs.days).toEqual([]);
    expect(JSON.stringify(theirs)).not.toContain(idOther);
    const unknown = await calendar(mine.user, `?month=${MONTH}&listing=${randomUUID()}`);
    expect(unknown.days).toEqual([]);
    expect(unknown.listing).toBeNull();
  });

  it('cuts a very busy month, and says so', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const id = await listingOf('busy', profileId);
    const month = addMonths(MONTH, 2);
    await insert(
      ...Array.from({ length: CALENDAR_BOOKINGS_MAX + 1 }, (_, n) =>
        booking(
          driver,
          id,
          `${month}-${String(1 + (n % 27)).padStart(2, '0')}T${String(Math.floor(n / 27)).padStart(2, '0')}:00:00Z`,
          { spaceLabel: `S${n}` },
        ),
      ),
    );
    const seen = await calendar(user, `?month=${month}`);
    expect(seen.truncated).toBe(true);
    expect(seen.days.reduce((sum, day) => sum + day.bookings.length, 0)).toBe(
      CALENDAR_BOOKINGS_MAX,
    );
    // The cut is from the end: what stays is the earliest, in order, the day before the cut whole.
    const starts = seen.days.flatMap((day) => day.bookings.map((found) => found.start));
    expect(starts).toEqual([...starts].sort());
    expect(seen.days.at(-1)?.date).toBe(`${month}-27`);
    // The cut is from the end: the first day is whole.
    expect(seen.days[0]?.date).toBe(`${month}-01`);
  });
});
