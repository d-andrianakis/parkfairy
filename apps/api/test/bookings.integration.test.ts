import { randomUUID } from 'node:crypto';
import {
  addDays,
  BOOKING_REFERENCE_PATTERN,
  BookingListSchema,
  BookingSchema,
  BOOKINGS_PAGE_SIZE,
  DEFAULT_TIME_ZONE,
  LISTING_SPACES_LIMIT,
  isoWeekday,
  OwnerHoursCopySchema,
  OwnerHoursExceptionsCopySchema,
  OwnerListingBookingsSchema,
  ParkingListingDetailSchema,
  ParkingSearchResponseSchema,
  zonedParts,
  zonedTimeToUtc,
  type Booking,
  type CancellationPolicy,
  type ListingStatus,
} from '@parkfairy/contracts';
import { expireLapsedHolds, schema, type Database } from '@parkfairy/database';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newBookingReference } from '../src/bookings/booking-reference.js';
import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, type TestApp, type TestUser } from './test-app.js';

// Agios Nikolaos: far from the demo areas and every other suite's point, so searches meet only these.
const HERE = { latitude: 35.1913, longitude: 25.7164 };
const PREFIX = 'it-booking-';
const tag = randomUUID().slice(0, 8);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
const WEEK = [1, 2, 3, 4, 5, 6, 7];
const zone = DEFAULT_TIME_ZONE;

const today = zonedParts(new Date(), zone).date;
let nextOffset = 5;
/** A day of its own for each test, a few days out, so no two tests' stays meet. */
const freshDay = () => addDays(today, nextOffset++);
const at = (day: string, time: string) => zonedTimeToUtc(day, time, zone)?.toISOString() ?? '';
const stayOn = (day: string, from = '10:00', to = '12:00') => ({
  start: at(day, from),
  end: at(day, to),
});

/**
 * The next last Sunday of `month` (1-based) from tomorrow on, when the clocks change in Athens, or
 * null when that is past the 365 days a stay may start ahead: in the days after a change, the next
 * one is a year and a few days away.
 */
