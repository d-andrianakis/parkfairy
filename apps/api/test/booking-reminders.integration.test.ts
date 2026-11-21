import { randomUUID } from 'node:crypto';

import { BOOKING_REMINDER_MINUTES } from '@parkfairy/contracts';
import {
  type Database,
  enqueueBookingReminders,
  reminderStillDue,
  schema,
} from '@parkfairy/database';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, type TestApp, type TestUser, updateUser } from './test-app.js';

// The drivers' reminders (5A.3): "starting soon" and "ending soon", once each, for a driver who kept
// them on, for a stay confirmed before the reminder's time. The sweep is a statement; these drive it.
const HERE = { latitude: 35.5, longitude: 24.0 };
const PREFIX = 'it-remind-';
const tag = randomUUID().slice(0, 8);
const MINUTE_MS = 60_000;
const { starting, ending } = BOOKING_REMINDER_MINUTES;

describe('booking reminders (5A.3)', () => {
  let app: TestApp;
  let db: Database;
  let listingId: string;
  const users: TestUser[] = [];

  async function driver(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }

  /** A confirmed booking `from` minutes from now for `length` minutes, confirmed `confirmedAgo` minutes ago. */
  async function booking(
    user: TestUser,
    from: number,
    {
      length = 120,
      confirmedAgo = 24 * 60,
      status = 'confirmed',
    }: {
      length?: number;
      confirmedAgo?: number;
      status?: 'confirmed' | 'cancelled' | 'held' | 'expired' | 'released';
    } = {},
  ) {
    // A space of its own: two stays on one would meet the exclusion constraint.
    const [space] = await db
      .insert(schema.parkingSpaces)
      .values({ locationId: listingId, label: `S${randomUUID().slice(0, 8)}` })
      .returning({ id: schema.parkingSpaces.id, label: schema.parkingSpaces.label });
    const startsAt = new Date(Date.now() + from * MINUTE_MS);
    const endsAt = new Date(startsAt.getTime() + length * MINUTE_MS);
    const [row] = await db
      .insert(schema.bookings)
      .values({
        reference: `T${randomUUID().slice(0, 3)}-${randomUUID().slice(0, 4)}`.toUpperCase(),
        userId: user.id,
        locationId: listingId,
        spaceId: space?.id ?? null,
        spaceLabel: space?.label ?? '',
        listingName: 'Γκαράζ υπενθυμίσεων',
        listingAddress: 'Οδός Δοκιμής 9, Χανιά',
        listingLocale: 'el',
        startsAt,
        endsAt,
        gapMinutes: 0,
        blockedUntil: endsAt,
        status,
        holdExpiresAt: new Date(),
        totalMinor: 400,
        currency: 'EUR',
        cancellationPolicy: 'oneDay',
        vehiclePlate: 'IKB1234',
        confirmedAt: new Date(Date.now() - confirmedAgo * MINUTE_MS),
        commissionBps: 1000,
        ...(status === 'cancelled'
          ? { cancelledAt: new Date(), cancelledBy: 'driver' as const, refundMinor: 400 }
          : {}),
      })
      .returning({ id: schema.bookings.id });
    return row?.id ?? '';
  }

  const emailsOf = (user: TestUser) =>
    db
      .select({
        kind: schema.emailOutbox.kind,
        payload: schema.emailOutbox.payload,
        key: schema.emailOutbox.dedupeKey,
      })
      .from(schema.emailOutbox)
      .where(
        and(
          eq(schema.emailOutbox.userId, user.id),
          inArray(schema.emailOutbox.kind, ['booking-starting-soon', 'booking-ending-soon']),
        ),
      );

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
        name: 'Γκαράζ υπενθυμίσεων',
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
    await db.delete(schema.emailOutbox).where(
      inArray(
        schema.emailOutbox.userId,
        users.map((user) => user.id),
      ),
    );
    await app.close();
  });

  it('reminds a driver once as a stay is about to start, and not again', async () => {
    const user = await driver();
    const id = await booking(user, starting - 10);
    await enqueueBookingReminders(db);
    const [email, ...rest] = await emailsOf(user);
    expect(rest).toEqual([]);
    expect(email).toMatchObject({
      kind: 'booking-starting-soon',
      key: `booking-starting-soon:${id}`,
    });
    // No plate, no way in, no person: what an email about a booking may say.
    expect(JSON.stringify(email?.payload)).not.toMatch(/IKB1234|vehicle|arrival|name":"Test/);
    expect(email?.payload.booking).toMatchObject({
      id,
      spaceLabel: expect.any(String) as string,
      timeZone: 'Europe/Athens',
      totalMinor: 400,
    });
    expect(await enqueueBookingReminders(db)).toBe(0);
    expect(await emailsOf(user)).toHaveLength(1);
  });

  it('reminds of the end once the stay is under way, and not of the start then', async () => {
    const user = await driver();
    const id = await booking(user, -(120 - (ending - 5)));
    await enqueueBookingReminders(db);
    expect((await emailsOf(user)).map((email) => email.key)).toEqual([`booking-ending-soon:${id}`]);
  });

  it('leaves a stay that is further off, or already over, alone', async () => {
    const user = await driver();
    await booking(user, starting + 30);
    await booking(user, -400, { length: 60 });
    await booking(user, -(120 + 5), { length: 120 });
    await booking(user, -10, { length: 24 * 60 });
    await enqueueBookingReminders(db);
    expect(await emailsOf(user)).toEqual([]);
  });

  it('sends none for a stay booked closer than the reminder’s time', async () => {
    const user = await driver();
    // Starts within two hours, but was confirmed 30 minutes ago: the confirmation is the notice.
    await booking(user, 60, { confirmedAgo: 30 });
    // Under way and ending within half an hour, but confirmed five minutes ago, inside that half hour.
    await booking(user, -100, { confirmedAgo: 5 });
    await enqueueBookingReminders(db);
    expect(await emailsOf(user)).toEqual([]);
  });

  it('writes the stay as ISO instants in UTC, the way the email renders them, with the facts of the booking', async () => {
    const user = await driver();
    const id = await booking(user, starting - 15);
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    await enqueueBookingReminders(db);
    const [email] = await emailsOf(user);
    expect(email?.payload.booking).toMatchObject({
      id,
      listingId,
      reference: row?.reference,
      address: 'Οδός Δοκιμής 9, Χανιά',
      contentLocale: 'el',
      start: row?.startsAt.toISOString(),
      end: row?.endsAt.toISOString(),
      currency: 'EUR',
    });
    expect(email?.payload).toMatchObject({
      listingName: 'Γκαράζ υπενθυμίσεων',
      contentLocale: 'el',
    });
  });

  it('keeps to the windows: a stay a little past either is left for later', async () => {
    const user = await driver();
    await booking(user, starting + 10);
    // Under way, ending in 40 minutes: past the half hour.
    await booking(user, -(120 - (ending + 10)));
    await enqueueBookingReminders(db);
    expect(await emailsOf(user)).toEqual([]);
  });

  it('counts a stay confirmed exactly the reminder’s lead before it as early enough', async () => {
    const user = await driver();
    const id = await booking(user, starting - 5, { confirmedAgo: 24 * 60 });
    // Confirmed two hours (to the minute) before its start: the boundary, which is allowed.
    await db
      .update(schema.bookings)
      .set({
        confirmedAt: sql`${schema.bookings.startsAt} - make_interval(mins => ${starting})`,
      })
      .where(eq(schema.bookings.id, id));
    await enqueueBookingReminders(db);
    expect(await emailsOf(user)).toHaveLength(1);
  });

  it.each(['held', 'expired', 'released'] as const)(
    'sends none for a booking that is %s',
    async (status) => {
      const user = await driver();
      await booking(user, starting - 10, { status });
      await enqueueBookingReminders(db);
      expect(await emailsOf(user)).toEqual([]);
    },
  );

  it('queues each reminder once when two sweeps run at the same time', async () => {
    const user = await driver();
    await booking(user, starting - 10);
    await booking(user, -(120 - (ending - 5)));
    await Promise.all([enqueueBookingReminders(db), enqueueBookingReminders(db)]);
    expect((await emailsOf(user)).map((email) => email.kind).sort()).toEqual([
      'booking-ending-soon',
      'booking-starting-soon',
    ]);
  });

  describe('when it comes to be sent', () => {
    it('is still due while the stay is ahead and the booking stands', async () => {
      const user = await driver();
      const id = await booking(user, starting - 10);
      expect(await reminderStillDue(db, 'booking-starting-soon', id)).toBe(true);
      const ending2 = await booking(user, -(120 - (ending - 5)));
      expect(await reminderStillDue(db, 'booking-ending-soon', ending2)).toBe(true);
    });

    it('is not once the stay has begun (starting) or ended (ending), or the booking is called off', async () => {
      const user = await driver();
      const begun = await booking(user, -10);
      expect(await reminderStillDue(db, 'booking-starting-soon', begun)).toBe(false);
      const over = await booking(user, -300, { length: 60 });
      expect(await reminderStillDue(db, 'booking-ending-soon', over)).toBe(false);
      const called = await booking(user, starting - 10);
      await db
        .update(schema.bookings)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: 'driver',
          refundMinor: 0,
        })
        .where(eq(schema.bookings.id, called));
      expect(await reminderStillDue(db, 'booking-starting-soon', called)).toBe(false);
    });

    it('is never due without its booking, and any other email is always due', async () => {
      expect(await reminderStillDue(db, 'booking-ending-soon', undefined)).toBe(false);
      expect(await reminderStillDue(db, 'booking-confirmed', undefined)).toBe(true);
      expect(await reminderStillDue(db, 'listing-approved', undefined)).toBe(true);
    });
  });

  it('sends none for a booking called off, or to a driver who turned the reminders off', async () => {
    const [cancelled, quiet] = [await driver(), await driver()];
    await booking(cancelled, starting - 10, { status: 'cancelled' });
    await updateUser(app, quiet.id, { reminderEmails: false });
    await booking(quiet, starting - 10);
    await enqueueBookingReminders(db);
    expect(await emailsOf(cancelled)).toEqual([]);
    expect(await emailsOf(quiet)).toEqual([]);
  });

  it('sends none to a suspended account', async () => {
    const user = await driver();
    await updateUser(app, user.id, { suspendedAt: new Date() });
    await booking(user, starting - 10);
    await enqueueBookingReminders(db);
    expect(await emailsOf(user)).toEqual([]);
  });

  it('is not defeated by many already queued: a new booking still gets its reminder', async () => {
    const user = await driver();
    const first = await booking(user, starting - 30);
    await enqueueBookingReminders(db);
    const second = await booking(user, starting - 20);
    await enqueueBookingReminders(db);
    expect((await emailsOf(user)).map((email) => email.key).sort()).toEqual(
      [`booking-starting-soon:${first}`, `booking-starting-soon:${second}`].sort(),
    );
  });
});
