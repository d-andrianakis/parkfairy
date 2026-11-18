import { randomUUID } from 'node:crypto';

import {
  addDays,
  BookingSchema,
  DEFAULT_TIME_ZONE,
  FavouriteListSchema,
  FAVOURITES_MAX,
  SavedVehicleListSchema,
  VEHICLE_LIMITS,
  zonedParts,
  zonedTimeToUtc,
} from '@parkfairy/contracts';
import { type Database, schema } from '@parkfairy/database';
import { eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, type TestApp, type TestUser } from './test-app.js';

// Saved vehicles and favourites (5A.2): the driver's own and private, a vehicle that doesn't fit is
// refused at the hold and again at the payment, and a booking keeps its plate whatever becomes of
// the vehicle it was made for.
const HERE = { latitude: 35.3387, longitude: 25.1442 };
const PREFIX = 'it-garage-';
const tag = randomUUID().slice(0, 8);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
const zone = DEFAULT_TIME_ZONE;
const today = zonedParts(new Date(), zone).date;
let nextOffset = 5;
const freshStay = () => {
  const day = addDays(today, nextOffset++);
  return {
    start: zonedTimeToUtc(day, '10:00', zone)?.toISOString() ?? '',
    end: zonedTimeToUtc(day, '12:00', zone)?.toISOString() ?? '',
  };
};

