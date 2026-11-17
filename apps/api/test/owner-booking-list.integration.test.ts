import { randomUUID } from 'node:crypto';

import {
  BOOKINGS_PAGE_SIZE,
  type OwnerBookingList,
  OwnerBookingListSchema,
} from '@parkfairy/contracts';
import { type Database, schema } from '@parkfairy/database';
import { eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newBookingReference } from '../src/bookings/booking-reference.js';
import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, type TestApp, type TestUser } from './test-app.js';

// The owner's list of bookings across listings (5.1). Heraklion: far from the demo areas and every
// other suite's point.
const HERE = { latitude: 35.3387, longitude: 25.1442 };
const PREFIX = 'it-bl-';
const tag = randomUUID().slice(0, 8);
const DAY = 24 * 3_600_000;

/** `days` from now, on the hour (a stay never starts at a time that depends on when this runs). */
const inDays = (days: number, hour = 12) => {
  const at = new Date(Date.now() + days * DAY);
  at.setUTCHours(hour, 0, 0, 0);
  return at;
};

/** The day after `day`, as `2026-11-18`. */
const addDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

describe('owner list of bookings (5.1)', () => {
  let app: TestApp;
  let db: Database;
  const users: TestUser[] = [];
  const visitors = new Map<string, string>();

  const call = (user: TestUser | null, query = '') => {
    const req = request(app.getHttpServer()).get(`/v1/owner/bookings${query}`);
    if (!user) return req;
    let address = visitors.get(user.id);
    if (!address) {
      address = `198.52.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
      visitors.set(user.id, address);
    }
    return req.set('Cookie', user.cookie).set('X-Forwarded-For', address);
  };
  const list = async (user: TestUser, query = ''): Promise<OwnerBookingList> =>
    OwnerBookingListSchema.parse((await call(user, query).expect(200)).body);
  const ids = (seen: OwnerBookingList) => seen.bookings.map((found) => found.id);

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
        name: `Λίστα ${name}`,
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
      // The listing is older than the stays: owners see the history from the day they joined.
      createdAt: inDays(-500),
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
    startsAt: Date,
    extra: Partial<typeof schema.bookings.$inferInsert> = {},
  ) => {
    const endsAt = new Date(startsAt.getTime() + 2 * 3_600_000);
    return {
      reference: newBookingReference(),
      userId: driver.id,
      locationId,
      spaceLabel: 'A1',
      listingLocale: 'el' as const,
      startsAt,
      endsAt,
      gapMinutes: 0,
      blockedUntil: endsAt,
      status: 'confirmed' as const,
      holdExpiresAt: startsAt,
      totalMinor: 400,
      currency: 'EUR',
      cancellationPolicy: 'oneDay' as const,
      commissionBps: 1000,
      vehiclePlate: 'IKB1234',
      confirmedAt: new Date(),
      ...extra,
    };
  };
  const cancelled = (by: 'driver' | 'owner' = 'driver') => ({
    status: 'cancelled' as const,
    cancelledAt: new Date(),
    cancelledBy: by,
    refundMinor: 400,
  });
  const insert = (...rows: ReturnType<typeof booking>[]) =>
    db.insert(schema.bookings).values(rows).returning({ id: schema.bookings.id });

  async function removeOurs() {
    const ours = await db
      .select({ id: schema.parkingLocations.id })
      .from(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    const found = ours.map((row) => row.id);
    if (found.length === 0) return;
    await db.delete(schema.bookings).where(inArray(schema.bookings.locationId, found));
    await db
      .delete(schema.listingManagers)
      .where(inArray(schema.listingManagers.locationId, found));
    await db.delete(schema.listingOwners).where(inArray(schema.listingOwners.locationId, found));
    await db.delete(schema.parkingLocations).where(inArray(schema.parkingLocations.id, found));
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
    await removeOurs();
  });

  afterAll(async () => {
    await removeOurs();
    const found = users.map((user) => user.id);
    if (found.length > 0) {
      await db.delete(schema.ownerProfiles).where(inArray(schema.ownerProfiles.userId, found));
      await db.delete(schema.users).where(inArray(schema.users.id, found));
    }
    await app.close();
  });

  it('needs an account', async () => {
    await call(null).expect(401);
  });

  it('refuses what is not a status, a listing, a day, a window or a place', async () => {
    const { user } = await owner();
    const place = `1700000000000_${randomUUID()}`;
    for (const query of [
      '?status=all',
      '?status=past&status=upcoming',
      '?listing=garage',
      '?from=yesterday',
      '?from=2026-02-30',
      '?to=9999-12-31',
      '?from=2026-11-02&to=2026-11-01',
      '?from=2025-01-01&to=2026-01-02',
      '?after=next',
      `?after=${place}&before=${place}`,
      '?after=253402300800000_5b1d3a52-3f0e-4a77-9a5b-9d4d2c4f6a10',
    ]) {
      const response = await call(user, query).expect(400);
      expect(response.body, query).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    await call(user, `?after=${place}`).expect(200);
    await call(user, '?status=cancelled&from=2025-11-17&to=2026-11-16').expect(200);
  });

  it('is empty for someone with no listing, and says which window it read', async () => {
    const nobody = await person();
    const seen = await list(nobody);
    expect(seen).toMatchObject({
      status: 'upcoming',
      listing: null,
      from: null,
      to: null,
      listings: [],
      bookings: [],
      previous: null,
      next: null,
    });
    const past = await list(nobody, '?status=past');
    expect(past.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(past.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await list(nobody, '?status=cancelled')).to).toBeNull();
  });

  it('lists what is coming, soonest first, across listings, and nothing that is not a stay', async () => {
    const driver = await person();
    const primary = await owner();
    const co = await owner();
    const stranger = await owner();
    const one = await listingOf('one', primary.profileId, co.profileId);
    const two = await listingOf('two', primary.profileId);
    const elsewhere = await listingOf('elsewhere', stranger.profileId);
    const [later, soon, other, underWay] = await insert(
      booking(driver, one, inDays(9)),
      booking(driver, one, inDays(3)),
      booking(driver, two, inDays(5), { spaceLabel: 'B2' }),
      // Began an hour ago and still on.
      booking(driver, two, new Date(Date.now() - 3_600_000)),
    );
    await insert(
      // Not coming: called off, ended, a hold nobody paid for, holds that lapsed or were let go.
      booking(driver, one, inDays(4), cancelled()),
      booking(driver, one, inDays(-2)),
      booking(driver, one, inDays(6), { status: 'held' }),
      booking(driver, one, inDays(7), { status: 'expired' }),
      booking(driver, one, inDays(8), { status: 'released' }),
      // Another owner's.
      booking(driver, elsewhere, inDays(2)),
    );

    // The co-owner is on listing one alone: its two coming stays, and none of the other listing's.
    expect(ids(await list(co.user))).toEqual([soon?.id, later?.id]);
    // The first is already on: it says so, and is the only one that does.
    const seen = await list(primary.user);
    expect(ids(seen)).toEqual([underWay?.id, soon?.id, other?.id, later?.id]);
    expect(seen.bookings.map((found) => found.state)).toEqual([
      'underWay',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(seen.bookings[2]).toMatchObject({
      id: other?.id,
      spaceLabel: 'B2',
      vehiclePlate: 'IKB1234',
      driverName: 'Test Driver',
      timeZone: 'Europe/Athens',
      total: { amountMinor: 400, currency: 'EUR' },
      cancelledBy: null,
      cancelledAt: null,
      listing: { id: two, name: 'Λίστα two', contentLocale: 'el' },
    });
    expect(seen.listings.map((found) => found.id).sort()).toEqual([one, two].sort());
    expect(seen.previous).toBeNull();
    expect(seen.next).toBeNull();
    // Never anyone's share or payout: the keys are the contract's.
    expect(Object.keys(seen.bookings[0] ?? {}).sort()).toEqual(
      [
        'canReportOverstay',
        'cancelledAt',
        'cancelledBy',
        'driverName',
        'end',
        'id',
        'listing',
        'overstay',
        'reference',
        'spaceLabel',
        'start',
        'state',
        'timeZone',
        'total',
        'vehiclePlate',
      ].sort(),
    );
    // A stranger sees none of these, and theirs is theirs alone.
    const theirs = await list(stranger.user);
    expect(theirs.bookings).toHaveLength(1);
    expect(theirs.listings.map((found) => found.id)).toEqual([elsewhere]);
  });

  it('lists what is over, latest first, for the last 90 days unless other days are asked for', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const id = await listingOf('past', profileId);
    const [yesterday, lastMonth, oldest, wayBack] = await insert(
      booking(driver, id, inDays(-1)),
      booking(driver, id, inDays(-30)),
      booking(driver, id, inDays(-80)),
      booking(driver, id, inDays(-200)),
    );
    // Over only by being called off, still to come, or not over yet: not here.
    await insert(booking(driver, id, inDays(-5), cancelled()), booking(driver, id, inDays(4)));

    const seen = await list(user, '?status=past');
    expect(ids(seen)).toEqual([yesterday?.id, lastMonth?.id, oldest?.id]);
    expect(seen.bookings.every((found) => found.state === 'ended')).toBe(true);
    // From a day 250 days back, a year at most: the oldest is there too.
    const from = inDays(-250).toISOString().slice(0, 10);
    const wider = await list(user, `?status=past&from=${from}`);
    expect(ids(wider)).toEqual([yesterday?.id, lastMonth?.id, oldest?.id, wayBack?.id]);
    expect(wider.from).toBe(from);
    // A single day.
    const day = inDays(-30).toISOString().slice(0, 10);
    expect(ids(await list(user, `?status=past&from=${day}&to=${day}`))).toEqual([lastMonth?.id]);
  });

  it('lists what was called off, with whose side did it, including stays that were still to come', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const id = await listingOf('cancelled', profileId);
    const [byDriver, byOwner, future] = await insert(
      booking(driver, id, inDays(-3), cancelled('driver')),
      booking(driver, id, inDays(-10), cancelled('owner')),
      booking(driver, id, inDays(20), cancelled('driver')),
    );
    await insert(booking(driver, id, inDays(-2)), booking(driver, id, inDays(-400), cancelled()));

    const seen = await list(user, '?status=cancelled');
    expect(ids(seen)).toEqual([future?.id, byDriver?.id, byOwner?.id]);
    expect(seen.bookings.map((found) => [found.state, found.cancelledBy])).toEqual([
      ['cancelled', 'driver'],
      ['cancelled', 'driver'],
      ['cancelled', 'owner'],
    ]);
    expect(seen.bookings.every((found) => found.cancelledAt !== null)).toBe(true);
    expect(seen.to).toBeNull();
  });

  it('pages in reading order and back, with nothing missed or repeated, both ways round', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const id = await listingOf('pages', profileId);
    const count = BOOKINGS_PAGE_SIZE + 5;
    const upcoming = await insert(
      ...Array.from({ length: count }, (_, index) => booking(driver, id, inDays(index + 1))),
    );
    const over = await insert(
      ...Array.from({ length: count }, (_, index) => booking(driver, id, inDays(-(index + 1)))),
    );

    for (const [status, expected] of [
      ['upcoming', upcoming.map((row) => row.id)],
      ['past', over.map((row) => row.id)],
    ] as const) {
      const first = await list(user, `?status=${status}`);
      expect(first.bookings).toHaveLength(BOOKINGS_PAGE_SIZE);
      expect(first.previous).toBeNull();
      expect(first.next).not.toBeNull();
      const second = await list(user, `?status=${status}&after=${first.next}`);
      expect(second.bookings).toHaveLength(count - BOOKINGS_PAGE_SIZE);
      expect(second.next).toBeNull();
      expect(second.previous).not.toBeNull();
      expect([...ids(first), ...ids(second)]).toEqual(expected);
      // Back from the second page is the first, as it was.
      const back = await list(user, `?status=${status}&before=${second.previous}`);
      expect(ids(back)).toEqual(ids(first));
      expect(back.previous).toBeNull();
      expect(back.next).toBe(first.next);
    }
  });

  it('shows one listing alone, and a listing that is not theirs as none', async () => {
    const driver = await person();
    const mine = await owner();
    const theirs = await owner();
    const a = await listingOf('a', mine.profileId);
    const b = await listingOf('b', mine.profileId);
    const c = await listingOf('c', theirs.profileId);
    const [inA, , inC] = await insert(
      booking(driver, a, inDays(2)),
      booking(driver, b, inDays(3)),
      booking(driver, c, inDays(4)),
    );

    const alone = await list(mine.user, `?listing=${a}`);
    expect(ids(alone)).toEqual([inA?.id]);
    expect(alone.listing).toBe(a);
    expect(alone.listings).toHaveLength(2);
    const notMine = await list(mine.user, `?listing=${c}`);
    expect(notMine.bookings).toEqual([]);
    expect(notMine.listing).toBeNull();
    expect(notMine.listings.map((found) => found.id)).not.toContain(c);
    expect(ids(await list(theirs.user, `?listing=${c}`))).toEqual([inC?.id]);
    // Not an id at all, or one that doesn't exist: the same as another's.
    expect((await list(mine.user, `?listing=${randomUUID()}`)).bookings).toEqual([]);
  });

  it('reads the days by the listing’s own clock, not UTC’s', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const id = await listingOf('athens', profileId);
    // 22:30 UTC is already the next day in Athens, winter (+2) or summer (+3).
    const evening = inDays(2, 22);
    evening.setUTCMinutes(30);
    const [found] = await insert(booking(driver, id, evening));
    const utcDay = evening.toISOString().slice(0, 10);
    const localDay = new Date(evening.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
    expect(localDay).not.toBe(utcDay);

    expect(ids(await list(user, `?from=${utcDay}&to=${utcDay}`))).toEqual([]);
    expect(ids(await list(user, `?from=${localDay}&to=${localDay}`))).toEqual([found?.id]);
    // The days' edges are inclusive, and a window can start or end on them.
    expect(ids(await list(user, `?from=${localDay}`))).toEqual([found?.id]);
    expect(ids(await list(user, `?to=${localDay}`))).toEqual([found?.id]);
    expect(ids(await list(user, `?from=${addDay(localDay)}`))).toEqual([]);
    expect(ids(await list(user, `?to=${utcDay}`))).toEqual([]);
  });

  it('shows a co-owner no stay that ended before they joined, the primary owner all of it', async () => {
    const driver = await person();
    const primary = await owner();
    const co = await owner();
    const id = await listingOf('joined', primary.profileId, co.profileId);
    await db
      .update(schema.listingOwners)
      .set({ createdAt: inDays(-60) })
      .where(eq(schema.listingOwners.ownerId, primary.profileId));
    await db
      .update(schema.listingOwners)
      .set({ createdAt: inDays(-20, 13) })
      .where(eq(schema.listingOwners.ownerId, co.profileId));
    const [before, during, after] = await insert(
      booking(driver, id, inDays(-30)),
      // Under way when they joined: theirs to see.
      booking(driver, id, inDays(-20, 12)),
      booking(driver, id, inDays(-10)),
    );
    const [calledOffBefore, calledOffAfter] = await insert(
      booking(driver, id, inDays(-25), cancelled()),
      booking(driver, id, inDays(-5), cancelled()),
    );

    expect(ids(await list(primary.user, '?status=past'))).toEqual([
      after?.id,
      during?.id,
      before?.id,
    ]);
    expect(ids(await list(co.user, '?status=past'))).toEqual([after?.id, during?.id]);
    expect(ids(await list(primary.user, '?status=cancelled'))).toEqual([
      calledOffAfter?.id,
      calledOffBefore?.id,
    ]);
    expect(ids(await list(co.user, '?status=cancelled'))).toEqual([calledOffAfter?.id]);
  });

  it('shows a manager the bookings of the listings they manage, and only those', async () => {
    const driver = await person();
    const primary = await owner();
    const manager = await person();
    const managed = await listingOf('managed', primary.profileId);
    const unmanaged = await listingOf('unmanaged', primary.profileId);
    await db.insert(schema.listingManagers).values({
      locationId: managed,
      userId: manager.id,
      createdAt: inDays(-30),
    });
    const [mine] = await insert(
      booking(driver, managed, inDays(2)),
      booking(driver, unmanaged, inDays(3)),
    );

    const seen = await list(manager);
    expect(ids(seen)).toEqual([mine?.id]);
    expect(seen.listings.map((found) => found.id)).toEqual([managed]);
    expect(ids(await list(manager, `?listing=${unmanaged}`))).toEqual([]);
  });

  it('shows a co-owner no booking called off before they joined, though its stay was after', async () => {
    const driver = await person();
    const primary = await owner();
    const co = await owner();
    const id = await listingOf('calledoff', primary.profileId, co.profileId);
    await db
      .update(schema.listingOwners)
      .set({ createdAt: inDays(-20, 13) })
      .where(eq(schema.listingOwners.ownerId, co.profileId));
    // A stay next month, called off 40 days ago (before they joined), and one called off 5 days ago.
    const [before, after] = await insert(
      booking(driver, id, inDays(25), { ...cancelled(), cancelledAt: inDays(-40) }),
      booking(driver, id, inDays(26), { ...cancelled(), cancelledAt: inDays(-5) }),
    );
    expect(ids(await list(primary.user, '?status=cancelled'))).toEqual([after?.id, before?.id]);
    expect(ids(await list(co.user, '?status=cancelled'))).toEqual([after?.id]);
  });

  it('shows a manager no stay that ended, or was called off, before they were added', async () => {
    const driver = await person();
    const primary = await owner();
    const manager = await person();
    const id = await listingOf('managedpast', primary.profileId);
    await db.insert(schema.listingManagers).values({
      locationId: id,
      userId: manager.id,
      createdAt: inDays(-20, 13),
    });
    const [before, during, after] = await insert(
      booking(driver, id, inDays(-30)),
      booking(driver, id, inDays(-20, 12)),
      booking(driver, id, inDays(-10)),
    );
    const [calledOffBefore, calledOffAfter] = await insert(
      booking(driver, id, inDays(-25), { ...cancelled(), cancelledAt: inDays(-25) }),
      booking(driver, id, inDays(-5), { ...cancelled(), cancelledAt: inDays(-5) }),
    );
    expect(ids(await list(primary.user, '?status=past'))).toEqual([
      after?.id,
      during?.id,
      before?.id,
    ]);
    expect(ids(await list(manager, '?status=past'))).toEqual([after?.id, during?.id]);
    expect(ids(await list(primary.user, '?status=cancelled'))).toEqual([
      calledOffAfter?.id,
      calledOffBefore?.id,
    ]);
    expect(ids(await list(manager, '?status=cancelled'))).toEqual([calledOffAfter?.id]);
    // Removed, they read nothing.
    await db.delete(schema.listingManagers).where(eq(schema.listingManagers.userId, manager.id));
    expect(ids(await list(manager, '?status=past'))).toEqual([]);
  });

  it('keeps a stay under way out of the past, and a long one begun 29 days ago among the coming', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const id = await listingOf('underway', profileId);
    const longStay = booking(driver, id, inDays(-29));
    longStay.endsAt = inDays(1);
    longStay.blockedUntil = inDays(1);
    const [onNow, long] = await insert(
      booking(driver, id, new Date(Date.now() - 3_600_000)),
      longStay,
    );
    expect(ids(await list(user))).toEqual([long?.id, onNow?.id]);
    expect(ids(await list(user, '?status=past'))).toEqual([]);
    expect((await list(user)).bookings.map((found) => found.state)).toEqual([
      'underWay',
      'underWay',
    ]);
  });

  it('pages through three pages and back to the middle one, which offers both ways', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const id = await listingOf('three', profileId);
    const count = BOOKINGS_PAGE_SIZE * 2 + 5;
    const rows = await insert(
      ...Array.from({ length: count }, (_, index) => booking(driver, id, inDays(index + 1))),
    );
    const first = await list(user);
    const second = await list(user, `?after=${first.next}`);
    const third = await list(user, `?after=${second.next}`);
    expect([...ids(first), ...ids(second), ...ids(third)]).toEqual(rows.map((row) => row.id));
    expect(third.next).toBeNull();
    expect(second.previous).not.toBeNull();
    expect(second.next).not.toBeNull();
    // Back from the third is the second, as it was, with both places; back again is the first.
    const backToSecond = await list(user, `?before=${third.previous}`);
    expect(ids(backToSecond)).toEqual(ids(second));
    expect(backToSecond.previous).toBe(second.previous);
    expect(backToSecond.next).toBe(second.next);
    const backToFirst = await list(user, `?before=${backToSecond.previous}`);
    expect(ids(backToFirst)).toEqual(ids(first));
    expect(backToFirst.previous).toBeNull();
  });

  it('pages stays that start at the same instant, on two listings, with nothing missed or repeated', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const one = await listingOf('tie-a', profileId);
    const two = await listingOf('tie-b', profileId);
    const count = BOOKINGS_PAGE_SIZE + 6;
    for (const [status, at] of [
      ['upcoming', inDays(7)],
      ['past', inDays(-7)],
    ] as const) {
      const rows = await insert(
        ...Array.from({ length: count }, (_, index) =>
          booking(driver, index % 2 === 0 ? one : two, at),
        ),
      );
      const first = await list(user, `?status=${status}`);
      const second = await list(user, `?status=${status}&after=${first.next}`);
      const seen = [...ids(first), ...ids(second)];
      expect(new Set(seen).size).toBe(count);
      expect([...seen].sort()).toEqual(rows.map((row) => row.id).sort());
      // And back: the first page as it was.
      const back = await list(user, `?status=${status}&before=${second.previous}`);
      expect(ids(back)).toEqual(ids(first));
    }
  });

  it('pages within one listing and a window of days', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const a = await listingOf('window-a', profileId);
    const b = await listingOf('window-b', profileId);
    const count = BOOKINGS_PAGE_SIZE + 3;
    const inA = await insert(
      ...Array.from({ length: count }, (_, index) => booking(driver, a, inDays(-(index % 20) - 2))),
    );
    await insert(
      ...Array.from({ length: 5 }, (_, index) => booking(driver, b, inDays(-index - 2))),
    );
    const from = inDays(-30).toISOString().slice(0, 10);
    const to = inDays(-1).toISOString().slice(0, 10);
    const query = `?status=past&listing=${a}&from=${from}&to=${to}`;
    const first = await list(user, query);
    const second = await list(user, `${query}&after=${first.next}`);
    expect([...ids(first), ...ids(second)].sort()).toEqual(inA.map((row) => row.id).sort());
    expect(second.next).toBeNull();
    expect(first.listing).toBe(a);
  });

  it('offers no way back from a place with nothing of this group behind it, and pages on from a place whose booking is gone', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const id = await listingOf('probe', profileId);
    // Other groups sit behind the first coming stay, and must not count as a page behind.
    const [soon, later, last] = await insert(
      booking(driver, id, inDays(3)),
      booking(driver, id, inDays(4)),
      booking(driver, id, inDays(5)),
    );
    await insert(booking(driver, id, inDays(-3)), booking(driver, id, inDays(-4), cancelled()));
    const place = (row: { id?: string } | undefined, days: number) =>
      `${inDays(days).getTime()}_${row?.id}`;
    const fromSoon = await list(user, `?after=${place(soon, 3)}`);
    expect(ids(fromSoon)).toEqual([later?.id, last?.id]);
    // The place itself counts as behind: the booking it names is on the page before.
    expect(fromSoon.previous).not.toBeNull();
    const fromFirst = await list(user, `?before=${place(soon, 3)}`);
    expect(ids(fromFirst)).toEqual([]);
    expect(fromFirst.previous).toBeNull();
    // The booking the place names was called off meanwhile: the list still goes on from there.
    await db
      .update(schema.bookings)
      .set(cancelled())
      .where(eq(schema.bookings.id, soon?.id ?? ''));
    expect(ids(await list(user, `?after=${place(soon, 3)}`))).toEqual([later?.id, last?.id]);
  });

  it('answers a first day still to come, for past stays, with none and no error', async () => {
    const { user } = await owner();
    const from = inDays(30).toISOString().slice(0, 10);
    const seen = await list(user, `?status=past&from=${from}`);
    expect(seen.bookings).toEqual([]);
    expect(seen.from).toBe(from);
  });

  it('refuses days past what the calendar reaches', async () => {
    const { user } = await owner();
    for (const query of ['?from=2000-01-01', '?to=2100-12-31', '?status=past&from=2019-05-01']) {
      await call(user, query).expect(400);
    }
  });

  it('merges the first pages of many listings in one order, with nothing lost at a page’s edge', async () => {
    const driver = await person();
    const { user, profileId } = await owner();
    const garages = await Promise.all(
      Array.from({ length: 12 }, (_, index) => listingOf(`many-${index}`, profileId)),
    );
    // Four stays a garage, a day apart, each garage an hour after the last: every garage has more
    // than a page's worth before the first page ends, and the garages interleave.
    const expected: string[] = [];
    const rows = await insert(
      ...garages.flatMap((garage, g) =>
        Array.from({ length: 4 }, (_, d) =>
          booking(driver, garage, new Date(inDays(d + 1, 6).getTime() + g * 3_600_000)),
        ),
      ),
    );
    const order = await db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(
        inArray(
          schema.bookings.id,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(schema.bookings.startsAt, schema.bookings.id);
    expected.push(...order.map((row) => row.id));
    const seen: string[] = [];
    let next: string | null = null;
    for (let pages = 0; pages < 5; pages++) {
      const page: OwnerBookingList = await list(user, next ? `?after=${next}` : '');
      seen.push(...ids(page));
      next = page.next;
      if (!next) break;
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(48);
  });
});
