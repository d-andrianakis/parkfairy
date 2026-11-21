import { randomUUID } from 'node:crypto';

import { type Database, schema } from '@parkfairy/database';
import { eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, type TestApp, type TestUser } from './test-app.js';

// What a driver reaches around a stay (5A.3): the reminder choice, and the booking as a calendar file.
const HERE = { latitude: 35.51, longitude: 24.02 };
const PREFIX = 'it-pass-';
const tag = randomUUID().slice(0, 8);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
const HOUR_MS = 3_600_000;

describe('reminders and the booking’s calendar file (5A.3)', () => {
  let app: TestApp;
  let db: Database;
  let listingId: string;
  const users: TestUser[] = [];
  const visitors = new Map<string, string>();

  const api = (user: TestUser | null, method: 'get' | 'put', path: string) => {
    const call = request(app.getHttpServer())[method](`/v1${path}`);
    if (method !== 'get') call.set('Origin', ORIGIN);
    if (!user) return call;
    let address = visitors.get(user.id);
    if (!address) {
      address = `198.88.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
      visitors.set(user.id, address);
    }
    return call.set('Cookie', user.cookie).set('X-Forwarded-For', address);
  };
  async function driver(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }

  async function booking(
    user: TestUser,
    status: 'held' | 'confirmed' | 'cancelled' = 'confirmed',
    extra: { name?: string | null; address?: string | null } = {},
  ) {
    const [space] = await db
      .insert(schema.parkingSpaces)
      .values({ locationId: listingId, label: `S${randomUUID().slice(0, 6)}` })
      .returning({ id: schema.parkingSpaces.id, label: schema.parkingSpaces.label });
    const startsAt = new Date(Date.now() + 48 * HOUR_MS);
    const endsAt = new Date(startsAt.getTime() + 2 * HOUR_MS);
    const reference = `P${randomUUID().slice(0, 3)}-${randomUUID().slice(0, 4)}`.toUpperCase();
    const [row] = await db
      .insert(schema.bookings)
      .values({
        reference,
        userId: user.id,
        locationId: listingId,
        spaceId: space?.id ?? null,
        spaceLabel: space?.label ?? '',
        listingName: extra.name === undefined ? 'Γκαράζ; με, κόμμα' : extra.name,
        listingAddress: extra.address === undefined ? 'Οδός Δοκιμής 9, Χανιά' : extra.address,
        listingLocale: 'el',
        startsAt,
        endsAt,
        gapMinutes: 0,
        blockedUntil: endsAt,
        status,
        holdExpiresAt: new Date(Date.now() + 600_000),
        totalMinor: 400,
        currency: 'EUR',
        cancellationPolicy: 'oneDay',
        vehiclePlate: status === 'held' ? null : 'IKB1234',
        confirmedAt: status === 'held' ? null : new Date(),
        commissionBps: 1000,
        ...(status === 'cancelled'
          ? { cancelledAt: new Date(), cancelledBy: 'driver' as const, refundMinor: 400 }
          : {}),
      })
      .returning({ id: schema.bookings.id });
    return { id: row?.id ?? '', reference, startsAt, endsAt, label: space?.label ?? '' };
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
    const [listing] = await db
      .insert(schema.parkingLocations)
      .values({
        ownerId: profile?.id ?? '',
        slug: `${PREFIX}${tag}`,
        name: 'Γκαράζ πάσου',
        address: 'Οδός Δοκιμής 9, Χανιά',
        areaId: 'syntagma',
        location: HERE,
        hourlyRateMinor: 200,
        bookingGapMinutes: 0,
        cancellationPolicy: 'oneDay',
        status: 'published',
      })
      .returning({ id: schema.parkingLocations.id });
    listingId = listing?.id ?? '';
  });

  afterAll(async () => {
    await removeOurs();
    await app.close();
  });

  describe('the reminder choice', () => {
    it.each([
      ['get', '/me/reminders'],
      ['put', '/me/reminders'],
    ] as const)('needs an account for %s %s', async (method, path) => {
      await api(null, method, path).send({ reminderEmails: false }).expect(401);
    });

    it('is on to begin with, and kept as the driver sets it, for them alone', async () => {
      const [user, other] = [await driver(), await driver()];
      expect((await api(user, 'get', '/me/reminders').expect(200)).body).toEqual({
        reminderEmails: true,
      });
      expect(
        (await api(user, 'put', '/me/reminders').send({ reminderEmails: false }).expect(200)).body,
      ).toEqual({ reminderEmails: false });
      expect((await api(user, 'get', '/me/reminders').expect(200)).body).toEqual({
        reminderEmails: false,
      });
      expect((await api(other, 'get', '/me/reminders').expect(200)).body).toEqual({
        reminderEmails: true,
      });
      await api(user, 'put', '/me/reminders').send({ reminderEmails: true }).expect(200);
      const [row] = await db
        .select({ on: schema.users.reminderEmails })
        .from(schema.users)
        .where(eq(schema.users.id, user.id));
      expect(row?.on).toBe(true);
    });

    it.each([
      ['nothing', {}],
      ['a word for a yes', { reminderEmails: 'yes' }],
      ['an id of someone else', { reminderEmails: false, userId: randomUUID() }],
    ])('refuses %s', async (_, body) => {
      const user = await driver();
      const refused = await api(user, 'put', '/me/reminders').send(body).expect(400);
      expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((await api(user, 'get', '/me/reminders').expect(200)).body).toEqual({
        reminderEmails: true,
      });
    });
  });

  describe('the calendar file', () => {
    it('needs an account', async () => {
      await api(null, 'get', `/bookings/${randomUUID()}/calendar`).expect(401);
    });

    it('is the booking as one event, with the place and the reference and nothing private', async () => {
      const user = await driver();
      const made = await booking(user);
      const response = await api(user, 'get', `/bookings/${made.id}/calendar?locale=en`).expect(
        200,
      );
      expect(response.headers['content-type']).toMatch(/^text\/calendar; charset=utf-8/);
      expect(response.headers['content-disposition']).toContain(
        `attachment; filename=parkfairy-${made.reference}.ics`,
      );
      expect(response.headers['cache-control']).toContain('no-store');
      // Long lines are folded at 75 octets, which the Greek words reach: read them unfolded.
      const text = response.text.replaceAll('\r\n ', '');
      expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(text).toContain(`UID:booking-${made.id}@parkfairy`);
      const utc = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '');
      expect(text).toContain(`DTSTART:${utc(made.startsAt)}`);
      expect(text).toContain(`DTEND:${utc(made.endsAt)}`);
      // Commas and semicolons in the owner's words are escaped, as a calendar needs.
      expect(text).toContain('SUMMARY:Parking at Γκαράζ\\; με\\, κόμμα');
      expect(text).toContain('LOCATION:Οδός Δοκιμής 9\\, Χανιά');
      expect(text).toContain(`Booking reference ${made.reference}`);
      // A calendar syncs to services nobody chose: no plate, no gate code, no person.
      expect(text).not.toMatch(/IKB1234|Test Driver|@example\.com/);
    });

    it('speaks Greek when asked, English when asked for nothing or something unknown', async () => {
      const user = await driver();
      const made = await booking(user);
      const greek = await api(user, 'get', `/bookings/${made.id}/calendar?locale=el`).expect(200);
      expect(greek.text).toContain('SUMMARY:Στάθμευση: Γκαράζ');
      expect(greek.text).toContain(`Κωδικός κράτησης ${made.reference}`);
      for (const query of ['', '?locale=fr', '?locale[]=el']) {
        const other = await api(user, 'get', `/bookings/${made.id}/calendar${query}`).expect(200);
        expect(other.text).toContain('SUMMARY:Parking at');
      }
    });

    it('copes with a listing that has lost its name or address since', async () => {
      const user = await driver();
      const made = await booking(user, 'confirmed', { name: null, address: null });
      const response = await api(user, 'get', `/bookings/${made.id}/calendar`).expect(200);
      expect(response.text).toContain('SUMMARY:Parking\r\n');
      expect(response.text).not.toContain('LOCATION');
    });

    it('is the same 404 for a hold, a cancelled booking, another driver’s, and one that is not one', async () => {
      const [user, other] = [await driver(), await driver()];
      const [held, cancelled, mine] = [
        await booking(user, 'held'),
        await booking(user, 'cancelled'),
        await booking(user),
      ];
      for (const id of [held.id, cancelled.id, randomUUID(), 'not-a-uuid']) {
        const refused = await api(user, 'get', `/bookings/${id}/calendar`).expect(404);
        expect(refused.body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      }
      const stolen = await api(other, 'get', `/bookings/${mine.id}/calendar`).expect(404);
      expect(stolen.body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      expect(stolen.text).not.toContain(mine.reference);
    });
  });
});