const visitors = new Map<string, string>();
function visitorOf({ id }: TestUser): string {
  const known = visitors.get(id);
  if (known) return known;
  const address = `198.77.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
  visitors.set(id, address);
  return address;
}

describe('saved vehicles and favourites (5A.2)', () => {
  let app: TestApp;
  let db: Database;
  let ownerProfileId: string;
  const users: TestUser[] = [];
  let spaces: Record<string, string>;
  let slug: string;
  let listingId: string;

  const api = (user: TestUser | null, method: 'get' | 'post' | 'put' | 'delete', path: string) => {
    const call = request(app.getHttpServer())[method](`/v1${path}`);
    if (method !== 'get') call.set('Origin', ORIGIN);
    return user ? call.set('Cookie', user.cookie).set('X-Forwarded-For', visitorOf(user)) : call;
  };
  async function driver(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }
  const save = (user: TestUser, body: Record<string, unknown>) =>
    api(user, 'post', '/vehicles').send(body);
  const mine = async (user: TestUser) =>
    SavedVehicleListSchema.parse((await api(user, 'get', '/vehicles').expect(200)).body).vehicles;

  async function addListing(name: string, status: 'published' | 'draft' = 'published') {
    const [row] = await db
      .insert(schema.parkingLocations)
      .values({
        ownerId: ownerProfileId,
        slug: `${PREFIX}${tag}-${name}`,
        name: `Γκαράζ ${name}`,
        address: 'Οδός Δοκιμής 3, Ηράκλειο',
        areaId: 'syntagma',
        location: HERE,
        hourlyRateMinor: 200,
        bookingGapMinutes: 0,
        cancellationPolicy: 'oneDay',
        status,
      })
      .returning({ id: schema.parkingLocations.id, slug: schema.parkingLocations.slug });
    const id = row?.id ?? '';
    await db
      .insert(schema.listingOwners)
      .values({ locationId: id, ownerId: ownerProfileId, role: 'primary', shareBps: 10_000 });
    await db.insert(schema.parkingOpeningHours).values(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        locationId: id,
        weekday,
        opensMinute: 0,
        closesMinute: 1440,
      })),
    );
    return { id, slug: row?.slug ?? '' };
  }

  async function removeOurs() {
    const ours = await db
      .select({ id: schema.parkingLocations.id })
      .from(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    const ids = ours.map((row) => row.id);
    if (ids.length === 0) return;
    await db
      .delete(schema.bookingPayees)
      .where(
        inArray(
          schema.bookingPayees.bookingId,
          db
            .select({ id: schema.bookings.id })
            .from(schema.bookings)
            .where(inArray(schema.bookings.locationId, ids)),
        ),
      );
    await db.delete(schema.bookings).where(inArray(schema.bookings.locationId, ids));
    await db.delete(schema.parkingLocations).where(inArray(schema.parkingLocations.id, ids));
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
    await removeOurs();
    const owner = await signUpUser(app);
    users.push(owner);
    const [profile] = await db
      .insert(schema.ownerProfiles)
      .values({ userId: owner.id })
      .returning({ id: schema.ownerProfiles.id });
    ownerProfileId = profile?.id ?? '';
    const listing = await addListing('main');
    ({ id: listingId, slug } = listing);
    const rows = await db
      .insert(schema.parkingSpaces)
      .values([
        { locationId: listingId, label: 'ANY' },
        { locationId: listingId, label: 'LOW', maxHeightCm: 200 },
        { locationId: listingId, label: 'SHORT', maxLengthCm: 420, maxWidthCm: 180 },
        { locationId: listingId, label: 'ROOMY', maxHeightCm: 300 },
      ])
      .returning({ id: schema.parkingSpaces.id, label: schema.parkingSpaces.label });
    spaces = Object.fromEntries(rows.map((row) => [row.label, row.id]));
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
      ['get', '/vehicles'],
      ['post', '/vehicles'],
      ['put', `/vehicles/${randomUUID()}`],
      ['delete', `/vehicles/${randomUUID()}`],
      ['get', '/favourites'],
      ['get', '/favourites/some-listing'],
      ['put', '/favourites/some-listing'],
      ['delete', '/favourites/some-listing'],
    ] as const)('needs an account for %s %s', async (method, path) => {
      await api(null, method, path).send({}).expect(401);
    });

    it("keeps one driver's vehicles from another, as if they didn't exist", async () => {
      const [first, other] = [await driver(), await driver()];
      await save(first, { plate: 'IKB1234' }).expect(201);
      const [vehicle] = await mine(first);
      expect(await mine(other)).toEqual([]);
      for (const call of [
        () => api(other, 'put', `/vehicles/${vehicle?.id}`).send({ plate: 'AAA1111' }),
        () => api(other, 'delete', `/vehicles/${vehicle?.id}`),
        () => api(other, 'put', '/vehicles/not-a-uuid').send({ plate: 'AAA1111' }),
      ]) {
        expect((await call().expect(404)).body).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
      }
      expect(await mine(first)).toHaveLength(1);
    });
  });

  describe('saved vehicles', () => {
    it('saves a vehicle as the car shows its plate, in the order saved', async () => {
      const user = await driver();
      const response = await save(user, {
        plate: 'ιΚΒ-1234',
        name: '  Work car ',
        heightCm: 190,
        lengthCm: 440,
      }).expect(201);
      const { vehicles } = SavedVehicleListSchema.parse(response.body);
      expect(vehicles).toEqual([
        expect.objectContaining({
          plate: 'IKB1234',
          name: 'Work car',
          heightCm: 190,
          lengthCm: 440,
          widthCm: null,
        }),
      ]);
      await save(user, { plate: 'ΥΖΜ 5678', name: '' }).expect(201);
      expect((await mine(user)).map(({ plate, name }) => [plate, name])).toEqual([
        ['IKB1234', 'Work car'],
        ['YZM5678', null],
      ]);
    });

    it.each([
      ['a missing plate', {}],
      ['an empty plate', { plate: '  ' }],
      ['a plate that is not one', { plate: '!!' }],
      ['a name too long', { plate: 'IKB1234', name: 'x'.repeat(VEHICLE_LIMITS.name + 1) }],
      ['a name with a control character', { plate: 'IKB1234', name: 'a\u0000b' }],
      ['a height under the limit', { plate: 'IKB1234', heightCm: 99 }],
      ['a length over the limit', { plate: 'IKB1234', lengthCm: 1501 }],
      ['a width that is not whole', { plate: 'IKB1234', widthCm: 180.5 }],
      ['a field that is not one', { plate: 'IKB1234', isDefault: true }],
    ])('refuses %s', async (_, body) => {
      const user = await driver();
      const response = await save(user, body).expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await mine(user)).toEqual([]);
    });

    it('keeps one entry to a car, however its plate was typed', async () => {
      const user = await driver();
      await save(user, { plate: 'IKB-1234' }).expect(201);
      const again = await save(user, { plate: 'ΙΚΒ 1234' }).expect(409);
      expect(again.body).toMatchObject({ code: 'VEHICLE_EXISTS' });
      // Another driver may have the same car: a plate is only unique to one driver's list.
      await save(await driver(), { plate: 'IKB1234' }).expect(201);
    });

    it('keeps at most ten to a driver, even when saved at once', async () => {
      const user = await driver();
      const plates = Array.from({ length: 14 }, (_, index) => `AB${1000 + index}`);
      const results = await Promise.all(plates.map((plate) => save(user, { plate })));
      expect(results.filter((response) => response.status === 201)).toHaveLength(
        VEHICLE_LIMITS.perDriver,
      );
      expect(results.filter((response) => response.status === 409)).toHaveLength(
        plates.length - VEHICLE_LIMITS.perDriver,
      );
      const refused = results.find((response) => response.status === 409);
      expect(refused?.body).toMatchObject({ code: 'VEHICLE_LIMIT_REACHED' });
      expect(await mine(user)).toHaveLength(VEHICLE_LIMITS.perDriver);
    });

    it('changes one, clearing what is left out, and refuses a plate that is saved already', async () => {
      const user = await driver();
      await save(user, { plate: 'IKB1234', name: 'Old', heightCm: 190 }).expect(201);
      await save(user, { plate: 'YZM5678' }).expect(201);
      const [first] = await mine(user);
      const changed = await api(user, 'put', `/vehicles/${first?.id}`)
        .send({ plate: 'ikb-1234', name: 'New' })
        .expect(200);
      expect(SavedVehicleListSchema.parse(changed.body).vehicles[0]).toMatchObject({
        id: first?.id,
        plate: 'IKB1234',
        name: 'New',
        heightCm: null,
      });
      const clash = await api(user, 'put', `/vehicles/${first?.id}`)
        .send({ plate: 'YZM 5678' })
        .expect(409);
      expect(clash.body).toMatchObject({ code: 'VEHICLE_EXISTS' });
    });

    it('forgets one', async () => {
      const user = await driver();
      await save(user, { plate: 'IKB1234' }).expect(201);
      const [vehicle] = await mine(user);
      const response = await api(user, 'delete', `/vehicles/${vehicle?.id}`).expect(200);
      expect(SavedVehicleListSchema.parse(response.body).vehicles).toEqual([]);
      await api(user, 'delete', `/vehicles/${vehicle?.id}`).expect(404);
    });

    it('has the database refuse what the API would', async () => {
      const user = await driver();
      const insert = (values: Partial<typeof schema.savedVehicles.$inferInsert>) =>
        db.insert(schema.savedVehicles).values({ userId: user.id, plate: 'IKB1234', ...values });
      await expect(insert({ plate: 'ikb1234' })).rejects.toThrow();
      await expect(insert({ plate: 'A' })).rejects.toThrow();
      await expect(insert({ name: '' })).rejects.toThrow();
      await expect(insert({ heightCm: 50 })).rejects.toThrow();
    });
  });

  describe('a hold for a vehicle', () => {
    const hold = (user: TestUser, label: string, extra: Record<string, unknown> = {}) =>
      api(user, 'post', '/bookings').send({
        listing: slug,
        spaceId: spaces[label],
        ...freshStay(),
        ...extra,
      });

    async function withVehicle(body: Record<string, unknown>) {
      const user = await driver();
      await save(user, body).expect(201);
      const [vehicle] = await mine(user);
      return { user, vehicleId: vehicle?.id ?? '' };
    }

    it('is tied to the vehicle, and offers its space for rebooking', async () => {
      const { user, vehicleId } = await withVehicle({ plate: 'IKB1234', heightCm: 190 });
      const held = BookingSchema.parse((await hold(user, 'LOW', { vehicleId }).expect(201)).body);
      expect(held).toMatchObject({ vehicleId, spaceId: spaces.LOW, vehiclePlate: null });
    });

    it.each([
      ['too high', { heightCm: 201 }, 'LOW'],
      ['too long', { lengthCm: 421 }, 'SHORT'],
      ['too wide', { widthCm: 181 }, 'SHORT'],
    ])('refuses a vehicle that is %s, and holds nothing', async (_, size, label) => {
      const { user, vehicleId } = await withVehicle({ plate: 'IKB1234', ...size });
      const refused = await hold(user, label, { vehicleId }).expect(409);
      expect(refused.body).toMatchObject({ code: 'VEHICLE_DOES_NOT_FIT' });
      const rows = await db
        .select({ id: schema.bookings.id })
        .from(schema.bookings)
        .where(eq(schema.bookings.userId, user.id));
      expect(rows).toEqual([]);
    });

    it('takes a vehicle at the limit, one with no size said, and a space with no limit', async () => {
      const exact = await withVehicle({ plate: 'IKB1234', heightCm: 200 });
      await hold(exact.user, 'LOW', { vehicleId: exact.vehicleId }).expect(201);
      const unsized = await withVehicle({ plate: 'YZM5678' });
      await hold(unsized.user, 'LOW', { vehicleId: unsized.vehicleId }).expect(201);
      const big = await withVehicle({ plate: 'NNN1000', heightCm: 480, lengthCm: 1400 });
      await hold(big.user, 'ANY', { vehicleId: big.vehicleId }).expect(201);
    });

    it("answers another driver's vehicle, or one that was deleted, as not found", async () => {
      const { vehicleId } = await withVehicle({ plate: 'IKB1234' });
      const stranger = await driver();
      for (const id of [vehicleId, randomUUID()]) {
        const refused = await hold(stranger, 'ANY', { vehicleId: id }).expect(404);
        expect(refused.body).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
      }
      await hold(stranger, 'ANY', { vehicleId: 'nope' }).expect(400);
    });
  });

  describe('confirming for a vehicle', () => {
    async function held(
      vehicle: Record<string, unknown>,
      label = 'ROOMY',
    ): Promise<{ user: TestUser; vehicleId: string; id: string }> {
      const user = await driver();
      await save(user, vehicle).expect(201);
      const [saved] = await mine(user);
      const vehicleId = saved?.id ?? '';
      const response = await api(user, 'post', '/bookings')
        .send({ listing: slug, spaceId: spaces[label], ...freshStay(), vehicleId })
        .expect(201);
      return { user, vehicleId, id: BookingSchema.parse(response.body).id };
    }
    const confirm = (user: TestUser, id: string, body: Record<string, unknown>) =>
      api(user, 'post', `/bookings/${id}/confirm`).send(body);

    it("books with the vehicle's plate, and keeps it when the vehicle is forgotten", async () => {
      const { user, vehicleId, id } = await held({ plate: 'ΙΚΒ-1234', heightCm: 190 });
      const booking = BookingSchema.parse(
        (await confirm(user, id, { vehicleId }).expect(200)).body,
      );
      expect(booking).toMatchObject({ status: 'confirmed', vehiclePlate: 'IKB1234', vehicleId });
      await api(user, 'delete', `/vehicles/${vehicleId}`).expect(200);
      const after = BookingSchema.parse(
        (await api(user, 'get', `/bookings/${id}`).expect(200)).body,
      );
      expect(after).toMatchObject({ vehiclePlate: 'IKB1234', vehicleId: null });
    });

    it('books with a typed plate instead, which leaves no tie to the vehicle', async () => {
      const { user, id } = await held({ plate: 'IKB1234' });
      const booking = BookingSchema.parse(
        (await confirm(user, id, { vehiclePlate: 'yzm-5678' }).expect(200)).body,
      );
      expect(booking).toMatchObject({ vehiclePlate: 'YZM5678', vehicleId: null });
    });

    it.each([
      ['neither', {}],
      ['both', { vehiclePlate: 'IKB1234', vehicleId: randomUUID() }],
      ['a vehicle that is not an id', { vehicleId: 'x' }],
    ])('wants a plate or a vehicle, not %s', async (_, body) => {
      const { user, id } = await held({ plate: 'IKB1234' });
      const refused = await confirm(user, id, body).expect(400);
      expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('checks the fit again: a vehicle made bigger since the hold is refused, and the hold stays', async () => {
      const { user, vehicleId, id } = await held({ plate: 'IKB1234', heightCm: 190 }, 'LOW');
      const [saved] = await mine(user);
      await api(user, 'put', `/vehicles/${saved?.id}`)
        .send({ plate: 'IKB1234', heightCm: 250 })
        .expect(200);
      const refused = await confirm(user, id, { vehicleId }).expect(409);
      expect(refused.body).toMatchObject({ code: 'VEHICLE_DOES_NOT_FIT' });
      const [row] = await db
        .select({ status: schema.bookings.status, plate: schema.bookings.vehiclePlate })
        .from(schema.bookings)
        .where(eq(schema.bookings.id, id));
      expect(row).toEqual({ status: 'held', plate: null });
    });

    it('answers a vehicle forgotten since the hold as not found, and the hold stays', async () => {
      const { user, vehicleId, id } = await held({ plate: 'IKB1234' });
      await api(user, 'delete', `/vehicles/${vehicleId}`).expect(200);
      const refused = await confirm(user, id, { vehicleId }).expect(404);
      expect(refused.body).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
      const [row] = await db
        .select({ status: schema.bookings.status })
        .from(schema.bookings)
        .where(eq(schema.bookings.id, id));
      expect(row?.status).toBe('held');
    });

    it('is answered as it was when confirmed twice, whatever the second asks', async () => {
      const { user, vehicleId, id } = await held({ plate: 'IKB1234' });
      await confirm(user, id, { vehicleId }).expect(200);
      const again = await confirm(user, id, { vehiclePlate: 'YZM-5678' }).expect(200);
      expect(BookingSchema.parse(again.body)).toMatchObject({
        vehiclePlate: 'IKB1234',
        vehicleId,
      });
    });

    it('keeps an earlier hold when a new one is refused for the vehicle', async () => {
      const { user, vehicleId, id } = await held({ plate: 'IKB1234', heightCm: 250 }, 'ROOMY');
      await api(user, 'post', '/bookings')
        .send({ listing: slug, spaceId: spaces.LOW, ...freshStay(), vehicleId })
        .expect(409);
      const [row] = await db
        .select({ status: schema.bookings.status })
        .from(schema.bookings)
        .where(eq(schema.bookings.id, id));
      expect(row?.status).toBe('held');
    });

    it("never takes another driver's vehicle", async () => {
      const { vehicleId } = await held({ plate: 'IKB1234' });
      const other = await held({ plate: 'YZM5678' });
      const refused = await confirm(other.user, other.id, { vehicleId }).expect(404);
      expect(refused.body).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
    });
  });

  describe('favourites', () => {
    const favourites = async (user: TestUser) =>
      FavouriteListSchema.parse((await api(user, 'get', '/favourites').expect(200)).body).listings;

    it('keeps a listing, says so, and forgets it again', async () => {
      const user = await driver();
      expect((await api(user, 'get', `/favourites/${slug}`).expect(200)).body).toEqual({
        favourite: false,
      });
      expect((await api(user, 'put', `/favourites/${slug}`).expect(200)).body).toEqual({
        favourite: true,
      });
      // Asked again, it stays one.
      await api(user, 'put', `/favourites/${slug}`).expect(200);
      expect((await api(user, 'get', `/favourites/${slug}`).expect(200)).body).toEqual({
        favourite: true,
      });
      expect((await favourites(user)).map((listing) => listing.slug)).toEqual([slug]);
      expect((await api(user, 'delete', `/favourites/${slug}`).expect(200)).body).toEqual({
        favourite: false,
      });
      await api(user, 'delete', `/favourites/${slug}`).expect(200);
      expect(await favourites(user)).toEqual([]);
    });

    it("is private: another driver's favourites never show, nor change", async () => {
      const [first, other] = [await driver(), await driver()];
      await api(first, 'put', `/favourites/${slug}`).expect(200);
      expect(await favourites(other)).toEqual([]);
      expect((await api(other, 'get', `/favourites/${slug}`).expect(200)).body).toEqual({
        favourite: false,
      });
      await api(other, 'delete', `/favourites/${slug}`).expect(200);
      expect(await favourites(first)).toHaveLength(1);
    });

    it('lists the newest first, and leaves out a listing that is no longer live', async () => {
      const user = await driver();
      const [a, b, c] = [
        await addListing('fav-a'),
        await addListing('fav-b'),
        await addListing('fav-c'),
      ];
      for (const { id } of [a, b, c]) {
        await db.insert(schema.parkingSpaces).values({ locationId: id, label: 'X1' });
      }
      for (const listing of [a, b, c]) {
        await api(user, 'put', `/favourites/${listing.slug}`).expect(200);
      }
      expect((await favourites(user)).map((listing) => listing.slug)).toEqual([
        c.slug,
        b.slug,
        a.slug,
      ]);
      await db
        .update(schema.parkingLocations)
        .set({ status: 'suspended' })
        .where(eq(schema.parkingLocations.id, b.id));
      expect((await favourites(user)).map((listing) => listing.slug)).toEqual([c.slug, a.slug]);
      // Not forgotten: live again, it is back where it was.
      await db
        .update(schema.parkingLocations)
        .set({ status: 'published' })
        .where(eq(schema.parkingLocations.id, b.id));
      expect(await favourites(user)).toHaveLength(3);
      // The page says nothing of a listing that isn't live.
      await db
        .update(schema.parkingLocations)
        .set({ status: 'suspended' })
        .where(eq(schema.parkingLocations.id, b.id));
      await api(user, 'get', `/favourites/${b.slug}`).expect(404);
      await api(user, 'put', `/favourites/${b.slug}`).expect(404);
      // But one that stopped being live can be taken off the list.
      await api(user, 'delete', `/favourites/${b.slug}`).expect(200);
    });

    it('leaves out a listing with no space in use, and still says it is one', async () => {
      const user = await driver();
      const quiet = await addListing('fav-quiet');
      const [only] = await db
        .insert(schema.parkingSpaces)
        .values({ locationId: quiet.id, label: 'X1' })
        .returning({ id: schema.parkingSpaces.id });
      await api(user, 'put', `/favourites/${quiet.slug}`).expect(200);
      expect((await favourites(user)).map((listing) => listing.slug)).toEqual([quiet.slug]);
      await db
        .update(schema.parkingSpaces)
        .set({ isActive: false })
        .where(eq(schema.parkingSpaces.id, only?.id ?? ''));
      expect(await favourites(user)).toEqual([]);
      expect((await api(user, 'get', `/favourites/${quiet.slug}`).expect(200)).body).toEqual({
        favourite: true,
      });
    });

    it('answers an unknown listing, a draft and a malformed slug alike', async () => {
      const user = await driver();
      const draft = await addListing('draft', 'draft');
      for (const name of ['no-such-listing', draft.slug, 'NOT A SLUG!']) {
        const response = await api(user, 'put', `/favourites/${encodeURIComponent(name)}`).expect(
          404,
        );
        expect(response.body).toMatchObject({ code: 'LISTING_NOT_FOUND' });
      }
    });

    it('keeps at most a hundred, even when asked at once', async () => {
      const user = await driver();
      const listings = Array.from({ length: FAVOURITES_MAX - 2 }, (_, index) => ({
        ownerId: ownerProfileId,
        slug: `${PREFIX}${tag}-bulk-${index}`,
        name: `Bulk ${index}`,
        address: 'Οδός Δοκιμής 4, Ηράκλειο',
        areaId: 'syntagma' as const,
        location: HERE,
        hourlyRateMinor: 200,
        bookingGapMinutes: 0,
        cancellationPolicy: 'oneDay' as const,
        status: 'published' as const,
      }));
      const created = await db
        .insert(schema.parkingLocations)
        .values(listings)
        .returning({ id: schema.parkingLocations.id });
      await db
        .insert(schema.favouriteListings)
        .values(created.map(({ id }) => ({ userId: user.id, locationId: id })));
      const extra = await Promise.all(
        ['one', 'two', 'three', 'four'].map((name) => addListing(`over-${name}`)),
      );
      const results = await Promise.all(
        extra.map(({ slug: extraSlug }) => api(user, 'put', `/favourites/${extraSlug}`)),
      );
      expect(results.filter((response) => response.status === 200)).toHaveLength(2);
      const refused = results.find((response) => response.status === 409);
      expect(refused?.body).toMatchObject({ code: 'FAVOURITES_LIMIT_REACHED' });
      const kept = await db
        .select({ id: schema.favouriteListings.id })
        .from(schema.favouriteListings)
        .where(eq(schema.favouriteListings.userId, user.id));
      const count = kept.length;
      expect(count).toBe(FAVOURITES_MAX);
    });
  });
});
