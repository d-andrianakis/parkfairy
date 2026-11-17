import { randomUUID } from 'node:crypto';

import {
  ADMIN_PAGE_SIZE,
  AdminOverstaySchema,
  AdminOverstaysSchema,
  OVERSTAY_NOTE_MAX,
  OVERSTAY_REPORT_DAYS,
  OwnerBookingListSchema,
  OwnerOverstaySchema,
} from '@parkfairy/contracts';
import { type Database, schema } from '@parkfairy/database';
import { and, eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newBookingReference } from '../src/bookings/booking-reference.js';
import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, type TestApp, type TestUser, updateUser } from './test-app.js';

// Overstays (5.2c4: #11, #76): an owner says a car stayed past its booking, staff close the report
// with a note. Recorded and triaged only: nothing moves, nobody is told.
const HERE = { latitude: 36.7213, longitude: 22.4291 };
const PREFIX = 'it-over-';
const tag = randomUUID().slice(0, 8);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const DETAILS = {
  kind: 'individual',
  firstName: 'Ελένη',
  lastName: 'Δοκιμή',
  phone: '+30 2721 000 000',
  addressLine: 'Αριστομένους 1',
  city: 'Καλαμάτα',
  postalCode: '241 00',
  country: 'GR',
};
const TAX = { taxCountry: 'GR', taxId: '094259216', birthDate: '1980-02-03' };
const REPORT = 'A grey Fiat is still in A1, two hours after its time.';
const TICKET = 'Ticket 7001, owner called back.';

