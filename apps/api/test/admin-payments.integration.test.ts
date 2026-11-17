import { randomUUID } from 'node:crypto';

import {
  ADMIN_PAYMENTS_LIST_MAX,
  AdminBookingSchema,
  AdminPaymentsSchema,
} from '@parkfairy/contracts';
import {
  type Database,
  lostDisputesHeld,
  markTransferSending,
  recordDispute,
  refundsOwed,
  schema,
  transferHeld,
} from '@parkfairy/database';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newBookingReference } from '../src/bookings/booking-reference.js';
import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, type TestApp, type TestUser, updateUser } from './test-app.js';

// Support and money (5.2c3: #82–#85): a booking found by its reference and called off with a full
// refund, a refund that failed retried or settled, and a lost dispute decided either way.
const HERE = { latitude: 36.7213, longitude: 22.4291 };
const PREFIX = 'it-pay-';
const tag = randomUUID().slice(0, 8);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
const HOUR_MS = 3_600_000;
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
const TICKET = 'Ticket 4821, driver called.';

describe('support and money (5.2c3: #82–#85)', () => {
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
      address = `198.74.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
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
    await db
      .insert(schema.listingOwners)
      .values({ locationId: id, ownerId, role: 'primary', shareBps: 10_000 });
    await db.insert(schema.parkingSpaces).values({ locationId: id, label: 'A1' });
    return { owner, id, ownerId };
  }

  /** A paid, confirmed booking of `driver`'s, paying `ownerId` its whole share. */
  async function booking(
    driver: TestUser,
    where: { id: string; ownerId: string },
    startsInHours: number,
    extra: Partial<typeof schema.bookings.$inferInsert> = {},
  ) {
    const startsAt = new Date(Date.now() + startsInHours * HOUR_MS);
    const endsAt = new Date(startsAt.getTime() + 2 * HOUR_MS);
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
        holdExpiresAt: new Date(Date.now() - HOUR_MS),
        totalMinor: 400,
        currency: 'EUR',
        cancellationPolicy: 'oneDay',
        commissionBps: 1000,
        vehiclePlate: 'IKB1234',
        confirmedAt: new Date(Date.now() - 24 * HOUR_MS),
        paymentIntentId: `pi_it${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        paymentStatus: 'succeeded',
        stripeChargeId: `ch_it${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        ...extra,
      })
      .returning({ id: schema.bookings.id, reference: schema.bookings.reference });
    const id = row?.id ?? '';
    await db
      .insert(schema.bookingPayees)
      .values({ bookingId: id, ownerId: where.ownerId, shareBps: 10_000 });
    return { id, reference: row?.reference ?? '' };
  }
  /** A booking whose refund Stripe took and then failed (a closed card). */
  const failedRefund = (
    driver: TestUser,
    where: { id: string; ownerId: string },
    extra: Partial<typeof schema.bookings.$inferInsert> = {},
  ) =>
    booking(driver, where, -30, {
      status: 'cancelled',
      cancelledAt: new Date(Date.now() - 40 * HOUR_MS),
      cancelledBy: 'driver',
      refundMinor: 400,
      refundStatus: 'failed',
      stripeRefundId: `re_it${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      ...extra,
    });

  const bookingOf = async (id: string) => {
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    return row;
  };
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
  const changes = async (id: string) =>
    (await audited(id)).filter((line) => !line.action.endsWith('viewed'));
  const mailed = (userId: string) =>
    db
      .select({ kind: schema.emailOutbox.kind })
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.userId, userId))
      .orderBy(schema.emailOutbox.createdAt, schema.emailOutbox.kind);
  const disputeOn = async (
    bookingId: string,
    extra: Partial<typeof schema.paymentDisputes.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(schema.paymentDisputes)
      .values({
        bookingId,
        stripeDisputeId: `dp_it${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        status: 'lost',
        reason: 'fraudulent',
        amountMinor: 400,
        currency: 'EUR',
        ...extra,
      })
      .returning({ id: schema.paymentDisputes.id });
    return row?.id ?? '';
  };

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
        .delete(schema.paymentDisputes)
        .where(inArray(schema.paymentDisputes.bookingId, bookingIds));
      await db
        .delete(schema.bookingPayees)
        .where(inArray(schema.bookingPayees.bookingId, bookingIds));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookingIds));
    }
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
    const decided = await db
      .select({ id: schema.paymentDisputes.decidedBy })
      .from(schema.paymentDisputes)
      .where(inArray(schema.paymentDisputes.decidedBy, ids));
    const keep = new Set([...acted.map((row) => row.id), ...decided.map((row) => row.id)]);
    const gone = ids.filter((id) => !keep.has(id));
    if (gone.length > 0) {
      await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.userId, gone));
      await db.delete(schema.ownerProfiles).where(inArray(schema.ownerProfiles.userId, gone));
      await db.delete(schema.users).where(inArray(schema.users.id, gone));
    }
    await app.close();
  });

  describe('who may', () => {
    const paths = [
      ['post', '/admin/bookings/lookup'],
      ['get', `/admin/bookings/${randomUUID()}`],
      ['post', `/admin/bookings/${randomUUID()}/cancel`],
      ['post', `/admin/bookings/${randomUUID()}/refund/retry`],
      ['post', `/admin/bookings/${randomUUID()}/refund/settle`],
      ['get', '/admin/payments'],
      ['post', `/admin/disputes/${randomUUID()}/decide`],
    ] as const;
    const body = { note: TICKET, reference: 'ABCD-EFGH', decision: 'owners_bear' };

    it.each(paths)('needs an account for %s %s', async (method, path) => {
      await call(null, method, path).send(body).expect(401);
    });

    it.each(paths)('is not for an ordinary account: %s %s', async (method, path) => {
      const user = await person();
      await call(user, method, path).send(body).expect(403);
    });

    it.each(paths)('needs a second factor of an admin: %s %s', async (method, path) => {
      const user = await person();
      await updateUser(app, user.id, { role: 'admin' });
      const response = await call(user, method, path).send(body).expect(403);
      expect(response.body).toMatchObject({ code: 'MFA_REQUIRED' });
    });

    it('refuses a write from another site on its origin, and changes nothing', async () => {
      const admin = await staff();
      const where = await listing(`origin-${tag}`);
      const driver = await person();
      const made = await booking(driver, where, 30);
      await call(admin, 'post', `/admin/bookings/${made.id}/cancel`, 'https://evil.example')
        .send({ note: TICKET })
        .expect(403);
      expect((await bookingOf(made.id))?.status).toBe('confirmed');
    });
  });

  describe('finding a booking (#85)', () => {
    const lookUp = (admin: TestUser, body: unknown) =>
      call(admin, 'post', '/admin/bookings/lookup').send(body as object);

    it('finds the id behind a reference, in any case, and nothing else', async () => {
      const admin = await staff();
      const where = await listing(`find-${tag}`);
      const made = await booking(await person(), where, 30);
      const response = await lookUp(admin, {
        reference: ` ${made.reference.toLowerCase()} `,
      }).expect(200);
      expect(response.body).toEqual({ id: made.id });
      expect(response.headers['cache-control']).toContain('no-store');
    });

    it('answers none for a reference nobody has, and refuses what is not one', async () => {
      const admin = await staff();
      expect((await lookUp(admin, { reference: 'AAAA-AAAA' }).expect(200)).body).toEqual({
        id: null,
      });
      for (const reference of ['', 'abc', 'AAAA-AAA', 'AAAA AAAA', '%', 42, null]) {
        await lookUp(await staff(), { reference }).expect(400);
      }
      await lookUp(admin, {}).expect(400);
      await lookUp(admin, { reference: 'AAAA-AAAA', extra: 1 }).expect(400);
    });

    it('opens a booking with who booked it, what was paid and where its money stands, and logs it', async () => {
      const admin = await staff();
      const where = await listing(`open-${tag}`);
      const driver = await person();
      const made = await booking(driver, where, 30);
      const response = await call(admin, 'get', `/admin/bookings/${made.id}`).expect(200);
      expect(AdminBookingSchema.parse(response.body)).toMatchObject({
        id: made.id,
        reference: made.reference,
        status: 'confirmed',
        listing: { id: where.id, name: 'Γκαράζ Έλεγχος' },
        driver: { id: driver.id, email: driver.email },
        vehiclePlate: 'IKB1234',
        total: { amountMinor: 400, currency: 'EUR' },
        paymentStatus: 'succeeded',
        refund: { status: null, amount: null, attempts: 0 },
        disputes: [],
        canCancel: true,
        canRetryRefund: false,
        canSettleRefund: false,
      });
      expect(response.headers['cache-control']).toContain('no-store');
      expect(await audited(made.id)).toEqual([
        {
          action: 'booking.viewed',
          actorId: admin.id,
          targetType: 'booking',
          details: { reference: made.reference },
        },
      ]);
    });

    it('is not for a link on another site, and answers 404 for what is no booking', async () => {
      const admin = await staff();
      const where = await listing(`site-${tag}`);
      const made = await booking(await person(), where, 30);
      await call(admin, 'get', `/admin/bookings/${made.id}`)
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);
      expect(await audited(made.id)).toEqual([]);
      for (const id of ['not-an-id', randomUUID()]) {
        const response = await call(admin, 'get', `/admin/bookings/${id}`).expect(404);
        expect(response.body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      }
    });

    it('offers no cancelling of a stay that has begun or a booking already off', async () => {
      const admin = await staff();
      const where = await listing(`flags-${tag}`);
      const driver = await person();
      const begun = await booking(driver, where, -1);
      const off = await booking(driver, where, 30, {
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelledAt: new Date(),
        refundMinor: 400,
      });
      for (const made of [begun, off]) {
        const response = await call(admin, 'get', `/admin/bookings/${made.id}`).expect(200);
        expect(response.body).toMatchObject({ canCancel: false });
      }
    });
  });

  describe('calling a booking off (#82)', () => {
    const cancel = (admin: TestUser, id: string, body: unknown = { note: TICKET }) =>
      call(admin, 'post', `/admin/bookings/${id}/cancel`).send(body as object);

    it('refunds in full, tells the driver and every owner, and writes the note to the log', async () => {
      const admin = await staff();
      const where = await listing(`cancel-${tag}`);
      const driver = await person();
      const made = await booking(driver, where, 30);
      const response = await cancel(admin, made.id).expect(200);
      expect(AdminBookingSchema.parse(response.body)).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'owner',
        refund: { status: 'owed', amount: { amountMinor: 400, currency: 'EUR' } },
        canCancel: false,
      });
      expect(await bookingOf(made.id)).toMatchObject({
        status: 'cancelled',
        cancelledByUserId: admin.id,
        refundMinor: 400,
        refundStatus: 'owed',
      });
      expect((await mailed(driver.id)).map((email) => email.kind)).toEqual(['booking-cancelled']);
      expect((await mailed(where.owner.id)).map((email) => email.kind)).toEqual([
        'booking-cancelled-by-staff',
      ]);
      expect(await changes(made.id)).toEqual([
        {
          action: 'booking.cancelled',
          actorId: admin.id,
          targetType: 'booking',
          details: { reference: made.reference, refundMinor: 400, note: TICKET },
        },
      ]);
      // The worker's sweep finds it owed, whole, on its first attempt.
      const owed = await refundsOwed(db, new Date(Date.now() + 60_000));
      expect(owed.find((row) => row.id === made.id)).toMatchObject({
        kind: 'cancelled',
        amountMinor: 400,
        attempt: 0,
      });
    });

    it('is for a confirmed booking that has not begun: not one begun, nor one already off', async () => {
      const admin = await staff();
      const where = await listing(`notyet-${tag}`);
      const driver = await person();
      const begun = await booking(driver, where, -1);
      const off = await booking(driver, where, 30, {
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelledAt: new Date(),
        refundMinor: 400,
      });
      for (const made of [begun, off]) {
        const response = await cancel(await staff(), made.id).expect(409);
        expect(response.body).toMatchObject({ code: 'NOT_CANCELLABLE' });
      }
      expect((await bookingOf(begun.id))?.status).toBe('confirmed');
      expect(await changes(begun.id)).toEqual([]);
      expect(await mailed(driver.id)).toEqual([]);
      void admin;
    });

    it('is done once when several admins press at the same moment, and when the driver cancels too', async () => {
      const admins = await Promise.all(Array.from({ length: 4 }, () => staff()));
      const where = await listing(`race-${tag}`);
      const driver = await person();
      const made = await booking(driver, where, 30);
      const answers = await Promise.all([
        ...admins.map((admin) => cancel(admin, made.id)),
        call(driver, 'post', `/bookings/${made.id}/cancel`).send({}),
      ]);
      expect(answers.filter((answer) => answer.status === 200).length).toBeGreaterThanOrEqual(1);
      const row = await bookingOf(made.id);
      expect(row?.status).toBe('cancelled');
      expect(row?.refundMinor).toBeGreaterThan(0);
      expect(row?.refundStatus).toBe('owed');
      expect(
        (await mailed(driver.id)).filter((email) => email.kind === 'booking-cancelled'),
      ).toHaveLength(1);
      expect((await changes(made.id)).length).toBeLessThanOrEqual(1);
    });

    it('wants a short note in plain words, and answers 404 for what is no booking', async () => {
      const where = await listing(`note-${tag}`);
      const made = await booking(await person(), where, 30);
      const hidden = [0x0, 0x202e, 0x2028, 0xad].map((point) => `a${String.fromCodePoint(point)}b`);
      let admin = await staff();
      let asked = 0;
      for (const body of [
        [],
        {},
        { note: '' },
        { note: 'x'.repeat(101) },
        { note: TICKET, extra: 1 },
        ...hidden.map((note) => ({ note })),
      ]) {
        if (asked++ % 4 === 3) admin = await staff();
        await cancel(admin, made.id, body).expect(400);
      }
      expect((await bookingOf(made.id))?.status).toBe('confirmed');
      for (const id of ['not-an-id', randomUUID()]) {
        await cancel(await staff(), id).expect(404);
      }
    });

    it('changes nothing when the log cannot be written', async () => {
      const admin = await staff();
      const where = await listing(`rollback-${tag}`);
      const driver = await person();
      const made = await booking(driver, where, 30);
      const refusal = `it_refuse_${made.id.slice(0, 8)}`;
      await db.execute(
        sql.raw(
          `alter table audit_log add constraint ${refusal} check (target_id <> '${made.id}') not valid`,
        ),
      );
      try {
        await cancel(admin, made.id).expect(500);
      } finally {
        await db.execute(sql.raw(`alter table audit_log drop constraint ${refusal}`));
      }
      expect((await bookingOf(made.id))?.status).toBe('confirmed');
      expect(await mailed(driver.id)).toEqual([]);
    });

    it('is throttled to a few a minute per admin', async () => {
      const busy = await staff();
      const none = randomUUID();
      const answers: number[] = [];
      for (let i = 0; i < 6; i++) answers.push((await cancel(busy, none)).status);
      expect(answers.slice(0, 5).every((status) => status === 404)).toBe(true);
      expect(answers[5]).toBe(429);
    });
  });

  describe('a refund that failed (#84)', () => {
    const retry = (admin: TestUser, id: string, body: unknown = { note: TICKET }) =>
      call(admin, 'post', `/admin/bookings/${id}/refund/retry`).send(body as object);
    const settle = (admin: TestUser, id: string, body: unknown = { note: TICKET }) =>
      call(admin, 'post', `/admin/bookings/${id}/refund/settle`).send(body as object);

    it('is asked of Stripe again under a new attempt, and the worker sees it owed', async () => {
      const admin = await staff();
      const where = await listing(`retry-${tag}`);
      const made = await failedRefund(await person(), where);
      const page = await call(admin, 'get', `/admin/bookings/${made.id}`).expect(200);
      expect(page.body).toMatchObject({
        refund: { status: 'failed', attempts: 0 },
        canRetryRefund: true,
        canSettleRefund: true,
      });
      const response = await retry(admin, made.id).expect(200);
      expect(response.body).toMatchObject({
        refund: { status: 'owed', attempts: 1 },
        // Asked again, it can't be asked a third time at once, but it can be settled: Stripe may
        // keep refusing it, and nothing else would ever free its owners' payout.
        canRetryRefund: false,
        canSettleRefund: true,
      });
      expect(await bookingOf(made.id)).toMatchObject({
        refundStatus: 'owed',
        stripeRefundId: null,
        refundAttempts: 1,
      });
      const owed = await refundsOwed(db, new Date(Date.now() + 60_000));
      expect(owed.find((row) => row.id === made.id)).toMatchObject({
        kind: 'cancelled',
        attempt: 1,
      });
      expect((await changes(made.id))[0]).toMatchObject({
        action: 'booking.refund_retried',
        details: { reference: made.reference, attempt: 1, note: TICKET },
      });
    });

    it('can fail again and be asked again: each is a new attempt', async () => {
      const where = await listing(`again-${tag}`);
      const made = await failedRefund(await person(), where);
      await retry(await staff(), made.id).expect(200);
      // As the worker and Stripe would leave it: sent, then failed again.
      await db
        .update(schema.bookings)
        .set({
          refundStatus: 'failed',
          stripeRefundId: `re_it${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        })
        .where(eq(schema.bookings.id, made.id));
      await retry(await staff(), made.id).expect(200);
      expect((await bookingOf(made.id))?.refundAttempts).toBe(2);
    });

    it('is not asked again once the owners were paid: it can only be settled', async () => {
      const admin = await staff();
      const where = await listing(`paid-${tag}`);
      const made = await failedRefund(await person(), where, {
        transferStatus: 'sent',
        // Three quarters kept: the owners' share and the commission add up to what was kept.
        refundMinor: 100,
        transferMinor: 270,
        commissionMinor: 30,
        transferredAt: new Date(),
      });
      const page = await call(admin, 'get', `/admin/bookings/${made.id}`).expect(200);
      expect(page.body).toMatchObject({ canRetryRefund: false, canSettleRefund: true });
      const refused = await retry(admin, made.id).expect(409);
      expect(refused.body).toMatchObject({ code: 'TRANSFER_MADE' });
      await settle(await staff(), made.id).expect(200);
      expect((await bookingOf(made.id))?.refundStatus).toBe('settled');
    });

    it('is marked settled when the driver was paid another way, and stays on record', async () => {
      const admin = await staff();
      const where = await listing(`settle-${tag}`);
      const made = await failedRefund(await person(), where);
      const response = await settle(admin, made.id).expect(200);
      expect(response.body).toMatchObject({
        refund: { status: 'settled' },
        canRetryRefund: false,
        canSettleRefund: false,
      });
      const row = await bookingOf(made.id);
      expect(row?.refundStatus).toBe('settled');
      // The failed refund's id is kept: the record of what Stripe said.
      expect(row?.stripeRefundId).toMatch(/^re_it/);
      expect((await changes(made.id))[0]).toMatchObject({ action: 'booking.refund_settled' });
    });

    it('is for a refund that failed: not one sent, one owed, or none', async () => {
      const where = await listing(`none-${tag}`);
      const driver = await person();
      const plain = await booking(driver, where, 30);
      const sent = await failedRefund(driver, where, { refundStatus: 'sent' });
      for (const made of [plain, sent]) {
        for (const act of [retry, settle]) {
          const response = await act(await staff(), made.id).expect(409);
          expect(response.body).toMatchObject({ code: 'REFUND_NOT_FAILED' });
        }
      }
      await retry(await staff(), randomUUID()).expect(404);
      await settle(await staff(), 'not-an-id').expect(404);
    });

    it('is done once when two admins retry and settle at the same moment', async () => {
      const where = await listing(`either-${tag}`);
      const made = await failedRefund(await person(), where);
      const twice = await Promise.all([
        retry(await staff(), made.id),
        retry(await staff(), made.id),
      ]);
      expect(twice.map((answer) => answer.status).sort()).toEqual([200, 409]);
      expect((await changes(made.id)).length).toBe(1);
      expect((await bookingOf(made.id))?.refundAttempts).toBe(1);
      // A retry and a settling at once: settled in the end, whichever came first, and never two retries.
      const other = await failedRefund(await person(), where);
      const either = await Promise.all([
        retry(await staff(), other.id),
        settle(await staff(), other.id),
      ]);
      expect(either.map((answer) => answer.status).sort()).toEqual(expect.arrayContaining([200]));
      expect((await bookingOf(other.id))?.refundStatus).toBe('settled');
      expect((await bookingOf(other.id))?.refundAttempts).toBeLessThanOrEqual(1);
    });

    it('wants a note in plain words', async () => {
      const where = await listing(`refnote-${tag}`);
      const made = await failedRefund(await person(), where);
      let admin = await staff();
      let asked = 0;
      for (const body of [
        {},
        { note: '' },
        { note: 'x'.repeat(101) },
        { note: `a${String.fromCodePoint(0x202e)}b` },
      ]) {
        if (asked++ % 2 === 1) admin = await staff();
        await retry(admin, made.id, body).expect(400);
        await settle(admin, made.id, body).expect(400);
      }
      expect((await bookingOf(made.id))?.refundStatus).toBe('failed');
    });
  });

  describe('a lost dispute (#57, #83)', () => {
    const decide = (admin: TestUser, id: string, body: unknown) =>
      call(admin, 'post', `/admin/disputes/${id}/decide`).send(body as object);

    it('holds the payout until staff decide, and Parkfairy bearing it releases it, the owners told', async () => {
      const admin = await staff();
      const where = await listing(`release-${tag}`);
      const made = await booking(await person(), where, -30);
      const id = await disputeOn(made.id);
      expect(await transferHeld(db, made.id)).toBe(true);

      const response = await decide(admin, id, {
        decision: 'parkfairy_bears',
        note: TICKET,
      }).expect(200);
      expect(AdminBookingSchema.parse(response.body).disputes[0]).toMatchObject({
        status: 'lost',
        decision: 'parkfairy_bears',
        canDecide: false,
      });
      expect(await transferHeld(db, made.id)).toBe(false);
      expect((await mailed(where.owner.id)).map((email) => email.kind)).toEqual([
        'dispute-parkfairy-bears',
      ]);
      expect(await changes(id)).toEqual([
        {
          action: 'dispute.decided',
          actorId: admin.id,
          targetType: 'dispute',
          details: {
            bookingId: made.id,
            decision: 'parkfairy_bears',
            amountMinor: 400,
            note: TICKET,
          },
        },
      ]);
    });

    it('keeps the payout held for good when the owners bear it, and says so', async () => {
      const admin = await staff();
      const where = await listing(`forfeit-${tag}`);
      const made = await booking(await person(), where, -30);
      const id = await disputeOn(made.id);
      await decide(admin, id, { decision: 'owners_bear', note: TICKET }).expect(200);
      expect(await transferHeld(db, made.id)).toBe(true);
      expect((await mailed(where.owner.id)).map((email) => email.kind)).toEqual([
        'dispute-owners-bear',
      ]);
      // No longer waiting on support: the day's look at lost disputes leaves it out.
      const payments = AdminPaymentsSchema.parse(
        (await call(admin, 'get', '/admin/payments').expect(200)).body,
      );
      expect(payments.lostDisputes.map((row) => row.disputeId)).not.toContain(id);
    });

    it('is decided once, only for a lost dispute', async () => {
      const where = await listing(`once-${tag}`);
      const made = await booking(await person(), where, -30);
      const lost = await disputeOn(made.id);
      await decide(await staff(), lost, { decision: 'owners_bear', note: TICKET }).expect(200);
      const again = await decide(await staff(), lost, {
        decision: 'parkfairy_bears',
        note: TICKET,
      }).expect(409);
      expect(again.body).toMatchObject({ code: 'ALREADY_DECIDED' });
      const open = await disputeOn(made.id, { status: 'needs_response' });
      const early = await decide(await staff(), open, {
        decision: 'parkfairy_bears',
        note: TICKET,
      }).expect(409);
      expect(early.body).toMatchObject({ code: 'NOT_LOST' });
      for (const id of ['not-an-id', randomUUID()]) {
        await decide(await staff(), id, { decision: 'parkfairy_bears', note: TICKET }).expect(404);
      }
      expect(await changes(lost)).toHaveLength(1);
    });

    it('is decided once when several admins press at the same moment, whichever way', async () => {
      const where = await listing(`rush-${tag}`);
      const made = await booking(await person(), where, -30);
      const id = await disputeOn(made.id);
      const admins = await Promise.all(Array.from({ length: 4 }, () => staff()));
      const answers = await Promise.all(
        admins.map((admin, index) =>
          decide(admin, id, {
            decision: index % 2 ? 'owners_bear' : 'parkfairy_bears',
            note: TICKET,
          }),
        ),
      );
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409, 409, 409]);
      expect(await changes(id)).toHaveLength(1);
      expect(await mailed(where.owner.id)).toHaveLength(1);
    });

    it('wants who bears it, and a short note in plain words', async () => {
      const where = await listing(`dbody-${tag}`);
      const made = await booking(await person(), where, -30);
      const id = await disputeOn(made.id);
      let admin = await staff();
      let asked = 0;
      for (const body of [
        [],
        {},
        { note: TICKET },
        { decision: 'owners_bear' },
        { decision: 'someone', note: TICKET },
        { decision: 'owners_bear', note: '' },
        { decision: 'owners_bear', note: 'x'.repeat(101) },
        { decision: 'owners_bear', note: TICKET, extra: 1 },
        { decision: 'owners_bear', note: `a${String.fromCodePoint(0x202e)}b` },
      ]) {
        if (asked++ % 4 === 3) admin = await staff();
        await decide(admin, id, body).expect(400);
      }
      expect(await transferHeld(db, made.id)).toBe(true);
      expect(await changes(id)).toEqual([]);
    });

    it('changes nothing when the log cannot be written, and nobody is told', async () => {
      const admin = await staff();
      const where = await listing(`drollback-${tag}`);
      const made = await booking(await person(), where, -30);
      const id = await disputeOn(made.id);
      const refusal = `it_refuse_${id.slice(0, 8)}`;
      await db.execute(
        sql.raw(
          `alter table audit_log add constraint ${refusal} check (target_id <> '${id}') not valid`,
        ),
      );
      try {
        await decide(admin, id, { decision: 'parkfairy_bears', note: TICKET }).expect(500);
      } finally {
        await db.execute(sql.raw(`alter table audit_log drop constraint ${refusal}`));
      }
      expect(await transferHeld(db, made.id)).toBe(true);
      const [row] = await db
        .select({ decision: schema.paymentDisputes.decision })
        .from(schema.paymentDisputes)
        .where(eq(schema.paymentDisputes.id, id));
      expect(row?.decision).toBeNull();
      expect(await mailed(where.owner.id)).toEqual([]);
    });

    it('is left out of the day’s lost-disputes count once decided', async () => {
      const where = await listing(`count-${tag}`);
      const made = await booking(await person(), where, -30);
      const id = await disputeOn(made.id);
      const before = await lostDisputesHeld(db);
      await decide(await staff(), id, { decision: 'owners_bear', note: TICKET }).expect(200);
      expect(await lostDisputesHeld(db)).toBe(before - 1);
    });

    it('can’t be decided over a decision the database itself would refuse: only for a lost one', async () => {
      const where = await listing(`check-${tag}`);
      const made = await booking(await person(), where, -30);
      const admin = await staff();
      const id = await disputeOn(made.id, { status: 'needs_response' });
      await expect(
        db
          .update(schema.paymentDisputes)
          .set({ decision: 'owners_bear', decidedBy: admin.id, decidedAt: new Date() })
          .where(and(eq(schema.paymentDisputes.id, id))),
      ).rejects.toThrow();
    });
  });

  describe('what needs support in money', () => {
    it('lists lost disputes to decide, disputes open, and refunds that failed, with their bookings', async () => {
      const admin = await staff();
      const where = await listing(`list-${tag}`);
      const driver = await person();
      const lostOne = await booking(driver, where, -30);
      const lost = await disputeOn(lostOne.id);
      const openOne = await booking(driver, where, -31);
      const open = await disputeOn(openOne.id, {
        status: 'needs_response',
        dueBy: new Date(Date.now() + 5 * 24 * HOUR_MS),
      });
      const failed = await failedRefund(driver, where);
      const decidedOne = await booking(driver, where, -32);
      await disputeOn(decidedOne.id, {
        decision: 'owners_bear',
        decidedBy: admin.id,
        decidedAt: new Date(),
      });

      const response = await call(admin, 'get', '/admin/payments').expect(200);
      expect(response.headers['cache-control']).toContain('no-store');
      const payments = AdminPaymentsSchema.parse(response.body);
      expect(payments.lostDisputes.map((row) => row.disputeId)).toContain(lost);
      expect(payments.lostDisputes.find((row) => row.disputeId === lost)).toMatchObject({
        bookingId: lostOne.id,
        reference: lostOne.reference,
        disputeStatus: 'lost',
        reason: 'fraudulent',
        amount: { amountMinor: 400, currency: 'EUR' },
      });
      expect(payments.openDisputes.map((row) => row.disputeId)).toContain(open);
      expect(payments.openDisputes.find((row) => row.disputeId === open)?.dueBy).not.toBeNull();
      expect(payments.failedRefunds.map((row) => row.bookingId)).toContain(failed.id);
      // Decided is done: not in the list of what is waiting.
      expect(payments.lostDisputes.map((row) => row.bookingId)).not.toContain(decidedOne.id);
      for (const list of [payments.lostDisputes, payments.openDisputes, payments.failedRefunds]) {
        expect(list.length).toBeLessThanOrEqual(ADMIN_PAYMENTS_LIST_MAX);
      }
      // The lists say nothing of the driver: only the booking, to open it.
      expect(JSON.stringify(payments)).not.toContain(driver.email);
    });

    it('opens a booking with its disputes, the lost one waiting to be decided', async () => {
      const admin = await staff();
      const where = await listing(`disputes-${tag}`);
      const made = await booking(await person(), where, -30);
      const id = await disputeOn(made.id);
      const response = await call(admin, 'get', `/admin/bookings/${made.id}`).expect(200);
      expect(AdminBookingSchema.parse(response.body).disputes).toEqual([
        expect.objectContaining({ id, status: 'lost', decision: null, canDecide: true }),
      ]);
    });
  });

  describe('what money guards (review of 5.2c3)', () => {
    const cancel = (admin: TestUser, id: string, body: unknown = { note: TICKET }) =>
      call(admin, 'post', `/admin/bookings/${id}/cancel`).send(body as object);
    const retry = (admin: TestUser, id: string) =>
      call(admin, 'post', `/admin/bookings/${id}/refund/retry`).send({ note: TICKET });
    const settle = (admin: TestUser, id: string) =>
      call(admin, 'post', `/admin/bookings/${id}/refund/settle`).send({ note: TICKET });
    const decide = (admin: TestUser, id: string, decision: string) =>
      call(admin, 'post', `/admin/disputes/${id}/decide`).send({ decision, note: TICKET });

    it.each([
      ['open at the bank', { status: 'needs_response' as const }],
      ['lost and undecided', {}],
    ])(
      'does not cancel a booking whose dispute is %s: the driver would be paid twice',
      async (name, extra) => {
        const where = await listing(`dcancel-${name.replaceAll(' ', '')}-${tag}`);
        const made = await booking(await person(), where, 30);
        await disputeOn(made.id, extra);
        const refused = await cancel(await staff(), made.id).expect(409);
        expect(refused.body).toMatchObject({ code: 'DISPUTED' });
        expect((await bookingOf(made.id))?.status).toBe('confirmed');
        const page = await call(await staff(), 'get', `/admin/bookings/${made.id}`).expect(200);
        expect(page.body).toMatchObject({ canCancel: false });
      },
    );

    it('does not cancel one whose dispute the owners were decided to bear, but does once it is Parkfairy’s or won', async () => {
      const admin = await staff();
      const where = await listing(`dcancel2-${tag}`);
      const driver = await person();
      const forfeited = await booking(driver, where, 30);
      await disputeOn(forfeited.id, {
        decision: 'owners_bear',
        decidedBy: admin.id,
        decidedAt: new Date(),
      });
      await cancel(await staff(), forfeited.id).expect(409);
      const released = await booking(driver, where, 31);
      await disputeOn(released.id, {
        decision: 'parkfairy_bears',
        decidedBy: admin.id,
        decidedAt: new Date(),
      });
      await cancel(await staff(), released.id).expect(200);
      const won = await booking(driver, where, 32);
      await disputeOn(won.id, { status: 'won' });
      await cancel(await staff(), won.id).expect(200);
    });

    it('does not ask Stripe again for a refund on a disputed booking', async () => {
      const where = await listing(`dretry-${tag}`);
      const made = await failedRefund(await person(), where);
      await disputeOn(made.id, { status: 'needs_response' });
      const refused = await retry(await staff(), made.id).expect(409);
      expect(refused.body).toMatchObject({ code: 'DISPUTED' });
      const page = await call(await staff(), 'get', `/admin/bookings/${made.id}`).expect(200);
      expect(page.body).toMatchObject({ canRetryRefund: false, canSettleRefund: true });
      expect((await bookingOf(made.id))?.refundStatus).toBe('failed');
    });

    it('lists a refund asked again and refused for good, and lets staff settle it', async () => {
      const where = await listing(`stuck-${tag}`);
      const made = await failedRefund(await person(), where);
      await retry(await staff(), made.id).expect(200);
      const payments = AdminPaymentsSchema.parse(
        (await call(await staff(), 'get', '/admin/payments').expect(200)).body,
      );
      expect(payments.failedRefunds.find((row) => row.bookingId === made.id)).toMatchObject({
        attempts: 1,
      });
      const done = await settle(await staff(), made.id).expect(200);
      expect(done.body).toMatchObject({ refund: { status: 'settled' } });
      expect(await mailed(where.owner.id)).toEqual([]);
      // Settled with no refund of Stripe's behind it: what the check allows, and nothing is owed any more.
      const owed = await refundsOwed(db, new Date(Date.now() + 60_000));
      expect(owed.find((row) => row.id === made.id)).toBeUndefined();
    });

    it('records only Parkfairy bearing it, and tells nobody, once the payout was sent', async () => {
      const where = await listing(`decpaid-${tag}`);
      const made = await booking(await person(), where, -72, {
        status: 'cancelled',
        cancelledAt: new Date(Date.now() - 80 * HOUR_MS),
        cancelledBy: 'driver',
        refundStatus: 'sent',
        stripeRefundId: `re_it${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        transferStatus: 'sent',
        refundMinor: 100,
        transferMinor: 270,
        commissionMinor: 30,
        transferredAt: new Date(),
      });
      const id = await disputeOn(made.id);
      const page = await call(await staff(), 'get', `/admin/bookings/${made.id}`).expect(200);
      expect((page.body as { disputes: unknown[] }).disputes[0]).toMatchObject({
        canDecide: true,
        payoutHeld: false,
      });
      const refused = await decide(await staff(), id, 'owners_bear').expect(409);
      expect(refused.body).toMatchObject({ code: 'NOT_HELD' });
      await decide(await staff(), id, 'parkfairy_bears').expect(200);
      expect(await mailed(where.owner.id)).toEqual([]);
      expect(await changes(id)).toHaveLength(1);
    });

    it('is the same for a booking all of which was refunded: nothing kept, nothing to hold', async () => {
      const where = await listing(`decrefunded-${tag}`);
      const made = await failedRefund(await person(), where, { refundStatus: 'sent' });
      const id = await disputeOn(made.id);
      await decide(await staff(), id, 'owners_bear').expect(409);
      await decide(await staff(), id, 'parkfairy_bears').expect(200);
      expect(await mailed(where.owner.id)).toEqual([]);
    });

    describe('the transfer sweep reads the decision (markTransferSending)', () => {
      const mark = (bookingId: string, ownerId: string, kept = 400) =>
        markTransferSending(
          db,
          bookingId,
          { transferMinor: Math.round(kept * 0.9), commissionMinor: kept - Math.round(kept * 0.9) },
          new Map([[ownerId, Math.round(kept * 0.9)]]),
        );

      it('goes ahead with a stay over for a day and no dispute, as the control of the others', async () => {
        const where = await listing(`sweep0-${tag}`);
        const made = await booking(await person(), where, -72);
        expect(await mark(made.id, where.ownerId)).toBe(true);
      });

      it('holds a lost dispute until it is decided, goes on when Parkfairy bears it, and never when the owners do', async () => {
        const admin = await staff();
        const where = await listing(`sweep1-${tag}`);
        const driver = await person();
        const undecided = await booking(driver, where, -72);
        await disputeOn(undecided.id);
        expect(await mark(undecided.id, where.ownerId)).toBe(false);
        const released = await booking(driver, where, -73);
        await disputeOn(released.id, {
          decision: 'parkfairy_bears',
          decidedBy: admin.id,
          decidedAt: new Date(),
        });
        expect(await mark(released.id, where.ownerId)).toBe(true);
        const forfeited = await booking(driver, where, -74);
        await disputeOn(forfeited.id, {
          decision: 'owners_bear',
          decidedBy: admin.id,
          decidedAt: new Date(),
        });
        expect(await mark(forfeited.id, where.ownerId)).toBe(false);
        expect(await transferHeld(db, forfeited.id)).toBe(true);
        expect((await bookingOf(forfeited.id))?.transferStatus).toBeNull();
      });

      it('lets what was kept go once a failed refund is settled, but not while one is owed again', async () => {
        const where = await listing(`sweep2-${tag}`);
        const driver = await person();
        const settled = await failedRefund(driver, where, {
          refundStatus: 'settled',
          refundMinor: 100,
          startsAt: new Date(Date.now() - 74 * HOUR_MS),
          endsAt: new Date(Date.now() - 72 * HOUR_MS),
          blockedUntil: new Date(Date.now() - 72 * HOUR_MS),
        });
        expect(await mark(settled.id, where.ownerId, 300)).toBe(true);
        const owed = await failedRefund(driver, where, {
          refundStatus: 'owed',
          stripeRefundId: null,
          refundAttempts: 1,
          refundMinor: 100,
          startsAt: new Date(Date.now() - 75 * HOUR_MS),
          endsAt: new Date(Date.now() - 73 * HOUR_MS),
          blockedUntil: new Date(Date.now() - 73 * HOUR_MS),
        });
        expect(await mark(owed.id, where.ownerId, 300)).toBe(false);
      });

      it('keeps the payout held while any of two disputes is, and releases it only when none is', async () => {
        const where = await listing(`sweep3-${tag}`);
        const made = await booking(await person(), where, -72);
        const first = await disputeOn(made.id);
        const second = await disputeOn(made.id);
        await decide(await staff(), first, 'parkfairy_bears').expect(200);
        expect(await transferHeld(db, made.id)).toBe(true);
        expect(await mark(made.id, where.ownerId)).toBe(false);
        await decide(await staff(), second, 'parkfairy_bears').expect(200);
        expect(await transferHeld(db, made.id)).toBe(false);
        expect(await mark(made.id, where.ownerId)).toBe(true);
      });

      it('is held for good by one decided against the owners even beside a released one, and a won one frees nothing', async () => {
        const admin = await staff();
        const where = await listing(`sweep4-${tag}`);
        const made = await booking(await person(), where, -72);
        await disputeOn(made.id, {
          decision: 'owners_bear',
          decidedBy: admin.id,
          decidedAt: new Date(),
        });
        await disputeOn(made.id, {
          decision: 'parkfairy_bears',
          decidedBy: admin.id,
          decidedAt: new Date(),
        });
        await disputeOn(made.id, { status: 'won' });
        expect(await transferHeld(db, made.id)).toBe(true);
        expect(await mark(made.id, where.ownerId)).toBe(false);
      });
    });

    it('answers a decided dispute’s later word from Stripe with nothing: it can’t break the decision', async () => {
      const admin = await staff();
      const where = await listing(`late-${tag}`);
      const made = await booking(await person(), where, -72);
      const id = await disputeOn(made.id, {
        decision: 'owners_bear',
        decidedBy: admin.id,
        decidedAt: new Date(),
      });
      const [row] = await db
        .select({ stripeId: schema.paymentDisputes.stripeDisputeId })
        .from(schema.paymentDisputes)
        .where(eq(schema.paymentDisputes.id, id));
      await expect(
        recordDispute(db, made.id, {
          stripeDisputeId: row?.stripeId ?? '',
          status: 'won',
          reason: 'fraudulent',
          amountMinor: 400,
          currency: 'EUR',
          dueBy: null,
          submissions: 1,
        }),
      ).resolves.toBeNull();
      const [after] = await db
        .select({
          status: schema.paymentDisputes.status,
          decision: schema.paymentDisputes.decision,
        })
        .from(schema.paymentDisputes)
        .where(eq(schema.paymentDisputes.id, id));
      expect(after).toEqual({ status: 'lost', decision: 'owners_bear' });
    });

    it('is throttled per admin: one admin’s five do not stop another, and the lookups have a limit of their own', async () => {
      const busy = await staff();
      const other = await staff();
      const none = randomUUID();
      for (let i = 0; i < 5; i++) await cancel(busy, none).expect(404);
      await cancel(busy, none).expect(429);
      await cancel(other, none).expect(404);
    });

    it.each([
      ['post', '/admin/bookings/lookup', { reference: 'ABCD-EFGH' }],
      ['post', `/admin/bookings/${randomUUID()}/refund/retry`, { note: TICKET }],
      ['post', `/admin/bookings/${randomUUID()}/refund/settle`, { note: TICKET }],
      ['post', `/admin/disputes/${randomUUID()}/decide`, { decision: 'owners_bear', note: TICKET }],
    ] as const)(
      'refuses a write from another site on its origin: %s %s',
      async (method, path, body) => {
        const admin = await staff();
        await call(admin, method, path, 'https://evil.example').send(body).expect(403);
      },
    );

    it('does not let the answers of the money actions be cached: they carry a driver’s name, email and plate', async () => {
      const admin = await staff();
      const where = await listing(`nocache-${tag}`);
      const made = await booking(await person(), where, 30);
      const response = await cancel(admin, made.id).expect(200);
      expect(response.headers['cache-control']).toContain('no-store');
    });
  });
});