function nextLastSunday(month: number): string | null {
  for (let year = Number(today.slice(0, 4)); ; year++) {
    let day = `${year}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
    while (isoWeekday(day) !== 7) day = addDays(day, -1);
    if (day > today) return day <= addDays(today, 364) ? day : null;
  }
}
const spring = nextLastSunday(3);
const autumn = nextLastSunday(10);

const visitors = new Map<string, string>();
function visitorOf({ id }: TestUser): string {
  const known = visitors.get(id);
  if (known) return known;
  const address = `198.19.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
  visitors.set(id, address);
  return address;
}

interface Fixture {
  id: string;
  slug: string;
  space: Record<string, string>;
}

describe('bookings', () => {
  let app: TestApp;
  let db: Database;
  let owner: TestUser;
  let ownerProfileId: string;
  let garage: Fixture;
  const users: TestUser[] = [];

  const api = (
    user: TestUser | null,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
  ) => {
    const call = request(app.getHttpServer())[method](`/v1${path}`);
    if (method !== 'get') call.set('Origin', ORIGIN);
    return user ? call.set('Cookie', user.cookie).set('X-Forwarded-For', visitorOf(user)) : call;
  };

  /** A driver of their own: holds have a limit per visitor, and one hold at a time each. */
  async function driver(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }

  const hold = (
    user: TestUser,
    listing: Fixture,
    label: string,
    stay: { start: string; end: string },
  ) =>
    api(user, 'post', '/bookings').send({
      listing: listing.slug,
      spaceId: listing.space[label],
      ...stay,
    });
  const confirm = (user: TestUser, id: string, vehiclePlate = 'ΙΚΒ-1234') =>
    api(user, 'post', `/bookings/${id}/confirm`).send({ vehiclePlate });
  const cancel = (user: TestUser, id: string) => api(user, 'post', `/bookings/${id}/cancel`);
  const closeOn = (listing: Fixture, days: string[]) =>
    api(owner, 'put', `/owner/listings/${listing.id}/hours-exceptions`).send({
      exceptions: days.map((day) => ({
        label: 'Κλειστά',
        startsOn: day,
        endsOn: day,
        hours: null,
        closedHours: null,
      })),
    });

  async function booked(
    user: TestUser,
    listing: Fixture,
    label: string,
    stay: { start: string; end: string },
  ): Promise<Booking> {
    const held = BookingSchema.parse((await hold(user, listing, label, stay).expect(201)).body);
    return BookingSchema.parse((await confirm(user, held.id).expect(200)).body);
  }

  async function addListing(
    name: string,
    options: {
      hours?: [number, number];
      spaces?: { label: string; rate?: number }[];
      gap?: 0 | 30 | 60;
      policy?: CancellationPolicy;
      status?: ListingStatus;
    } = {},
  ): Promise<Fixture> {
    const slug = `${PREFIX}${tag}-${name}`;
    const [row] = await db
      .insert(schema.parkingLocations)
      .values({
        ownerId: ownerProfileId,
        slug,
        name: `Κράτηση ${name}`,
        address: 'Οδός Δοκιμής 2, Άγιος Νικόλαος',
        areaId: 'syntagma',
        location: HERE,
        hourlyRateMinor: 200,
        bookingGapMinutes: options.gap ?? 30,
        cancellationPolicy: options.policy ?? 'oneDay',
        status: options.status ?? 'published',
      })
      .returning({ id: schema.parkingLocations.id });
    const id = row?.id ?? '';
    const spaces = await db
      .insert(schema.parkingSpaces)
      .values(
        (options.spaces ?? [{ label: 'A1' }]).map(({ label, rate }) => ({
          locationId: id,
          label,
          hourlyRateMinor: rate ?? null,
        })),
      )
      .returning({ id: schema.parkingSpaces.id, label: schema.parkingSpaces.label });
    const [opensMinute, closesMinute] = options.hours ?? [0, 1440];
    await db
      .insert(schema.parkingOpeningHours)
      .values(WEEK.map((weekday) => ({ locationId: id, weekday, opensMinute, closesMinute })));
    return { id, slug, space: Object.fromEntries(spaces.map((s) => [s.label, s.id])) };
  }

  async function removeOurs() {
    const ours = await db
      .select({ id: schema.parkingLocations.id })
      .from(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    const ids = ours.map((row) => row.id);
    if (ids.length === 0) return;
    await db.delete(schema.bookings).where(inArray(schema.bookings.locationId, ids));
    await db.delete(schema.parkingLocations).where(inArray(schema.parkingLocations.id, ids));
  }

  const row = async (id: string) => {
    const [found] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    if (!found) throw new Error('No booking');
    return found;
  };
  const emailsAbout = (id: string) =>
    db
      .select({ kind: schema.emailOutbox.kind, userId: schema.emailOutbox.userId })
      .from(schema.emailOutbox)
      .where(sql`${schema.emailOutbox.payload} -> 'booking' ->> 'id' = ${id}`);

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
    // Leftovers from a run that crashed would meet this one's searches.
    await removeOurs();
    owner = await signUpUser(app);
    users.push(owner);
    const [profile] = await db
      .insert(schema.ownerProfiles)
      .values({ userId: owner.id })
      .returning({ id: schema.ownerProfiles.id });
    ownerProfileId = profile?.id ?? '';
    garage = await addListing('garage', {
      spaces: [{ label: 'A1' }, { label: 'A2', rate: 400 }, { label: 'B1' }],
    });
  });

  afterAll(async () => {
    await removeOurs();
    await db.delete(schema.emailOutbox).where(
      inArray(
        schema.emailOutbox.userId,
        users.map((user) => user.id),
      ),
    );
    await app.close();
  });

  describe('who can reach what', () => {
    it.each([
      ['post', '/bookings'],
      ['get', '/bookings'],
      ['get', `/bookings/${randomUUID()}`],
      ['post', `/bookings/${randomUUID()}/confirm`],
      ['post', `/bookings/${randomUUID()}/cancel`],
      ['post', `/bookings/${randomUUID()}/extend`],
      ['get', `/owner/listings/${randomUUID()}/bookings`],
      ['post', `/owner/listings/${randomUUID()}/bookings/${randomUUID()}/cancel`],
    ] as const)('needs an account for %s %s (decision #8)', async (method, path) => {
      const response = await api(null, method, path).send({}).expect(401);
      expect(response.body).toMatchObject({ statusCode: 401 });
    });

    it("keeps one driver's booking from another, as if it didn't exist", async () => {
      const [mine, theirs] = [await driver(), await driver()];
      const held = BookingSchema.parse(
        (await hold(mine, garage, 'B1', stayOn(freshDay())).expect(201)).body,
      );
      // Built one at a time: supertest closes its server after each request.
      for (const call of [
        () => api(theirs, 'get', `/bookings/${held.id}`),
        () => confirm(theirs, held.id),
        () => cancel(theirs, held.id),
        () => api(theirs, 'post', `/bookings/${held.id}/extend`),
        () => api(theirs, 'get', '/bookings/not-a-uuid'),
      ]) {
        expect((await call().expect(404)).body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      }
      const response = await api(theirs, 'get', '/bookings').expect(200);
      expect(BookingListSchema.parse(response.body).bookings).toEqual([]);
      expect((await row(held.id)).status).toBe('held');
    });

    it("shows a listing's bookings to its owner only", async () => {
      const stranger = await driver();
      for (const call of [
        () => api(stranger, 'get', `/owner/listings/${garage.id}/bookings`),
        () => api(stranger, 'post', `/owner/listings/${garage.id}/bookings/${randomUUID()}/cancel`),
        () => api(owner, 'get', `/owner/listings/${randomUUID()}/bookings`),
        () => api(owner, 'get', '/owner/listings/nope/bookings'),
      ]) {
        expect((await call().expect(404)).body).toMatchObject({ code: 'LISTING_NOT_FOUND' });
      }
    });

    it("refuses a booking of the owner's own listing", async () => {
      const response = await hold(owner, garage, 'A1', stayOn(freshDay())).expect(409);
      expect(response.body).toMatchObject({ code: 'OWN_LISTING' });
    });

    it('refuses client-chosen owners, statuses and prices', async () => {
      const user = await driver();
      const response = await api(user, 'post', '/bookings')
        .send({
          listing: garage.slug,
          spaceId: garage.space.A1,
          ...stayOn(freshDay()),
          userId: owner.id,
          totalMinor: 1,
        })
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('holding a space', () => {
    it('keeps the space for ten minutes at the price of that space', async () => {
      const user = await driver();
      const stay = stayOn(freshDay());
      const before = Date.now();
      const response = await hold(user, garage, 'A2', stay).expect(201);
      const held = BookingSchema.parse(response.body);
      expect(held).toMatchObject({
        status: 'held',
        spaceLabel: 'A2',
        start: stay.start,
        end: stay.end,
        // Two hours at the space's own €4.00.
        total: { amountMinor: 800, currency: 'EUR' },
        cancellationPolicy: 'oneDay',
        vehiclePlate: null,
        refund: null,
        refundIfCancelled: null,
        listing: { slug: garage.slug, name: 'Κράτηση garage', contentLocale: 'el' },
      });
      expect(held.reference).toMatch(BOOKING_REFERENCE_PATTERN);
      const expires = Date.parse(held.holdExpiresAt) - before;
      expect(expires).toBeGreaterThan(9 * 60_000);
      expect(expires).toBeLessThanOrEqual(10 * 60_000 + 5_000);
      // The gap after the stay is kept too (decision #10).
      expect((await row(held.id)).blockedUntil.toISOString()).toBe(
        new Date(Date.parse(stay.end) + 30 * 60_000).toISOString(),
      );
    });

    it('takes the space from search and the listing page, gap included', async () => {
      const day = freshDay();
      const user = await driver();
      const listing = await addListing('lone', { spaces: [{ label: 'L1' }, { label: 'L2' }] });
      await hold(user, listing, 'L1', stayOn(day, '10:00', '12:00')).expect(201);

      const page = async (from: string, to: string) =>
        ParkingListingDetailSchema.parse(
          (
            await api(null, 'get', `/parking/${listing.slug}`)
              .query(stayOn(day, from, to))
              .expect(200)
          ).body,
        );
      const during = await page('11:00', '13:00');
      expect(during.availability?.freeSpaces).toBe(1);
      expect(during.spaces.map((s) => s.label)).toEqual(['L2']);
      expect(during.spaceCount).toBe(2);
      // 12:00 is inside the 30 minutes kept after the stay; 12:30 is not.
      expect((await page('12:00', '13:00')).availability?.freeSpaces).toBe(1);
      expect((await page('12:30', '13:00')).availability?.freeSpaces).toBe(2);
      // Ending as the stay starts is fine, if the gap after it doesn't reach the stay.
      expect((await page('08:00', '09:30')).availability?.freeSpaces).toBe(2);
      expect((await page('08:00', '10:00')).availability?.freeSpaces).toBe(1);

      const search = async () =>
        ParkingSearchResponseSchema.parse(
          (
            await api(null, 'get', '/parking/search')
              .query({ ...HERE, ...stayOn(day, '10:30', '11:30') })
              .expect(200)
          ).body,
        ).results.find((result) => result.slug === listing.slug);
      expect((await search())?.freeSpaces).toBe(1);
      await hold(await driver(), listing, 'L2', stayOn(day, '11:00', '12:00')).expect(201);
      // Nothing free: the listing leaves the results.
      expect(await search()).toBeUndefined();
    });

    it('tells the second driver the space was just taken (decision #9)', async () => {
      const day = freshDay();
      const first = await driver();
      await hold(first, garage, 'A1', stayOn(day, '10:00', '12:00')).expect(201);
      for (const [from, to] of [
        ['10:00', '12:00'],
        ['11:30', '13:00'],
        ['09:00', '10:30'],
        // Within the 30 minutes after the first stay.
        ['12:00', '12:30'],
      ] as const) {
        const response = await hold(await driver(), garage, 'A1', stayOn(day, from, to));
        expect(response.status, `${from}–${to}`).toBe(409);
        expect(response.body).toMatchObject({ code: 'SPACE_TAKEN' });
      }
      await hold(await driver(), garage, 'A1', stayOn(day, '12:30', '13:00')).expect(201);
      // Another space at the same time is free.
      await hold(await driver(), garage, 'B1', stayOn(day, '10:00', '12:00')).expect(201);
    });

    it('lets exactly one of two drivers have a space they press for at once', async () => {
      // Several pairs per round: two requests alone rarely interleave (memory.md).
      const days = [freshDay(), freshDay(), freshDay()];
      const drivers = await Promise.all(days.flatMap(() => [driver(), driver()]));
      const responses = await Promise.all(
        days.flatMap((day, index) => [
          hold(drivers[index * 2] as TestUser, garage, 'A1', stayOn(day)),
          hold(drivers[index * 2 + 1] as TestUser, garage, 'A1', stayOn(day)),
        ]),
      );
      days.forEach((day, index) => {
        const pair = [responses[index * 2], responses[index * 2 + 1]].map((r) => r?.status);
        expect(pair.sort(), day).toEqual([201, 409]);
      });
      const taken = await db
        .select({ id: schema.bookings.id })
        .from(schema.bookings)
        .where(
          and(
            eq(schema.bookings.spaceId, garage.space.A1 ?? ''),
            inArray(
              schema.bookings.startsAt,
              days.map((day) => new Date(stayOn(day).start)),
            ),
          ),
        );
      expect(taken).toHaveLength(days.length);
    });

    it('gives a driver one hold at a time', async () => {
      const user = await driver();
      const day = freshDay();
      const first = BookingSchema.parse(
        (await hold(user, garage, 'A1', stayOn(day)).expect(201)).body,
      );
      // Pressing Book again takes the same space again, letting the first hold go.
      const again = BookingSchema.parse(
        (await hold(user, garage, 'A1', stayOn(day)).expect(201)).body,
      );
      const other = BookingSchema.parse(
        (await hold(user, garage, 'B1', stayOn(day)).expect(201)).body,
      );
      expect((await row(first.id)).status).toBe('released');
      expect((await row(again.id)).status).toBe('released');
      expect((await row(other.id)).status).toBe('held');
      expect((await confirm(user, first.id).expect(409)).body).toMatchObject({
        code: 'BOOKING_NOT_ACTIVE',
      });
      // The space it let go is free for someone else.
      await hold(await driver(), garage, 'A1', stayOn(day)).expect(201);
    });

    it('keeps one hold per driver when two presses come at once', async () => {
      // Several drivers at once (memory.md): each presses for two spaces in the same instant.
      const day = freshDay();
      const listing = await addListing('two-presses', {
        spaces: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((label) => ({ label })),
      });
      const drivers = await Promise.all([driver(), driver(), driver()]);
      const answers = await Promise.all(
        drivers.flatMap((user, n) => [
          hold(user, listing, `P${n * 2 + 1}`, stayOn(day)),
          hold(user, listing, `P${n * 2 + 2}`, stayOn(day)),
        ]),
      );
      // Both presses answer (the later lets the earlier go), and one hold stands each.
      expect(answers.map((answer) => answer.status)).toEqual([201, 201, 201, 201, 201, 201]);
      for (const user of drivers) {
        const held = await db
          .select({ id: schema.bookings.id })
          .from(schema.bookings)
          .where(and(eq(schema.bookings.userId, user.id), eq(schema.bookings.status, 'held')));
        expect(held).toHaveLength(1);
      }
    });

    it('holds ten times a minute per visitor at most', async () => {
      const user = await driver();
      const day = freshDay();
      for (let n = 0; n < 10; n++) await hold(user, garage, 'B1', stayOn(day)).expect(201);
      await hold(user, garage, 'B1', stayOn(day)).expect(429);
    });

    it('lets a lapsed hold go to the next driver', async () => {
      const day = freshDay();
      const slow = await driver();
      const lapsed = BookingSchema.parse(
        (await hold(slow, garage, 'A1', stayOn(day)).expect(201)).body,
      );
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.bookings.id, lapsed.id));
      await hold(await driver(), garage, 'A1', stayOn(day)).expect(201);
      expect((await row(lapsed.id)).status).toBe('expired');
      // Too late now: the hold has ended, and someone else has the space (decision #37).
      expect((await confirm(slow, lapsed.id).expect(409)).body).toMatchObject({
        code: 'BOOKING_NOT_ACTIVE',
      });
    });

    it('refuses closed hours, unknown spaces and listings not live', async () => {
      const user = await driver();
      const day = freshDay();
      const daytime = await addListing('daytime', { hours: [8 * 60, 20 * 60] });
      const draft = await addListing('draft', { status: 'draft' });
      expect(
        (await hold(user, daytime, 'A1', stayOn(day, '19:00', '21:00')).expect(409)).body,
      ).toMatchObject({ code: 'LISTING_CLOSED' });
      await closeOn(daytime, [day]).expect(200);
      expect(
        (await hold(user, daytime, 'A1', stayOn(day, '10:00', '11:00')).expect(409)).body,
      ).toMatchObject({ code: 'LISTING_CLOSED' });

      const elsewhere = { ...garage, space: { A1: daytime.space.A1 ?? '' } };
      for (const call of [
        () => hold(user, { ...garage, space: { A1: randomUUID() } }, 'A1', stayOn(day)),
        () => hold(user, elsewhere, 'A1', stayOn(day)),
      ]) {
        expect((await call().expect(404)).body).toMatchObject({ code: 'SPACE_NOT_FOUND' });
      }
      for (const call of [
        () => hold(user, draft, 'A1', stayOn(day)),
        () => hold(user, { ...garage, slug: `${PREFIX}${tag}-nowhere` }, 'A1', stayOn(day)),
      ]) {
        expect((await call().expect(404)).body).toMatchObject({ code: 'LISTING_NOT_FOUND' });
      }
    });

    it.skipIf(!spring)(
      'prices a stay over the spring change by the time it lasts (#7)',
      async () => {
        const listing = await addListing('dst-spring', { gap: 0 });
        const springStay = await hold(
          await driver(),
          listing,
          'A1',
          stayOn(spring ?? '', '02:00', '05:00'),
        ).expect(201);
        // 02:00 to 05:00 on the wall clock, but 03:00 never happens: two hours.
        expect(BookingSchema.parse(springStay.body).total.amountMinor).toBe(400);
      },
    );

    it.skipIf(!autumn)('prices a stay over the autumn change by the time it lasts', async () => {
      const listing = await addListing('dst-autumn', { gap: 0 });
      const autumnStay = await hold(
        await driver(),
        listing,
        'A1',
        stayOn(autumn ?? '', '02:00', '05:00'),
      ).expect(201);
      // 03:00 to 04:00 happens twice: four hours.
      expect(BookingSchema.parse(autumnStay.body).total.amountMinor).toBe(800);
      // The constraint works on instants: the next stay starts as that one ends, no overlap.
      const after = stayOn(autumn ?? '', '05:00', '06:00');
      await hold(await driver(), listing, 'A1', after).expect(201);
      const across = stayOn(autumn ?? '', '04:30', '05:30');
      expect((await hold(await driver(), listing, 'A1', across).expect(409)).body).toMatchObject({
        code: 'SPACE_TAKEN',
      });
    });
  });

  describe('confirming', () => {
    it('books the space with the car, emails both sides once, and answers again the same', async () => {
      const user = await driver();
      const held = BookingSchema.parse(
        (await hold(user, garage, 'A1', stayOn(freshDay())).expect(201)).body,
      );
      const response = await confirm(user, held.id, ' ικβ-1234 ').expect(200);
      const booking = BookingSchema.parse(response.body);
      expect(booking).toMatchObject({
        status: 'confirmed',
        vehiclePlate: 'IKB1234',
        reference: held.reference,
        total: held.total,
        // Days ahead, under "full refund until 24 hours before".
        refundIfCancelled: held.total,
      });
      expect(booking.confirmedAt).not.toBeNull();
      expect(BookingSchema.parse((await confirm(user, held.id).expect(200)).body)).toEqual(booking);
      const emails = await emailsAbout(held.id);
      expect(emails.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
        { kind: 'booking-confirmed', userId: user.id },
        { kind: 'booking-received', userId: owner.id },
      ]);
    });

    it('asks for a plate it can read', async () => {
      const user = await driver();
      const held = BookingSchema.parse(
        (await hold(user, garage, 'B1', stayOn(freshDay())).expect(201)).body,
      );
      for (const [plate, key] of [
        ['', 'plateRequired'],
        ['ΔΛΦ-1', 'plateInvalid'],
      ] as const) {
        const response = await confirm(user, held.id, plate).expect(400);
        expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', message: [key] });
      }
      expect((await row(held.id)).status).toBe('held');
    });

    it('books nothing once the hold ran out, though the space is free (decision #37)', async () => {
      const user = await driver();
      const listing = await addListing('sweep', { spaces: [{ label: 'W1' }, { label: 'W2' }] });
      const day = freshDay();
      const held = BookingSchema.parse(
        (await hold(user, listing, 'W1', stayOn(day)).expect(201)).body,
      );
      // Beside it, a booking and a hold still running: the sweep must leave both alone.
      const kept = await booked(await driver(), listing, 'W2', stayOn(day, '13:00', '14:00'));
      const running = BookingSchema.parse(
        (await hold(await driver(), listing, 'W2', stayOn(day, '15:00', '16:00')).expect(201)).body,
      );
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.bookings.id, held.id));
      expect(await expireLapsedHolds(db, new Date())).toBeGreaterThanOrEqual(1);
      expect((await row(held.id)).status).toBe('expired');
      expect((await row(kept.id)).status).toBe('confirmed');
      expect((await row(running.id)).status).toBe('held');
      expect((await confirm(user, held.id).expect(409)).body).toMatchObject({
        code: 'BOOKING_NOT_ACTIVE',
      });
      // Nor before the sweep: a minute past its time, still `held`, is past it.
      const other = await driver();
      const unswept = BookingSchema.parse(
        (await hold(other, listing, 'W1', stayOn(day, '18:00', '19:00')).expect(201)).body,
      );
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.bookings.id, unswept.id));
      expect((await confirm(other, unswept.id).expect(409)).body).toMatchObject({
        code: 'BOOKING_NOT_ACTIVE',
      });
    });

    it('keeps a running hold for ten more minutes at a press, ten times (WCAG 2.2.1)', async () => {
      const user = await driver();
      const held = BookingSchema.parse(
        (await hold(user, garage, 'B1', stayOn(freshDay())).expect(201)).body,
      );
      expect(held.holdExtensionsLeft).toBe(10);
      // Nearly out of time: kept from now, not from the old end.
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: new Date(Date.now() + 30_000) })
        .where(eq(schema.bookings.id, held.id));
      const before = Date.now();
      const kept = BookingSchema.parse(
        (await api(user, 'post', `/bookings/${held.id}/extend`).expect(200)).body,
      );
      expect(kept.holdExtensionsLeft).toBe(9);
      expect(Date.parse(kept.holdExpiresAt) - before).toBeGreaterThan(9 * 60_000);
      // As often as the limit allows, then no more; confirming still works.
      await db
        .update(schema.bookings)
        .set({ holdExtensions: 10 })
        .where(eq(schema.bookings.id, held.id));
      expect(
        (await api(user, 'post', `/bookings/${held.id}/extend`).expect(409)).body,
      ).toMatchObject({ code: 'HOLD_LIMIT_REACHED' });
      await confirm(user, held.id).expect(200);
    });

    it('can’t keep a hold that has run out', async () => {
      const user = await driver();
      const held = BookingSchema.parse(
        (await hold(user, garage, 'B1', stayOn(freshDay())).expect(201)).body,
      );
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.bookings.id, held.id));
      expect(
        (await api(user, 'post', `/bookings/${held.id}/extend`).expect(409)).body,
      ).toMatchObject({ code: 'BOOKING_NOT_ACTIVE' });
    });

    it('refuses a confirmation once the space was taken out of use', async () => {
      const listing = await addListing('withdrawn');
      const user = await driver();
      const held = BookingSchema.parse(
        (await hold(user, listing, 'A1', stayOn(freshDay())).expect(201)).body,
      );
      await db
        .update(schema.parkingSpaces)
        .set({ isActive: false })
        .where(eq(schema.parkingSpaces.id, listing.space.A1 ?? ''));
      expect((await confirm(user, held.id).expect(409)).body).toMatchObject({
        code: 'SPACE_TAKEN',
      });
    });

    it('refuses once the owner has closed that time since the hold', async () => {
      const day = freshDay();
      const listing = await addListing('closing');
      const user = await driver();
      const held = BookingSchema.parse(
        (await hold(user, listing, 'A1', stayOn(day)).expect(201)).body,
      );
      // A hold isn't a booking: the owner may still close the day (decision #27 is about bookings).
      await closeOn(listing, [day]).expect(200);
      expect((await confirm(user, held.id).expect(409)).body).toMatchObject({
        code: 'LISTING_CLOSED',
      });
      // Refused, nothing was booked, so nobody is emailed.
      expect(await emailsAbout(held.id)).toEqual([]);
    });

    it('never lets a closure and a confirmation both through at once', async () => {
      // Without the listing's lock, both pass their checks: a booking on a closed day.
      const pairs = await Promise.all(
        [1, 2, 3].map(async (n) => {
          const day = freshDay();
          const listing = await addListing(`race-${n}`);
          const user = await driver();
          const held = BookingSchema.parse(
            (await hold(user, listing, 'A1', stayOn(day)).expect(201)).body,
          );
          return { day, listing, user, held };
        }),
      );
      const outcomes = await Promise.all(
        pairs.map(async ({ day, listing, user, held }) => {
          const [confirmed, closed] = await Promise.all([
            confirm(user, held.id),
            closeOn(listing, [day]),
          ]);
          return [confirmed.status, closed.status];
        }),
      );
      for (const [confirmed, closed] of outcomes) {
        expect([
          [200, 409],
          [409, 200],
        ]).toContainEqual([confirmed, closed]);
      }
    });
  });

  describe('cancelling', () => {
    it('refunds the driver by the policy booked with, and tells the owner', async () => {
      const user = await driver();
      const booking = await booked(user, garage, 'A2', stayOn(freshDay()));
      const response = await cancel(user, booking.id).expect(200);
      expect(BookingSchema.parse(response.body)).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'driver',
        refund: { amountMinor: 800, currency: 'EUR' },
        refundIfCancelled: null,
      });
      expect(BookingSchema.parse((await cancel(user, booking.id).expect(200)).body).status).toBe(
        'cancelled',
      );
      expect((await emailsAbout(booking.id)).map((email) => email.kind).sort()).toEqual([
        'booking-cancelled',
        'booking-cancelled-by-driver',
        'booking-confirmed',
        'booking-received',
      ]);
      // The space is free again.
      await hold(await driver(), garage, 'A2', {
        start: booking.start,
        end: booking.end,
      }).expect(201);
    });

    it('gives half back within the last day under that policy', async () => {
      const listing = await addListing('half', { policy: 'oneDayThenHalf', gap: 0 });
      const soon = new Date(Math.ceil((Date.now() + 3 * 3_600_000) / 1_800_000) * 1_800_000);
      const stay = {
        start: soon.toISOString(),
        end: new Date(soon.getTime() + 90 * 60_000).toISOString(),
      };
      const user = await driver();
      const booking = await booked(user, listing, 'A1', stay);
      // An hour and a half at €2.00.
      expect(booking.total.amountMinor).toBe(300);
      expect(booking.refundIfCancelled?.amountMinor).toBe(150);
      const cancelled = BookingSchema.parse((await cancel(user, booking.id).expect(200)).body);
      expect(cancelled.refund?.amountMinor).toBe(150);
    });

    it('refuses to give back less than the driver was shown', async () => {
      const listing = await addListing('shown', { policy: 'oneDay', gap: 0 });
      const soon = new Date(Math.ceil((Date.now() + 3 * 3_600_000) / 1_800_000) * 1_800_000);
      const stay = {
        start: soon.toISOString(),
        end: new Date(soon.getTime() + 60 * 60_000).toISOString(),
      };
      const user = await driver();
      const booking = await booked(user, listing, 'A1', stay);
      // Within the last day under "full refund until 24 hours before": nothing comes back.
      expect(booking.refundIfCancelled?.amountMinor).toBe(0);
      const refused = await cancel(user, booking.id)
        .send({ expectedRefundMinor: booking.total.amountMinor })
        .expect(409);
      expect(refused.body).toMatchObject({
        code: 'REFUND_CHANGED',
        refund: { amountMinor: 0, currency: 'EUR' },
      });
      expect((await row(booking.id)).status).toBe('confirmed');
      // Told what it is now, the driver can still cancel.
      const done = await cancel(user, booking.id).send({ expectedRefundMinor: 0 }).expect(200);
      expect(BookingSchema.parse(done.body)).toMatchObject({
        status: 'cancelled',
        refund: { amountMinor: 0 },
      });
    });

    it('lets a hold go without a booking or an email', async () => {
      const user = await driver();
      const held = BookingSchema.parse(
        (await hold(user, garage, 'B1', stayOn(freshDay())).expect(201)).body,
      );
      expect(BookingSchema.parse((await cancel(user, held.id).expect(200)).body).status).toBe(
        'released',
      );
      expect(await emailsAbout(held.id)).toEqual([]);
    });

    it('refuses once the stay has begun', async () => {
      const user = await driver();
      const listing = await addListing('started');
      const booking = await booked(user, listing, 'A1', stayOn(freshDay()));
      await db
        .update(schema.bookings)
        .set({ startsAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.bookings.id, booking.id));
      expect((await cancel(user, booking.id).expect(409)).body).toMatchObject({
        code: 'BOOKING_STARTED',
      });
      expect(
        (
          await api(owner, 'post', `/owner/listings/${listing.id}/bookings/${booking.id}/cancel`)
            .send()
            .expect(409)
        ).body,
      ).toMatchObject({ code: 'BOOKING_STARTED' });
      // Under way, it stays on the owner's page, no longer cancellable.
      const response = await api(owner, 'get', `/owner/listings/${listing.id}/bookings`).expect(
        200,
      );
      expect(OwnerListingBookingsSchema.parse(response.body).bookings).toMatchObject([
        { id: booking.id, cancellable: false },
      ]);
    });
  });

  describe("a driver's lists", () => {
    it('shows upcoming bookings and holds, then the past, and leaves lapsed holds out', async () => {
      const user = await driver();
      const listing = await addListing('lists', { gap: 0 });
      const [first, second, third] = [freshDay(), freshDay(), freshDay()];
      const later = await booked(user, listing, 'A1', stayOn(second));
      const cancelled = await booked(user, listing, 'A1', stayOn(third));
      await cancel(user, cancelled.id).expect(200);
      const released = BookingSchema.parse(
        (await hold(user, listing, 'A1', stayOn(addDays(third, 1))).expect(201)).body,
      );
      await cancel(user, released.id).expect(200);
      const past = await booked(user, listing, 'A1', stayOn(addDays(third, 2)));
      const ended = new Date(Date.now() - 3_600_000);
      await db
        .update(schema.bookings)
        .set({
          startsAt: new Date(ended.getTime() - 3_600_000),
          endsAt: ended,
          blockedUntil: ended,
        })
        .where(eq(schema.bookings.id, past.id));
      // Last: a new hold lets the driver's others go.
      const running = BookingSchema.parse(
        (await hold(user, listing, 'A1', stayOn(first)).expect(201)).body,
      );

      const list = async (when: string) =>
        BookingListSchema.parse(
          (await api(user, 'get', '/bookings').query({ when }).expect(200)).body,
        );
      const upcoming = await list('upcoming');
      expect(upcoming.bookings.map((b) => [b.id, b.status])).toEqual([
        [running.id, 'held'],
        [later.id, 'confirmed'],
      ]);
      expect((await list('past')).bookings.map((b) => b.id)).toEqual([cancelled.id, past.id]);
      expect(upcoming.hasMore).toBe(false);
      expect(
        (await api(user, 'get', '/bookings').query({ when: 'all' }).expect(400)).body,
      ).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('lists a hold past its time nowhere, before the sweep marks it', async () => {
      const user = await driver();
      const lapsed = BookingSchema.parse(
        (await hold(user, garage, 'B1', stayOn(freshDay())).expect(201)).body,
      );
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.bookings.id, lapsed.id));
      expect((await row(lapsed.id)).status).toBe('held');
      for (const when of ['upcoming', 'past']) {
        const response = await api(user, 'get', '/bookings').query({ when }).expect(200);
        expect(BookingListSchema.parse(response.body).bookings).toEqual([]);
      }
    });

    it('pages a long history', async () => {
      const user = await driver();
      const listing = await addListing('history', { gap: 0 });
      const base = freshDay();
      await db.insert(schema.bookings).values(
        Array.from({ length: BOOKINGS_PAGE_SIZE + 1 }, (_, n) => {
          const startsAt = new Date(stayOn(addDays(base, n)).start);
          const endsAt = new Date(startsAt.getTime() + 3_600_000);
          return {
            reference: newBookingReference(),
            userId: user.id,
            locationId: listing.id,
            spaceId: listing.space.A1 ?? null,
            spaceLabel: 'A1',
            startsAt,
            endsAt,
            gapMinutes: 0,
            blockedUntil: endsAt,
            status: 'cancelled' as const,
            holdExpiresAt: startsAt,
            totalMinor: 200,
            currency: 'EUR',
            cancellationPolicy: 'oneDay' as const,
            vehiclePlate: 'IKB1234',
            confirmedAt: new Date(),
            cancelledAt: new Date(),
            cancelledBy: 'driver' as const,
            refundMinor: 200,
          };
        }),
      );
      const page = async (n: number) =>
        BookingListSchema.parse(
          (await api(user, 'get', '/bookings').query({ when: 'past', page: n }).expect(200)).body,
        );
      const [one, two] = [await page(1), await page(2)];
      expect(one.bookings).toHaveLength(BOOKINGS_PAGE_SIZE);
      expect(one.hasMore).toBe(true);
      expect(two.bookings).toHaveLength(1);
      expect(two.hasMore).toBe(false);
      expect(new Set([...one.bookings, ...two.bookings].map((b) => b.id)).size).toBe(
        BOOKINGS_PAGE_SIZE + 1,
      );
    });
  });

  describe("an owner's bookings page (decisions #34, #35)", () => {
    it('lists who is coming in which car, and lets the owner call a booking off', async () => {
      const user = await driver();
      const listing = await addListing('owners');
      const [early, late] = [freshDay(), freshDay()];
      const second = await booked(user, listing, 'A1', stayOn(late));
      const first = await booked(await driver(), listing, 'A1', stayOn(early));
      const page = async () =>
        OwnerListingBookingsSchema.parse(
          (await api(owner, 'get', `/owner/listings/${listing.id}/bookings`).expect(200)).body,
        );
      const before = await page();
      expect(before).toMatchObject({ id: listing.id, name: 'Κράτηση owners', hasMore: false });
      expect(before.bookings.map((b) => b.id)).toEqual([first.id, second.id]);
      expect(before.bookings[1]).toMatchObject({
        reference: second.reference,
        spaceLabel: 'A1',
        driverName: 'Test Driver',
        vehiclePlate: 'IKB1234',
        cancellable: true,
      });

      const path = `/owner/listings/${listing.id}/bookings/${second.id}/cancel`;
      await api(owner, 'post', path).send().expect(204);
      await api(owner, 'post', path).send().expect(204);
      expect(
        BookingSchema.parse((await api(user, 'get', `/bookings/${second.id}`)).body),
      ).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'owner',
        refund: second.total,
      });
      expect((await emailsAbout(second.id)).filter((e) => e.kind === 'booking-cancelled')).toEqual([
        { kind: 'booking-cancelled', userId: user.id },
      ]);
      expect((await page()).bookings.map((b) => b.id)).toEqual([first.id]);
      // The owner reaches a booking of their listing through their page, never the driver's routes.
      for (const call of [
        () => api(owner, 'get', `/bookings/${first.id}`),
        () => cancel(owner, first.id),
      ]) {
        expect((await call().expect(404)).body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      }
      // A name set around the sign-up rules (straight in the database) reaches the owner capped.
      await db
        .update(schema.users)
        .set({ name: 'Ν'.repeat(500) })
        .where(eq(schema.users.id, user.id));
      await api(user, 'get', '/bookings').expect(200);
      const capped = await page();
      expect(capped.bookings.every((b) => b.driverName.length <= 100)).toBe(true);
      // A booking of another listing isn't found through this one.
      expect(
        (
          await api(owner, 'post', `/owner/listings/${garage.id}/bookings/${first.id}/cancel`)
            .send()
            .expect(404)
        ).body,
      ).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    });
  });

  describe('closing time over a booking (decision #27)', () => {
    it('refuses closures and special hours that would strand a booking, until it is cancelled', async () => {
      const day = freshDay();
      const listing = await addListing('guard');
      const booking = await booked(await driver(), listing, 'A1', stayOn(day, '10:00', '12:00'));
      const save = (exceptions: unknown[]) =>
        api(owner, 'put', `/owner/listings/${listing.id}/hours-exceptions`).send({ exceptions });
      const entry = { label: null, startsOn: day, endsOn: day, hours: null, closedHours: null };

      expect((await save([entry]).expect(409)).body).toMatchObject({
        code: 'LISTING_BOOKED',
        bookings: 1,
      });
      // Special hours that leave the stay out, and a closed part across it: both strand it.
      await save([{ ...entry, hours: { opens: '11:00', closes: '20:00' } }]).expect(409);
      await save([{ ...entry, closedHours: { from: '11:30', to: '13:00' } }]).expect(409);
      // Hours around the stay, and another day, are fine.
      await save([{ ...entry, hours: { opens: '09:00', closes: '12:00' } }]).expect(200);
      await save([{ ...entry, startsOn: addDays(day, 1), endsOn: addDays(day, 1) }]).expect(200);
      await api(owner, 'post', `/owner/listings/${listing.id}/bookings/${booking.id}/cancel`)
        .send()
        .expect(204);
      await save([entry]).expect(200);
    });

    it('counts the hours in effect: dropping special hours can strand a booking too', async () => {
      const day = freshDay();
      // Open 08:00 to 20:00 each week, but later on that day, and booked in the later hours.
      const listing = await addListing('late-hours', { hours: [8 * 60, 20 * 60] });
      const save = (exceptions: unknown[]) =>
        api(owner, 'put', `/owner/listings/${listing.id}/hours-exceptions`).send({ exceptions });
      const later = {
        label: null,
        startsOn: day,
        endsOn: day,
        hours: { opens: '06:00', closes: '23:00' },
        closedHours: null,
      };
      await save([later]).expect(200);
      await booked(await driver(), listing, 'A1', stayOn(day, '20:00', '22:00'));
      // Back to the week's hours, which close at 20:00.
      expect((await save([]).expect(409)).body).toMatchObject({
        code: 'LISTING_BOOKED',
        bookings: 1,
      });
      // Its own day kept, another added: fine.
      const next = { ...later, startsOn: addDays(day, 1), endsOn: addDays(day, 1) };
      await save([later, next]).expect(200);
    });

    it('leaves a booked listing out of a copy of closures', async () => {
      const day = freshDay();
      const source = await addListing('copy-source');
      const target = await addListing('copy-target');
      const free = await addListing('copy-free');
      await booked(await driver(), target, 'A1', stayOn(day));
      await closeOn(source, [day]).expect(200);
      const response = await api(
        owner,
        'post',
        `/owner/listings/${source.id}/hours-exceptions/copy`,
      )
        .send({ to: [target.id, free.id] })
        .expect(200);
      expect(OwnerHoursExceptionsCopySchema.parse(response.body).results).toEqual([
        { id: target.id, outcome: 'booked' },
        { id: free.id, outcome: 'copied' },
      ]);
      const entries = await db
        .select({ locationId: schema.parkingHoursExceptions.locationId })
        .from(schema.parkingHoursExceptions)
        .where(inArray(schema.parkingHoursExceptions.locationId, [target.id, free.id]));
      expect(entries).toEqual([{ locationId: free.id }]);
    });

    it('guards the week of a listing sent back after it was live', async () => {
      const day = freshDay();
      const sentBack = await addListing('sent-back', {
        spaces: [{ label: 'S1' }, { label: 'S2' }],
      });
      const booking = await booked(await driver(), sentBack, 'S1', stayOn(day, '10:00', '12:00'));
      await db
        .update(schema.parkingLocations)
        .set({ status: 'changes_requested' })
        .where(eq(schema.parkingLocations.id, sentBack.id));
      const shorter = {
        periods: WEEK.map((weekday) => ({ weekday, opens: '11:00', closes: '20:00' })),
      };
      expect(
        (await api(owner, 'put', `/owner/listings/${sentBack.id}/hours`).send(shorter).expect(409))
          .body,
      ).toMatchObject({ code: 'LISTING_BOOKED', bookings: 1 });

      const source = await addListing('week-source', { status: 'draft' });
      await api(owner, 'put', `/owner/listings/${source.id}/hours`).send(shorter).expect(200);
      const copied = await api(owner, 'post', `/owner/listings/${source.id}/hours/copy`)
        .send({ to: [sentBack.id] })
        .expect(200);
      expect(OwnerHoursCopySchema.parse(copied.body).results).toEqual([
        { id: sentBack.id, outcome: 'booked' },
      ]);

      const spaces = (labels: string[]) =>
        api(owner, 'put', `/owner/listings/${sentBack.id}/spaces`).send({
          spaces: labels.map((label) => ({ label, features: [], hourlyRateMinor: null })),
        });
      // Removing the booked space is refused; the other can go, and the booked one keeps its row.
      expect((await spaces(['S2']).expect(409)).body).toMatchObject({
        code: 'SPACES_BOOKED',
        bookings: 1,
      });
      await spaces(['S1', 'S3']).expect(200);
      expect((await row(booking.id)).spaceId).toBe(sentBack.space.S1);
      // Saved again with features, it is still the same row.
      await api(owner, 'put', `/owner/listings/${sentBack.id}/spaces`)
        .send({
          spaces: [
            { label: 'S1', features: ['covered'], hourlyRateMinor: 300 },
            { label: 'S3', features: [], hourlyRateMinor: null },
          ],
        })
        .expect(200);
      const [s1] = await db
        .select()
        .from(schema.parkingSpaces)
        .where(eq(schema.parkingSpaces.id, sentBack.space.S1 ?? ''));
      expect(s1).toMatchObject({ isCovered: true, hourlyRateMinor: 300 });

      // Once called off, the space can go; the booking keeps its label.
      await api(owner, 'post', `/owner/listings/${sentBack.id}/bookings/${booking.id}/cancel`)
        .send()
        .expect(204);
      await spaces(['S3']).expect(200);
      expect(await row(booking.id)).toMatchObject({ spaceId: null, spaceLabel: 'S1' });
    });

    it('counts a running hold on a space being removed, but not a lapsed one', async () => {
      const listing = await addListing('held-spaces', {
        spaces: [{ label: 'H1' }, { label: 'H2' }],
      });
      const held = BookingSchema.parse(
        (await hold(await driver(), listing, 'H1', stayOn(freshDay())).expect(201)).body,
      );
      await db
        .update(schema.parkingLocations)
        .set({ status: 'changes_requested' })
        .where(eq(schema.parkingLocations.id, listing.id));
      const keepOnly = (label: string) =>
        api(owner, 'put', `/owner/listings/${listing.id}/spaces`).send({
          spaces: [{ label, features: [], hourlyRateMinor: null }],
        });
      expect((await keepOnly('H2').expect(409)).body).toMatchObject({ code: 'SPACES_BOOKED' });
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.bookings.id, held.id));
      await keepOnly('H2').expect(200);
    });

    it('never deletes a draft that has bookings', async () => {
      const listing = await addListing('draft-with-bookings');
      await booked(await driver(), listing, 'A1', stayOn(freshDay()));
      await db
        .update(schema.parkingLocations)
        .set({ status: 'draft' })
        .where(eq(schema.parkingLocations.id, listing.id));
      expect(
        (await api(owner, 'delete', `/owner/listings/${listing.id}`).expect(409)).body,
      ).toMatchObject({ code: 'LISTING_LOCKED' });
    });
  });

  describe('free spaces', () => {
    it('offers the free spaces of a big garage, however many before them are booked', async () => {
      const labels = Array.from(
        { length: LISTING_SPACES_LIMIT + 2 },
        (_, n) => `G${String(n + 1).padStart(2, '0')}`,
      );
      const listing = await addListing('big', {
        gap: 0,
        spaces: labels.map((label) => ({ label })),
      });
      const day = freshDay();
      const stay = stayOn(day);
      const user = await driver();
      // The first 48 in label order, booked straight in the database.
      await db.insert(schema.bookings).values(
        labels.slice(0, LISTING_SPACES_LIMIT).map((label) => ({
          reference: newBookingReference(),
          userId: user.id,
          locationId: listing.id,
          spaceId: listing.space[label] ?? null,
          spaceLabel: label,
          startsAt: new Date(stay.start),
          endsAt: new Date(stay.end),
          gapMinutes: 0,
          blockedUntil: new Date(stay.end),
          status: 'confirmed' as const,
          holdExpiresAt: new Date(stay.start),
          totalMinor: 400,
          currency: 'EUR',
          cancellationPolicy: 'oneDay' as const,
          vehiclePlate: 'IKB1234',
          confirmedAt: new Date(),
        })),
      );
      const response = await api(null, 'get', `/parking/${listing.slug}`).query(stay).expect(200);
      const detail = ParkingListingDetailSchema.parse(response.body);
      expect(detail.availability?.freeSpaces).toBe(2);
      expect(detail.spaces.map((space) => space.label)).toEqual(labels.slice(LISTING_SPACES_LIMIT));
    });

    it('quotes the cheapest free space, in search and on the listing', async () => {
      const listing = await addListing('cheapest', {
        gap: 0,
        spaces: [{ label: 'C1' }, { label: 'C2', rate: 400 }],
      });
      const day = freshDay();
      const stay = stayOn(day, '10:00', '12:00');
      // The cheaper space (the listing's €2.00) is booked: the €4.00 one is what's left.
      await booked(await driver(), listing, 'C1', stay);
      const response = await api(null, 'get', `/parking/${listing.slug}`).query(stay).expect(200);
      const detail = ParkingListingDetailSchema.parse(response.body);
      expect(detail.availability?.total.amountMinor).toBe(800);
      const results = ParkingSearchResponseSchema.parse(
        (
          await api(null, 'get', '/parking/search')
            .query({ ...HERE, ...stay })
            .expect(200)
        ).body,
      ).results;
      expect(results.find((result) => result.slug === listing.slug)).toMatchObject({
        freeSpaces: 1,
        total: { amountMinor: 800 },
        hourlyRate: { amountMinor: 400 },
      });
    });
  });
});