describe('overstay reports (5.2c4: #11, #76)', () => {
  let app: TestApp;
  let db: Database;
  const users: TestUser[] = [];
  const visitors = new Map<string, string>();

  const call = (
    user: TestUser | null,
    method: 'get' | 'post' | 'put' | 'patch',
    path: string,
    origin: string | null = ORIGIN,
  ) => {
    const req = request(app.getHttpServer())[method](`/v1${path}`);
    if (method !== 'get' && origin) req.set('Origin', origin);
    if (!user) return req;
    let address = visitors.get(user.id);
    if (!address) {
      address = `198.75.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
      visitors.set(user.id, address);
    }
    return req.set('Cookie', user.cookie).set('X-Forwarded-For', address);
  };

  async function person(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }
  async function staff(): Promise<TestUser> {
    const user = await person();
    await updateUser(app, user.id, { role: 'admin', twoFactorEnabled: true });
    return user;
  }

  /** A live listing of a new owner. */
  async function listing(name: string) {
    const owner = await person();
    await call(owner, 'patch', '/owner/profile').send(DETAILS).expect(200);
    await call(owner, 'put', '/owner/profile/tax').send(TAX).expect(200);
    const [profile] = await db
      .select({ id: schema.ownerProfiles.id })
      .from(schema.ownerProfiles)
      .where(eq(schema.ownerProfiles.userId, owner.id));
    const ownerId = profile?.id ?? '';
    const [row] = await db
      .insert(schema.parkingLocations)
      .values({
        ownerId,
        slug: `${PREFIX}${tag}-${name}`,
        name: `Έλεγχος ${name}`,
        address: 'Οδός Δοκιμής 9, Καλαμάτα',
        areaId: 'syntagma',
        location: HERE,
        hourlyRateMinor: 200,
        bookingGapMinutes: 0,
        cancellationPolicy: 'oneDay',
        landRegistrationNumber: 'KAEK-1234',
        status: 'published',
        notifiedStatus: 'published',
        submittedAt: new Date(),
      })
      .returning({ id: schema.parkingLocations.id });
    const id = row?.id ?? '';
    await db.insert(schema.listingOwners).values({
      locationId: id,
      ownerId,
      role: 'primary',
      shareBps: 10_000,
      // Long before any stay here: an owner reads what ended after they joined (#35).
      createdAt: new Date(Date.now() - 60 * DAY_MS),
    });
    await db.insert(schema.parkingSpaces).values({ locationId: id, label: 'A1' });
    return { owner, id, ownerId };
  }

  /** A confirmed booking of `driver`'s that ended `endedHoursAgo` hours ago (negative: ends later). */
  async function booking(
    driver: TestUser,
    where: { id: string },
    endedHoursAgo: number,
    extra: Partial<typeof schema.bookings.$inferInsert> = {},
  ) {
    const endsAt = new Date(Date.now() - endedHoursAgo * HOUR_MS);
    const startsAt = new Date(endsAt.getTime() - 2 * HOUR_MS);
    const [row] = await db
      .insert(schema.bookings)
      .values({
        reference: newBookingReference(),
        userId: driver.id,
        locationId: where.id,
        listingName: 'Γκαράζ Έλεγχος',
        listingAddress: 'Οδός Δοκιμής 9, Καλαμάτα',
        spaceLabel: 'A1',
        listingLocale: 'el',
        startsAt,
        endsAt,
        gapMinutes: 0,
        blockedUntil: endsAt,
        status: 'confirmed',
        holdExpiresAt: new Date(Date.now() - 40 * DAY_MS),
        totalMinor: 400,
        currency: 'EUR',
        cancellationPolicy: 'oneDay',
        commissionBps: 1000,
        vehiclePlate: 'IKB1234',
        confirmedAt: new Date(startsAt.getTime() - DAY_MS),
        ...extra,
      })
      .returning({ id: schema.bookings.id, reference: schema.bookings.reference });
    return { id: row?.id ?? '', reference: row?.reference ?? '' };
  }

  const report = (user: TestUser | null, listingId: string, bookingId: string, body: unknown) =>
    call(user, 'post', `/owner/listings/${listingId}/bookings/${bookingId}/overstay`).send(
      body as object,
    );
  const reportOf = async (bookingId: string) => {
    const [row] = await db
      .select()
      .from(schema.overstayReports)
      .where(eq(schema.overstayReports.bookingId, bookingId));
    return row;
  };
  const bookingOf = async (id: string) => {
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    return row;
  };
  /** A report written straight into the table, for the queue's own tests. */
  async function filed(
    where: { id: string },
    reporter: TestUser,
    extra: Partial<typeof schema.overstayReports.$inferInsert> = {},
    endedHoursAgo = 5,
  ) {
    const made = await booking(await person(), where, endedHoursAgo);
    const [row] = await db
      .insert(schema.overstayReports)
      .values({
        bookingId: made.id,
        reportedBy: reporter.id,
        reportedAt: new Date(),
        note: REPORT,
        ...extra,
      })
      .returning({ id: schema.overstayReports.id });
    return { ...made, reportId: row?.id ?? '' };
  }
  const audited = (targetId: string) =>
    db
      .select({
        action: schema.auditLog.action,
        actorId: schema.auditLog.actorId,
        targetType: schema.auditLog.targetType,
        details: schema.auditLog.details,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, targetId))
      .orderBy(schema.auditLog.at);
  const mailed = (userIds: string[]) =>
    db
      .select({ kind: schema.emailOutbox.kind })
      .from(schema.emailOutbox)
      .where(inArray(schema.emailOutbox.userId, userIds));

  async function removeOurs() {
    const ours = await db
      .select({ id: schema.parkingLocations.id })
      .from(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    const ids = ours.map((found) => found.id);
    if (ids.length === 0) return;
    const bookings = await db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(inArray(schema.bookings.locationId, ids));
    const bookingIds = bookings.map((found) => found.id);
    if (bookingIds.length > 0) {
      await db
        .delete(schema.overstayReports)
        .where(inArray(schema.overstayReports.bookingId, bookingIds));
      await db
        .delete(schema.bookingPayees)
        .where(inArray(schema.bookingPayees.bookingId, bookingIds));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookingIds));
    }
    await db.delete(schema.listingManagers).where(inArray(schema.listingManagers.locationId, ids));
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
    // Staff who acted stay: the log restricts their accounts (#68), which is the point of it.
    const ids = users.map((user) => user.id);
    const acted = await db
      .select({ id: schema.auditLog.actorId })
      .from(schema.auditLog)
      .where(inArray(schema.auditLog.actorId, ids));
    const keep = new Set(acted.map((row) => row.id));
    const gone = ids.filter((id) => !keep.has(id));
    if (gone.length > 0) {
      await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.userId, gone));
      await db.delete(schema.ownerProfiles).where(inArray(schema.ownerProfiles.userId, gone));
      await db.delete(schema.users).where(inArray(schema.users.id, gone));
    }
    await app.close();
  });

  describe('who may report', () => {
    it('needs an account', async () => {
      await report(null, randomUUID(), randomUUID(), { note: REPORT }).expect(401);
    });

    it('refuses a write from another site on its origin, and records nothing', async () => {
      const where = await listing(`origin-${tag}`);
      const made = await booking(await person(), where, 3);
      await call(
        where.owner,
        'post',
        `/owner/listings/${where.id}/bookings/${made.id}/overstay`,
        'https://evil.example',
      )
        .send({ note: REPORT })
        .expect(403);
      expect(await reportOf(made.id)).toBeUndefined();
    });

    it('lets the primary owner report, and says when and that it is open', async () => {
      const where = await listing(`owner-${tag}`);
      const made = await booking(await person(), where, 3);
      const before = Date.now();
      const response = await report(where.owner, where.id, made.id, { note: REPORT }).expect(201);
      const said = OwnerOverstaySchema.parse(response.body);
      expect(said.status).toBe('open');
      expect(Math.abs(new Date(said.reportedAt).getTime() - before)).toBeLessThan(10_000);
      expect(await reportOf(made.id)).toMatchObject({
        reportedBy: where.owner.id,
        note: REPORT,
        status: 'open',
        resolvedBy: null,
        resolvedAt: null,
        resolution: null,
      });
    });

    it('lets a manager report, as they may cancel', async () => {
      const where = await listing(`manager-${tag}`);
      const manager = await person();
      await db.insert(schema.listingManagers).values({
        locationId: where.id,
        userId: manager.id,
        createdAt: new Date(Date.now() - 30 * DAY_MS),
      });
      const made = await booking(await person(), where, 3);
      await report(manager, where.id, made.id, { note: REPORT }).expect(201);
      expect((await reportOf(made.id))?.reportedBy).toBe(manager.id);
    });

    it('answers a stranger, a driver and another owner as it answers a listing that is not there', async () => {
      const where = await listing(`stranger-${tag}`);
      const other = await listing(`other-${tag}`);
      const driver = await person();
      const made = await booking(driver, where, 3);
      for (const who of [await person(), driver, other.owner]) {
        const response = await report(who, where.id, made.id, { note: REPORT }).expect(404);
        expect(response.body).toMatchObject({ code: 'LISTING_NOT_FOUND' });
      }
      const missing = await report(where.owner, randomUUID(), made.id, { note: REPORT }).expect(
        404,
      );
      expect(missing.body).toMatchObject({ code: 'LISTING_NOT_FOUND' });
      expect(await reportOf(made.id)).toBeUndefined();
    });

    it('answers 404 for a listing id that is no id at all', async () => {
      const where = await listing(`badid-${tag}`);
      const made = await booking(await person(), where, 3);
      const response = await report(where.owner, 'not-an-id', made.id, { note: REPORT }).expect(
        404,
      );
      expect(response.body).toMatchObject({ code: 'LISTING_NOT_FOUND' });
    });

    it("answers a booking of another listing as it answers one that isn't there", async () => {
      const where = await listing(`mine-${tag}`);
      const other = await listing(`theirs-${tag}`);
      const theirs = await booking(await person(), other, 3);
      for (const id of [theirs.id, randomUUID(), 'not-an-id']) {
        const response = await report(where.owner, where.id, id, { note: REPORT }).expect(404);
        expect(response.body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      }
      expect(await reportOf(theirs.id)).toBeUndefined();
    });

    it('does not let someone report a stay that ended before they were added to the listing', async () => {
      const where = await listing(`joined-${tag}`);
      const manager = await person();
      await db.insert(schema.listingManagers).values({ locationId: where.id, userId: manager.id });
      const before = await booking(await person(), where, 3);
      const response = await report(manager, where.id, before.id, { note: REPORT }).expect(404);
      expect(response.body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      expect(await reportOf(before.id)).toBeUndefined();
      // The owner, who was there, may.
      await report(where.owner, where.id, before.id, { note: REPORT }).expect(201);
    });
  });

  describe('which stays', () => {
    it('refuses a stay that is not over, however near its end', async () => {
      const where = await listing(`early-${tag}`);
      const driver = await person();
      for (const endedHoursAgo of [-30, -1, -0.01]) {
        const made = await booking(driver, where, endedHoursAgo);
        const response = await report(where.owner, where.id, made.id, { note: REPORT }).expect(409);
        expect(response.body).toMatchObject({ code: 'BOOKING_NOT_ENDED' });
        expect(await reportOf(made.id)).toBeUndefined();
      }
    });

    it('takes a report in the days after the end, and refuses one past the window', async () => {
      const where = await listing(`window-${tag}`);
      const driver = await person();
      const last = await booking(driver, where, OVERSTAY_REPORT_DAYS * 24 - 1);
      await report(where.owner, where.id, last.id, { note: REPORT }).expect(201);
      const late = await booking(driver, where, OVERSTAY_REPORT_DAYS * 24 + 1);
      const response = await report(where.owner, where.id, late.id, { note: REPORT }).expect(409);
      expect(response.body).toMatchObject({ code: 'OVERSTAY_TOO_LATE' });
      expect(await reportOf(late.id)).toBeUndefined();
    });

    it('agrees with the owners’ list at the edge of the window', async () => {
      const where = await listing(`edge-${tag}`);
      const driver = await person();
      const inside = await booking(driver, where, OVERSTAY_REPORT_DAYS * 24 - 1);
      const outside = await booking(driver, where, OVERSTAY_REPORT_DAYS * 24 + 1, {
        startsAt: new Date(Date.now() - (OVERSTAY_REPORT_DAYS * 24 + 3) * HOUR_MS),
      });
      const listed = OwnerBookingListSchema.parse(
        (
          await call(
            where.owner,
            'get',
            `/owner/bookings?status=past&listing=${where.id}&from=${new Date(Date.now() - 20 * DAY_MS).toISOString().slice(0, 10)}`,
          ).expect(200)
        ).body,
      ).bookings;
      expect(listed.find((item) => item.id === inside.id)?.canReportOverstay).toBe(true);
      expect(listed.find((item) => item.id === outside.id)?.canReportOverstay).toBe(false);
      await report(where.owner, where.id, inside.id, { note: REPORT }).expect(201);
      await report(where.owner, where.id, outside.id, { note: REPORT }).expect(409);
    });

    it('refuses a booking that was called off, and a hold that never booked', async () => {
      const where = await listing(`off-${tag}`);
      const driver = await person();
      const off = await booking(driver, where, 3, {
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelledAt: new Date(Date.now() - 20 * HOUR_MS),
        refundMinor: 400,
      });
      const hold = await booking(driver, where, 3, {
        status: 'expired',
        vehiclePlate: null,
        confirmedAt: null,
      });
      for (const made of [off, hold]) {
        const response = await report(where.owner, where.id, made.id, { note: REPORT }).expect(404);
        expect(response.body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
        expect(await reportOf(made.id)).toBeUndefined();
      }
    });

    it('takes one report to a booking, however many ask at once', async () => {
      const where = await listing(`once-${tag}`);
      const made = await booking(await person(), where, 3);
      const manager = await person();
      await db.insert(schema.listingManagers).values({
        locationId: where.id,
        userId: manager.id,
        createdAt: new Date(Date.now() - 30 * DAY_MS),
      });
      const answers = await Promise.all(
        [where.owner, manager, where.owner, manager].map((who) =>
          report(who, where.id, made.id, { note: REPORT }),
        ),
      );
      expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409, 409, 409]);
      for (const answer of answers.filter((found) => found.status === 409)) {
        expect(answer.body).toMatchObject({ code: 'OVERSTAY_REPORTED' });
      }
      const rows = await db
        .select({ id: schema.overstayReports.id })
        .from(schema.overstayReports)
        .where(eq(schema.overstayReports.bookingId, made.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe('what a report says', () => {
    it.each([
      ['nothing', {}],
      ['an empty note', { note: '' }],
      ['a note of spaces', { note: '   \n  ' }],
      [`a note over ${OVERSTAY_NOTE_MAX}`, { note: 'x'.repeat(OVERSTAY_NOTE_MAX + 1) }],
      ['a right-to-left override', { note: 'IKB‮1234' }],
      ['a zero-width space', { note: 'in​visible' }],
      ['a control character', { note: 'bell\u0007' }],
      ['a number', { note: 42 }],
      ['another key', { note: REPORT, status: 'resolved' }],
    ])('refuses %s', async (_label, body) => {
      const where = await listing(`bad-${tag}-${randomUUID().slice(0, 4)}`);
      const made = await booking(await person(), where, 3);
      await report(where.owner, where.id, made.id, body).expect(400);
      expect(await reportOf(made.id)).toBeUndefined();
    });

    it('keeps a note of the longest length, and trims it', async () => {
      const where = await listing(`long-${tag}`);
      const made = await booking(await person(), where, 3);
      const note = 'ö'.repeat(OVERSTAY_NOTE_MAX);
      await report(where.owner, where.id, made.id, { note: ` ${note} ` }).expect(201);
      expect((await reportOf(made.id))?.note).toBe(note);
    });

    it('moves no money and tells nobody: not the driver, not the owner', async () => {
      const where = await listing(`quiet-${tag}`);
      const driver = await person();
      const made = await booking(driver, where, 3, {
        paymentIntentId: `pi_it${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        paymentStatus: 'succeeded',
      });
      const before = await bookingOf(made.id);
      await report(where.owner, where.id, made.id, { note: REPORT }).expect(201);
      expect(await bookingOf(made.id)).toEqual(before);
      expect(await mailed([driver.id, where.owner.id])).toEqual([]);
    });
  });

  describe("the owners' list", () => {
    const listOf = async (user: TestUser, listingId: string, status = 'past') => {
      const response = await call(
        user,
        'get',
        `/owner/bookings?status=${status}&listing=${listingId}`,
      ).expect(200);
      return OwnerBookingListSchema.parse(response.body).bookings;
    };

    it('offers the report on a stay that is over, and says so once it is made', async () => {
      const where = await listing(`list-${tag}`);
      const made = await booking(await person(), where, 3);
      expect(await listOf(where.owner, where.id)).toEqual([
        expect.objectContaining({ id: made.id, overstay: null, canReportOverstay: true }),
      ]);
      await report(where.owner, where.id, made.id, { note: REPORT }).expect(201);
      const [item] = await listOf(where.owner, where.id);
      expect(item).toMatchObject({ id: made.id, canReportOverstay: false });
      expect(item?.overstay).toMatchObject({ status: 'open' });
    });

    it('offers nothing for a stay still going, one past the window or one called off', async () => {
      const where = await listing(`flags-${tag}`);
      const driver = await person();
      const under = await booking(driver, where, -1);
      const old = await booking(driver, where, OVERSTAY_REPORT_DAYS * 24 + 1);
      const off = await booking(driver, where, 3, {
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelledAt: new Date(Date.now() - 20 * HOUR_MS),
        refundMinor: 400,
      });
      const past = await listOf(where.owner, where.id);
      expect(past.find((item) => item.id === old.id)).toMatchObject({ canReportOverstay: false });
      expect(past.find((item) => item.id === under.id)).toBeUndefined();
      const upcoming = await listOf(where.owner, where.id, 'upcoming');
      expect(upcoming.find((item) => item.id === under.id)).toMatchObject({
        canReportOverstay: false,
      });
      const cancelled = await listOf(where.owner, where.id, 'cancelled');
      expect(cancelled.find((item) => item.id === off.id)).toMatchObject({
        canReportOverstay: false,
        overstay: null,
      });
    });

    it("shows a closed report as closed, and never staff's note", async () => {
      const admin = await staff();
      const where = await listing(`closed-${tag}`);
      const made = await booking(await person(), where, 3);
      await report(where.owner, where.id, made.id, { note: REPORT }).expect(201);
      const row = await reportOf(made.id);
      await call(admin, 'post', `/admin/overstays/${row?.id}/resolve`)
        .send({ note: TICKET })
        .expect(200);
      const [item] = await listOf(where.owner, where.id);
      expect(item?.overstay).toMatchObject({ status: 'resolved' });
      expect(JSON.stringify(item)).not.toContain('7001');
    });
  });

  describe('the staff routes: who may', () => {
    const paths = [
      ['get', '/admin/overstays'],
      ['get', `/admin/overstays/${randomUUID()}`],
      ['post', `/admin/overstays/${randomUUID()}/resolve`],
    ] as const;

    it.each(paths)('needs an account for %s %s', async (method, path) => {
      await call(null, method, path).send({ note: TICKET }).expect(401);
    });

    it.each(paths)('is not for an ordinary account: %s %s', async (method, path) => {
      await call(await person(), method, path)
        .send({ note: TICKET })
        .expect(403);
    });

    it.each(paths)('needs a second factor of an admin: %s %s', async (method, path) => {
      const user = await person();
      await updateUser(app, user.id, { role: 'admin' });
      const response = await call(user, method, path).send({ note: TICKET }).expect(403);
      expect(response.body).toMatchObject({ code: 'MFA_REQUIRED' });
    });

    it("is not for a listing's owner reading the queue", async () => {
      const where = await listing(`owner-queue-${tag}`);
      await call(where.owner, 'get', '/admin/overstays').expect(403);
    });

    it('refuses a write from another site on its origin, and changes nothing', async () => {
      const admin = await staff();
      const where = await listing(`resolve-origin-${tag}`);
      const made = await filed(where, where.owner);
      await call(admin, 'post', `/admin/overstays/${made.reportId}/resolve`, 'https://evil.example')
        .send({ note: TICKET })
        .expect(403);
      expect((await reportOf(made.id))?.status).toBe('open');
    });
  });

  describe('the queue', () => {
    const queue = (admin: TestUser, query = '') => call(admin, 'get', `/admin/overstays${query}`);
    /** Every report of a status, page by page: the queue is shared with every other test. */
    async function walk(admin: TestUser, status: string) {
      const found: ReturnType<typeof AdminOverstaysSchema.parse>['reports'] = [];
      let after: string | null = null;
      for (let pages = 0; pages < 200; pages++) {
        const page = AdminOverstaysSchema.parse(
          (await queue(admin, `?status=${status}${after ? `&after=${after}` : ''}`).expect(200))
            .body,
        );
        found.push(...page.reports);
        after = page.next;
        if (!after) break;
      }
      return found;
    }

    it('lists open reports oldest first, with no driver, plate or note on a row', async () => {
      const admin = await staff();
      const where = await listing(`queue-${tag}`);
      const early = await filed(where, where.owner, { reportedAt: new Date(Date.now() - 5000) });
      const late = await filed(where, where.owner, { reportedAt: new Date(Date.now() - 1000) });
      const response = await queue(admin).expect(200);
      const reports = await walk(admin, 'open');
      const ours = reports.filter((row) => [early.id, late.id].includes(row.bookingId));
      expect(ours.map((row) => row.bookingId)).toEqual([early.id, late.id]);
      expect(ours[0]).toMatchObject({
        id: early.reportId,
        status: 'open',
        reference: early.reference,
        listingName: 'Γκαράζ Έλεγχος',
        contentLocale: 'el',
      });
      expect(response.headers['cache-control']).toContain('no-store');
      const text = JSON.stringify(response.body);
      expect(text).not.toContain('IKB1234');
      expect(text).not.toContain('grey Fiat');
    });

    it('pages by place, every report once, in order', { timeout: 120_000 }, async () => {
      const admin = await staff();
      const where = await listing(`pages-${tag}`);
      const base = Date.now() - 3 * DAY_MS;
      const made: string[] = [];
      for (let index = 0; index < ADMIN_PAGE_SIZE + 3; index++) {
        // Three at the same millisecond: the place is the time and the id.
        const at = new Date(base + Math.floor(index / 3) * 1000);
        made.push((await filed(where, where.owner, { reportedAt: at })).id);
      }
      const seen: string[] = [];
      let after: string | null = null;
      for (let pages = 0; pages < 100; pages++) {
        const response = await queue(admin, after ? `?after=${after}` : '').expect(200);
        const page = AdminOverstaysSchema.parse(response.body);
        expect(page.reports.length).toBeLessThanOrEqual(ADMIN_PAGE_SIZE);
        seen.push(...page.reports.map((row) => row.bookingId));
        after = page.next;
        if (!after) break;
      }
      expect(after).toBeNull();
      const ours = seen.filter((id) => made.includes(id));
      expect(new Set(ours).size).toBe(made.length);
      expect(ours).toHaveLength(made.length);
      expect(seen.length).toBe(new Set(seen).size);
    });

    it('lists the closed ones apart from the open', async () => {
      const admin = await staff();
      const where = await listing(`split-${tag}`);
      const open = await filed(where, where.owner);
      const closed = await filed(where, where.owner);
      await call(admin, 'post', `/admin/overstays/${closed.reportId}/resolve`)
        .send({ note: TICKET })
        .expect(200);
      const bookingIds = async (status: string) =>
        (await walk(admin, status))
          .map((row) => row.bookingId)
          .filter((id) => [open.id, closed.id].includes(id));
      expect(await bookingIds('open')).toEqual([open.id]);
      expect(await bookingIds('resolved')).toEqual([closed.id]);
    });

    it.each(['?status=all', '?status=', '?after=nonsense', '?after=1_x'])(
      'refuses the query %s',
      async (query) => {
        await queue(await staff(), query).expect(400);
      },
    );
  });

  describe('one report', () => {
    const open = (admin: TestUser, id: string) => call(admin, 'get', `/admin/overstays/${id}`);

    it('shows who reported it and what they wrote, the stay, and what staff may do', async () => {
      const admin = await staff();
      const where = await listing(`one-${tag}`);
      await updateUser(app, where.owner.id, { name: 'Olga Reporter' });
      const made = await filed(where, where.owner);
      const response = await open(admin, made.reportId).expect(200);
      expect(AdminOverstaySchema.parse(response.body)).toMatchObject({
        id: made.reportId,
        status: 'open',
        note: REPORT,
        reporter: { name: 'Olga Reporter' },
        booking: {
          id: made.id,
          reference: made.reference,
          listing: { id: where.id, name: 'Γκαράζ Έλεγχος', contentLocale: 'el' },
          spaceLabel: 'A1',
        },
        resolution: null,
        canResolve: true,
        own: false,
      });
      expect(response.headers['cache-control']).toContain('no-store');
    });

    it("keeps the driver off it: their page is the booking's, and opening that is logged", async () => {
      const admin = await staff();
      const where = await listing(`driver-${tag}`);
      const made = await filed(where, where.owner);
      const text = JSON.stringify((await open(admin, made.reportId).expect(200)).body);
      expect(text).not.toContain('IKB1234');
      expect(text).not.toContain('@');
      expect(await audited(made.id)).toEqual([]);
    });

    it('answers 404 for what is no report', async () => {
      const admin = await staff();
      for (const id of ['not-an-id', randomUUID()]) {
        const response = await open(admin, id).expect(404);
        expect(response.body).toMatchObject({ code: 'OVERSTAY_NOT_FOUND' });
      }
    });

    it('says own for a listing the reader manages, and offers them no closing', async () => {
      const admin = await staff();
      const where = await listing(`own-view-${tag}`);
      await db.insert(schema.listingManagers).values({ locationId: where.id, userId: admin.id });
      const made = await filed(where, where.owner);
      expect((await open(admin, made.reportId).expect(200)).body).toMatchObject({
        canResolve: false,
        own: true,
      });
    });
  });

  describe('closing a report', () => {
    const resolve = (admin: TestUser, id: string, body: unknown = { note: TICKET }) =>
      call(admin, 'post', `/admin/overstays/${id}/resolve`).send(body as object);

    it('closes it with the note, says who and when, and writes the log in the same go', async () => {
      const admin = await staff();
      await updateUser(app, admin.id, { name: 'Sam Closer' });
      const where = await listing(`close-${tag}`);
      await updateUser(app, where.owner.id, { name: 'Olga Reporter' });
      const made = await filed(where, where.owner);
      const response = await resolve(admin, made.reportId, { note: ` ${TICKET} ` }).expect(200);
      expect(AdminOverstaySchema.parse(response.body)).toMatchObject({
        status: 'resolved',
        canResolve: false,
        resolution: { note: TICKET, by: { name: 'Sam Closer' } },
      });
      expect(await reportOf(made.id)).toMatchObject({
        status: 'resolved',
        resolvedBy: admin.id,
        resolution: TICKET,
      });
      expect((await reportOf(made.id))?.resolvedAt).toBeInstanceOf(Date);
      expect(await audited(made.id)).toEqual([
        {
          action: 'overstay.resolved',
          actorId: admin.id,
          targetType: 'booking',
          details: { reference: made.reference, note: TICKET },
        },
      ]);
      expect(response.headers['cache-control']).toContain('no-store');
    });

    it('moves no money and tells nobody', async () => {
      const admin = await staff();
      const where = await listing(`close-quiet-${tag}`);
      const made = await filed(where, where.owner);
      const before = await bookingOf(made.id);
      await resolve(admin, made.reportId).expect(200);
      expect(await bookingOf(made.id)).toEqual(before);
      expect(await mailed([before?.userId ?? '', where.owner.id, admin.id])).toEqual([]);
    });

    it('closes a report once: the second says so and writes no second line', async () => {
      const admin = await staff();
      const where = await listing(`twice-${tag}`);
      const made = await filed(where, where.owner);
      await resolve(admin, made.reportId).expect(200);
      const again = await resolve(await staff(), made.reportId, {
        note: 'A different note.',
      }).expect(409);
      expect(again.body).toMatchObject({ code: 'ALREADY_RESOLVED' });
      expect((await reportOf(made.id))?.resolution).toBe(TICKET);
      expect(await audited(made.id)).toHaveLength(1);
    });

    it('lets one of several admins at once close it, and writes one line', async () => {
      const where = await listing(`race-${tag}`);
      const made = await filed(where, where.owner);
      const admins = await Promise.all([staff(), staff(), staff(), staff()]);
      const answers = await Promise.all(
        admins.map((admin) =>
          resolve(admin, made.reportId, { note: `Ticket ${admin.id.slice(0, 8)}` }),
        ),
      );
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409, 409, 409]);
      const lines = await audited(made.id);
      expect(lines).toHaveLength(1);
      expect((await reportOf(made.id))?.resolvedBy).toBe(lines[0]?.actorId);
    });

    it('refuses a report about a listing the admin owns, manages or co-owns, and changes nothing', async () => {
      const admin = await staff();
      const where = await listing(`own-${tag}`);
      await db.insert(schema.listingManagers).values({ locationId: where.id, userId: admin.id });
      const made = await filed(where, where.owner);
      const response = await resolve(admin, made.reportId).expect(403);
      expect(response.body).toMatchObject({ code: 'OWN_LISTING' });
      expect((await reportOf(made.id))?.status).toBe('open');
      expect(await audited(made.id)).toEqual([]);
      // Someone else on the staff may.
      await resolve(await staff(), made.reportId).expect(200);
    });

    it('refuses a report about a listing the admin co-owns', async () => {
      const admin = await staff();
      const where = await listing(`coown-${tag}`);
      await call(admin, 'patch', '/owner/profile').send(DETAILS).expect(200);
      const [profile] = await db
        .select({ id: schema.ownerProfiles.id })
        .from(schema.ownerProfiles)
        .where(eq(schema.ownerProfiles.userId, admin.id));
      await db.insert(schema.listingOwners).values({
        locationId: where.id,
        ownerId: profile?.id ?? '',
        role: 'co_owner',
        shareBps: 0,
      });
      const made = await filed(where, where.owner);
      const response = await resolve(admin, made.reportId).expect(403);
      expect(response.body).toMatchObject({ code: 'OWN_LISTING' });
    });

    it('refuses a report the admin made themselves as an owner', async () => {
      const where = await listing(`self-${tag}`);
      const admin = where.owner;
      await updateUser(app, admin.id, { role: 'admin', twoFactorEnabled: true });
      const made = await filed(where, admin);
      const response = await resolve(admin, made.reportId).expect(403);
      expect(response.body).toMatchObject({ code: 'OWN_LISTING' });
    });

    it('refuses a report the admin made, even once they no longer run the listing', async () => {
      const admin = await staff();
      const where = await listing(`former-${tag}`);
      const made = await filed(where, admin);
      const view = await call(admin, 'get', `/admin/overstays/${made.reportId}`).expect(200);
      expect(view.body).toMatchObject({ canResolve: false, own: true });
      const response = await resolve(admin, made.reportId).expect(403);
      expect(response.body).toMatchObject({ code: 'OWN_LISTING' });
      expect((await reportOf(made.id))?.status).toBe('open');
      expect(await audited(made.id)).toEqual([]);
    });

    it('answers 404 for what is no report', async () => {
      const admin = await staff();
      for (const id of ['not-an-id', randomUUID()]) {
        const response = await resolve(admin, id).expect(404);
        expect(response.body).toMatchObject({ code: 'OVERSTAY_NOT_FOUND' });
      }
    });

    it.each([
      ['nothing', {}],
      ['an empty note', { note: '' }],
      ['a note of spaces', { note: '   ' }],
      ['a note over 100', { note: 'x'.repeat(101) }],
      ['a right-to-left override', { note: 'ok‮' }],
      ['a zero-width joiner', { note: 'a‍b' }],
      ['another key', { note: TICKET, status: 'open' }],
    ])('refuses %s, and leaves the report open', async (_label, body) => {
      const admin = await staff();
      const where = await listing(`note-${tag}-${randomUUID().slice(0, 4)}`);
      const made = await filed(where, where.owner);
      await resolve(admin, made.reportId, body).expect(400);
      expect((await reportOf(made.id))?.status).toBe('open');
      expect(await audited(made.id)).toEqual([]);
    });
  });

  describe('the table', () => {
    it('refuses a second report to a booking, by name', async () => {
      const where = await listing(`unique-${tag}`);
      const made = await filed(where, where.owner);
      await expect(
        db.insert(schema.overstayReports).values({
          bookingId: made.id,
          reportedBy: where.owner.id,
          reportedAt: new Date(),
          note: 'x',
        }),
      ).rejects.toMatchObject({
        cause: { constraint: 'overstay_reports_booking_id_unique' },
      });
    });

    it.each([
      ['an empty note', { note: '' }, 'overstay_reports_note_check'],
      [
        'a note too long',
        { note: 'x'.repeat(OVERSTAY_NOTE_MAX + 1) },
        'overstay_reports_note_check',
      ],
      ['an unknown status', { status: 'closed' as never }, 'overstay_reports_status_check'],
      [
        'closed with nobody to have closed it',
        { status: 'resolved' as const },
        'overstay_reports_resolution_check',
      ],
      ['open yet with a resolution', { resolution: 'done' }, 'overstay_reports_resolution_check'],
    ])('refuses %s, by name', async (_label, extra, constraint) => {
      const where = await listing(`check-${tag}-${randomUUID().slice(0, 4)}`);
      const made = await booking(await person(), where, 3);
      await expect(
        db.insert(schema.overstayReports).values({
          bookingId: made.id,
          reportedBy: where.owner.id,
          reportedAt: new Date(),
          note: 'ok',
          ...extra,
        }),
      ).rejects.toMatchObject({ cause: { constraint } });
    });

    it('restricts deleting a booking that has a report, and an account that made one', async () => {
      const where = await listing(`restrict-${tag}`);
      const made = await filed(where, where.owner);
      await expect(
        db.delete(schema.bookings).where(eq(schema.bookings.id, made.id)),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
      await expect(
        db.delete(schema.users).where(and(eq(schema.users.id, where.owner.id))),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });
  });
});
