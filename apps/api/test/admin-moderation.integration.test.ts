import { randomUUID } from 'node:crypto';
import {
  ADMIN_REASON_NOTE_MAX,
  AdminListingReviewSchema,
  AdminUserSchema,
  OWNER_LIMITS,
} from '@parkfairy/contracts';
import type { Auth } from '@parkfairy/auth';
import { enqueueListingStatusEmails, schema, type Database } from '@parkfairy/database';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH } from '../src/auth/auth.tokens.js';
import { newBookingReference } from '../src/bookings/booking-reference.js';
import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, updateUser, type TestApp, type TestUser } from './test-app.js';

// Moderation (5.2c2, #78–#81): staff take a live listing down or suspend an account, and bring either
// back. Kalamata's neighbour, far from the demo areas.
const HERE = { latitude: 36.7213, longitude: 22.4291 };
const PREFIX = 'it-mod-';
const tag = randomUUID().slice(0, 8);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
const PASSWORD = 'correct horse battery staple';
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
const WHY = 'The deed shows another owner. Send us the right one and we will lift this.';
const TICKET = 'Ticket 4821, deed disproved.';

describe('moderation (5.2c2: #78–#81)', () => {
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
      address = `198.73.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
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

  /** A live listing of a new owner, with a space, and optionally a hand in who else runs it. */
  async function live(name: string, status: 'published' | 'in_review' | 'draft' = 'published') {
    const owner = await person();
    await call(owner, 'patch', '/owner/profile').send(DETAILS).expect(200);
    await call(owner, 'put', '/owner/profile/tax').send(TAX).expect(200);
    const [profile] = await db
      .select({ id: schema.ownerProfiles.id })
      .from(schema.ownerProfiles)
      .where(eq(schema.ownerProfiles.userId, owner.id));
    const ownerId = profile?.id ?? '';
    const slug = `${PREFIX}${tag}-${name}`;
    const [row] = await db
      .insert(schema.parkingLocations)
      .values({
        ownerId,
        slug,
        name: `Έλεγχος ${name}`,
        address: 'Οδός Δοκιμής 9, Καλαμάτα',
        areaId: 'syntagma',
        location: HERE,
        hourlyRateMinor: 200,
        bookingGapMinutes: 0,
        cancellationPolicy: 'oneDay',
        landRegistrationNumber: 'KAEK-1234',
        status,
        notifiedStatus: status,
        submittedAt: status === 'draft' ? null : new Date(),
      })
      .returning({ id: schema.parkingLocations.id });
    const id = row?.id ?? '';
    await db
      .insert(schema.listingOwners)
      .values({ locationId: id, ownerId, role: 'primary', shareBps: 10_000 });
    await db.insert(schema.parkingSpaces).values({ locationId: id, label: 'A1' });
    return { owner, id, ownerId, slug };
  }

  /** A confirmed, paid booking of `driver`'s, starting in `startsInHours` (negative: already begun). */
  async function booked(driver: TestUser, locationId: string, startsInHours: number) {
    const startsAt = new Date(Date.now() + startsInHours * HOUR_MS);
    const endsAt = new Date(startsAt.getTime() + 2 * HOUR_MS);
    const [row] = await db
      .insert(schema.bookings)
      .values({
        reference: newBookingReference(),
        userId: driver.id,
        locationId,
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
      })
      .returning({ id: schema.bookings.id });
    return row?.id ?? '';
  }

  /** The listing as its owner's dashboard has it, with what staff wrote them. */
  const ownerSees = async (owner: TestUser, id: string) => {
    const onboarding = await call(owner, 'get', '/owner/onboarding').expect(200);
    const found = (onboarding.body as { listings: { id: string }[] }).listings.find(
      (item) => item.id === id,
    );
    return found as { id: string; status: string; reviewNote: string | null };
  };
  const bookingOf = async (id: string) => {
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    return row;
  };
  const statusOf = async (id: string) => {
    const [row] = await db
      .select({ status: schema.parkingLocations.status, note: schema.parkingLocations.reviewNote })
      .from(schema.parkingLocations)
      .where(eq(schema.parkingLocations.id, id));
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
      .where(and(eq(schema.auditLog.targetId, targetId)))
      .orderBy(schema.auditLog.at);
  const moderationLines = async (id: string) =>
    (await audited(id)).filter((line) => !line.action.endsWith('viewed'));
  const mailed = (userId: string) =>
    db
      .select({ kind: schema.emailOutbox.kind, payload: schema.emailOutbox.payload })
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.userId, userId))
      .orderBy(schema.emailOutbox.createdAt, schema.emailOutbox.kind);

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
      await db.delete(schema.bookings).where(inArray(schema.bookings.userId, gone));
      await db.delete(schema.ownerProfiles).where(inArray(schema.ownerProfiles.userId, gone));
      await db.delete(schema.users).where(inArray(schema.users.id, gone));
    }
    await app.close();
  });

  describe('who may', () => {
    const paths = [
      ['post', `/admin/listings/${randomUUID()}/suspend`],
      ['post', `/admin/listings/${randomUUID()}/reinstate`],
      ['post', `/admin/users/${randomUUID()}/suspend`],
      ['post', `/admin/users/${randomUUID()}/reinstate`],
    ] as const;
    const body = { note: TICKET, cancelBookings: false };

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
      const { id } = await live(`origin-${tag}`);
      await call(admin, 'post', `/admin/listings/${id}/suspend`, 'https://evil.example')
        .send({ note: WHY, cancelBookings: false })
        .expect(403);
      expect((await statusOf(id))?.status).toBe('published');
    });
  });

  describe('suspending a listing (#78, #79)', () => {
    const suspend = (
      admin: TestUser,
      id: string,
      body: unknown = { note: WHY, cancelBookings: false },
    ) => call(admin, 'post', `/admin/listings/${id}/suspend`).send(body as object);
    const reinstate = (admin: TestUser, id: string, body: unknown = { note: TICKET }) =>
      call(admin, 'post', `/admin/listings/${id}/reinstate`).send(body as object);

    it('takes it off the site, shows its owners why, tells the primary owner, and logs it', async () => {
      const admin = await staff();
      const { owner, id, slug } = await live(`down-${tag}`);
      await call(null, 'get', `/parking/${slug}`).expect(200);

      const response = await suspend(admin, id).expect(200);
      expect(AdminListingReviewSchema.parse(response.body)).toMatchObject({
        id,
        status: 'suspended',
        reviewNote: WHY,
        canSuspend: false,
        canReinstate: true,
      });
      expect(await statusOf(id)).toEqual({ status: 'suspended', note: WHY });
      // Not on the public site, as any listing that isn't live isn't.
      await call(null, 'get', `/parking/${slug}`).expect(404);
      // Its owners read the reason where they read what staff asked them to change.
      const own = await ownerSees(owner, id);
      expect(own).toMatchObject({ status: 'suspended', reviewNote: WHY });

      expect(await mailed(owner.id)).toEqual([
        {
          kind: 'listing-suspended',
          payload: { listingName: `Έλεγχος down-${tag}`, contentLocale: 'el' },
        },
      ]);
      expect(await moderationLines(id)).toEqual([
        {
          action: 'listing.suspended',
          actorId: admin.id,
          targetType: 'listing',
          details: { from: 'published', note: WHY, cancelBookings: false, bookingsCancelled: 0 },
        },
      ]);
    });

    it('sends nothing more by the status sweep: the owner has been told once', async () => {
      const admin = await staff();
      const { owner, id } = await live(`sweep-${tag}`);
      await suspend(admin, id).expect(200);
      await enqueueListingStatusEmails(db);
      expect((await mailed(owner.id)).map((email) => email.kind)).toEqual(['listing-suspended']);
      await reinstate(admin, id).expect(200);
      await enqueueListingStatusEmails(db);
      // The second round is its own email, and the sweep adds no "approved" to it.
      expect((await mailed(owner.id)).map((email) => email.kind)).toEqual([
        'listing-suspended',
        'listing-reinstated',
      ]);
    });

    it('leaves the bookings standing when staff say so, and cancels none', async () => {
      const admin = await staff();
      const driver = await person();
      const { id } = await live(`stand-${tag}`);
      const upcoming = await booked(driver, id, 30);
      const before = await call(admin, 'get', `/admin/listings/${id}`).expect(200);
      expect(before.body).toMatchObject({ upcomingBookings: 1 });
      const response = await suspend(admin, id, { note: WHY, cancelBookings: false }).expect(200);
      // Suspended, there is nothing more to offer to cancel: the page asks only of a live listing.
      expect(response.body).toMatchObject({ status: 'suspended', upcomingBookings: 0 });
      expect((await bookingOf(upcoming))?.status).toBe('confirmed');
      expect(await mailed(driver.id)).toEqual([]);
    });

    it('calls off what is upcoming when staff say so: refund owed in full, driver told, the rest untouched', async () => {
      const admin = await staff();
      const driver = await person();
      const other = await live(`other-${tag}`);
      const { owner, id } = await live(`cancel-${tag}`);
      const soon = await booked(driver, id, 5);
      const later = await booked(driver, id, 70);
      const begun = await booked(driver, id, -1);
      const elsewhere = await booked(driver, other.id, 5);
      const review = await call(admin, 'get', `/admin/listings/${id}`).expect(200);
      expect(review.body).toMatchObject({ canSuspend: true, upcomingBookings: 2 });

      const response = await suspend(admin, id, { note: WHY, cancelBookings: true }).expect(200);
      expect(response.body).toMatchObject({ status: 'suspended', upcomingBookings: 0 });
      for (const cancelled of [soon, later]) {
        expect(await bookingOf(cancelled)).toMatchObject({
          status: 'cancelled',
          cancelledBy: 'owner',
          cancelledByUserId: admin.id,
          refundMinor: 400,
          refundStatus: 'owed',
        });
      }
      // A stay that has begun is not called off, nor is another listing's.
      expect((await bookingOf(begun))?.status).toBe('confirmed');
      expect((await bookingOf(elsewhere))?.status).toBe('confirmed');
      // The driver is told once for each, the owner of the listing is told it is suspended.
      expect((await mailed(driver.id)).map((email) => email.kind)).toEqual([
        'booking-cancelled',
        'booking-cancelled',
      ]);
      expect((await mailed(owner.id)).map((email) => email.kind)).toEqual(['listing-suspended']);
      expect((await moderationLines(id))[0]?.details).toMatchObject({
        cancelBookings: true,
        bookingsCancelled: 2,
      });
    });

    it('is for a listing that is live: no draft, none in review, none already suspended', async () => {
      const draft = await live(`draft-${tag}`, 'draft');
      await suspend(await staff(), draft.id).expect(404);
      const waiting = await live(`waiting-${tag}`, 'in_review');
      const refused = await suspend(await staff(), waiting.id).expect(409);
      expect(refused.body).toMatchObject({ code: 'NOT_PUBLISHED' });
      const done = await live(`twice-${tag}`);
      await suspend(await staff(), done.id).expect(200);
      const again = await suspend(await staff(), done.id).expect(409);
      expect(again.body).toMatchObject({ code: 'NOT_PUBLISHED' });
      expect(await moderationLines(done.id)).toHaveLength(1);
      expect(await mailed(done.owner.id)).toHaveLength(1);
      for (const id of ['not-an-id', randomUUID()]) {
        await suspend(await staff(), id).expect(404);
      }
    });

    it('is never for a listing staff own', async () => {
      const mine = await live(`mine-${tag}`);
      // The listing's primary owner is a member of staff: they can't take down their own.
      await updateUser(app, mine.owner.id, { role: 'admin', twoFactorEnabled: true });
      const response = await suspend(mine.owner, mine.id).expect(403);
      expect(response.body).toMatchObject({ code: 'OWN_LISTING' });
      expect((await statusOf(mine.id))?.status).toBe('published');
    });

    it('is never for staff who manage the listing either, and the page says so', async () => {
      const admin = await staff();
      const { id } = await live(`managed-${tag}`);
      await db.insert(schema.listingManagers).values({ locationId: id, userId: admin.id });
      const page = await call(admin, 'get', `/admin/listings/${id}`).expect(200);
      expect(page.body).toMatchObject({ own: true, canSuspend: false, canReinstate: false });
      const response = await suspend(admin, id).expect(403);
      expect(response.body).toMatchObject({ code: 'OWN_LISTING' });
      await db
        .update(schema.parkingLocations)
        .set({ status: 'suspended' })
        .where(eq(schema.parkingLocations.id, id));
      const lifted = await reinstate(await staff().then((a) => ({ ...a })), id).expect(200);
      expect(lifted.body).toMatchObject({ status: 'published' });
      expect((await statusOf(id))?.status).toBe('published');
      await db
        .update(schema.parkingLocations)
        .set({ status: 'suspended' })
        .where(eq(schema.parkingLocations.id, id));
      await reinstate(admin, id).expect(403);
    });

    it('wants a note its owners can read, and an answer about the bookings', async () => {
      const admin = await staff();
      const { id } = await live(`body-${tag}`);
      // The route is throttled to a few a minute, refusals included: a new admin for each few.
      let who = admin;
      let asked = 0;
      const ask = async (body: unknown) => {
        if (asked++ % 4 === 3) who = await staff();
        return (await suspend(who, id, body)).status;
      };
      const hidden = [0x0, 0xad, 0x202e, 0x2028].map((point) => `a${String.fromCodePoint(point)}b`);
      for (const body of [
        [],
        {},
        { note: WHY },
        { cancelBookings: true },
        { note: '', cancelBookings: false },
        { note: '   ', cancelBookings: false },
        { note: 'x'.repeat(OWNER_LIMITS.reviewNote + 1), cancelBookings: false },
        { note: WHY, cancelBookings: 'yes' },
        { note: WHY, cancelBookings: false, extra: 1 },
        ...hidden.map((note) => ({ note, cancelBookings: false })),
      ]) {
        expect(await ask(body), JSON.stringify(body)).toBe(400);
      }
      expect((await statusOf(id))?.status).toBe('published');
    });

    it('is done once when several admins press at the same moment, cancelling each booking once', async () => {
      const admins = await Promise.all(Array.from({ length: 4 }, () => staff()));
      const driver = await person();
      const { owner, id } = await live(`race-${tag}`);
      await booked(driver, id, 20);
      const answers = await Promise.all(
        admins.map((admin) => suspend(admin, id, { note: WHY, cancelBookings: true })),
      );
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409, 409, 409]);
      expect(await moderationLines(id)).toHaveLength(1);
      expect(await mailed(owner.id)).toHaveLength(1);
      expect(await mailed(driver.id)).toHaveLength(1);
    });

    it('refunds once when a driver cancels at the same moment as staff call off the bookings', async () => {
      const admin = await staff();
      const driver = await person();
      const { id } = await live(`racecancel-${tag}`);
      const upcoming = await booked(driver, id, 60);
      const [staffAnswer, driverAnswer] = await Promise.all([
        suspend(admin, id, { note: WHY, cancelBookings: true }),
        call(driver, 'post', `/bookings/${upcoming}/cancel`).send({}),
      ]);
      expect(staffAnswer.status).toBe(200);
      expect([200, 404, 409]).toContain(driverAnswer.status);
      const row = await bookingOf(upcoming);
      // Cancelled once, by whichever got there first, and the refund is owed in full once.
      expect(row?.status).toBe('cancelled');
      expect(row?.refundMinor).toBeGreaterThan(0);
      expect(row?.refundStatus).toBe('owed');
      const cancelled = (await mailed(driver.id)).filter(
        (email) => email.kind === 'booking-cancelled',
      );
      expect(cancelled).toHaveLength(1);
    });

    it('changes nothing when the log cannot be written: still live, bookings standing, nobody told', async () => {
      const admin = await staff();
      const driver = await person();
      const { owner, id } = await live(`rollback-${tag}`);
      const upcoming = await booked(driver, id, 10);
      const refusal = `it_refuse_${id.slice(0, 8)}`;
      await db.execute(
        sql.raw(
          `alter table audit_log add constraint ${refusal} check (target_id <> '${id}') not valid`,
        ),
      );
      try {
        await suspend(admin, id, { note: WHY, cancelBookings: true }).expect(500);
      } finally {
        await db.execute(sql.raw(`alter table audit_log drop constraint ${refusal}`));
      }
      expect((await statusOf(id))?.status).toBe('published');
      expect((await bookingOf(upcoming))?.status).toBe('confirmed');
      expect(await mailed(owner.id)).toEqual([]);
      expect(await mailed(driver.id)).toEqual([]);
    });

    it('brings it back: live, the note cleared, its owner told, the new note for the log alone', async () => {
      const admin = await staff();
      const { owner, id, slug } = await live(`back-${tag}`);
      await suspend(admin, id).expect(200);
      const response = await reinstate(admin, id).expect(200);
      expect(AdminListingReviewSchema.parse(response.body)).toMatchObject({
        status: 'published',
        reviewNote: null,
        canSuspend: true,
        canReinstate: false,
      });
      expect(await statusOf(id)).toEqual({ status: 'published', note: null });
      await call(null, 'get', `/parking/${slug}`).expect(200);
      expect((await mailed(owner.id)).map((email) => email.kind)).toEqual([
        'listing-suspended',
        'listing-reinstated',
      ]);
      const lines = await moderationLines(id);
      expect(lines.map((line) => line.action)).toEqual(['listing.suspended', 'listing.reinstated']);
      expect(lines[1]?.details).toEqual({ from: 'suspended', note: TICKET });
      // The reinstating note is the log's alone: the owner reads nothing of it.
      const own = await ownerSees(owner, id);
      expect(own).toMatchObject({ status: 'published', reviewNote: null });
      expect(JSON.stringify(own)).not.toContain(TICKET);
    });

    it('is only for a suspended listing, wants its note, and keeps it to the log’s size', async () => {
      const admin = await staff();
      const { id } = await live(`notsus-${tag}`);
      const refused = await reinstate(admin, id).expect(409);
      expect(refused.body).toMatchObject({ code: 'NOT_SUSPENDED' });
      await suspend(admin, id).expect(200);
      for (const note of [undefined, '', 'x'.repeat(ADMIN_REASON_NOTE_MAX + 1)]) {
        await reinstate(await staff(), id, { note }).expect(400);
      }
      await reinstate(await staff(), id, { note: TICKET, cancelBookings: true }).expect(400);
      expect((await statusOf(id))?.status).toBe('suspended');
    });
  });

  describe('suspending an account (#79, #80)', () => {
    const suspend = (admin: TestUser, id: string, body: unknown = { note: TICKET }) =>
      call(admin, 'post', `/admin/users/${id}/suspend`).send(body as object);
    const reinstate = (admin: TestUser, id: string, body: unknown = { note: TICKET }) =>
      call(admin, 'post', `/admin/users/${id}/reinstate`).send(body as object);
    const signIn = (user: TestUser) =>
      app.get<Auth>(AUTH).api.signInEmail({
        body: { email: user.email, password: PASSWORD },
        asResponse: true,
      });

    it('ends its sessions, refuses its sign-in with a word of its own, and tells the person nothing of why', async () => {
      const admin = await staff();
      const target = await person();
      await call(target, 'get', '/me').expect(200);
      // A reset link from before, which would otherwise sign the account in.
      await db.insert(schema.verifications).values({
        identifier: `reset-password:old-${randomUUID()}`,
        value: target.id,
        expiresAt: new Date(Date.now() + HOUR_MS),
      });

      const response = await suspend(admin, target.id).expect(200);
      expect(AdminUserSchema.parse(response.body)).toMatchObject({
        id: target.id,
        suspended: true,
        canSuspend: false,
        canReinstate: true,
      });
      await call(target, 'get', '/me').expect(401);
      expect(
        await db
          .select()
          .from(schema.verifications)
          .where(eq(schema.verifications.value, target.id)),
      ).toEqual([]);

      const refused = await signIn(target);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
      // A wrong password learns nothing of it: the same answer as for any account.
      const attempt = (email: string, password: string) =>
        app.get<Auth>(AUTH).api.signInEmail({ body: { email, password }, asResponse: true });
      const wrong = await attempt(target.email, 'not the password at all');
      const nobody = await attempt(`nobody-${randomUUID()}@example.com`, 'not the password at all');
      expect(wrong.status).toBe(nobody.status);
      expect(await wrong.json()).toEqual(await nobody.json());

      expect(await mailed(target.id)).toEqual([{ kind: 'account-suspended', payload: {} }]);
      expect(JSON.stringify(await mailed(target.id))).not.toContain(TICKET);
      expect(await moderationLines(target.id)).toEqual([
        {
          action: 'user.suspended',
          actorId: admin.id,
          targetType: 'user',
          details: { note: TICKET, sessionsEnded: 1 },
        },
      ]);
    });

    it('refuses a suspended account that has two-factor on, with no session left behind', async () => {
      const admin = await staff();
      const target = await person();
      await updateUser(app, target.id, { twoFactorEnabled: true });
      await db.insert(schema.twoFactors).values({
        userId: target.id,
        secret: `secret-${randomUUID()}`,
        backupCodes: 'codes',
      });
      await suspend(admin, target.id).expect(200);
      const response = await signIn(target);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
      expect(
        await db.select().from(schema.sessions).where(eq(schema.sessions.userId, target.id)),
      ).toEqual([]);
    });

    it('does not let a reset bring a suspended account back: the new password still gets no session', async () => {
      const admin = await staff();
      const target = await person();
      await suspend(admin, target.id).expect(200);
      const token = `fresh-${randomUUID()}`;
      await db.insert(schema.verifications).values({
        identifier: `reset-password:${token}`,
        value: target.id,
        expiresAt: new Date(Date.now() + HOUR_MS),
      });
      await app.get<Auth>(AUTH).api.resetPassword({
        body: { token, newPassword: 'a brand new password 1' },
      });
      const response = await app.get<Auth>(AUTH).api.signInEmail({
        body: { email: target.email, password: 'a brand new password 1' },
        asResponse: true,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
      const [row] = await db
        .select({ at: schema.users.suspendedAt })
        .from(schema.users)
        .where(eq(schema.users.id, target.id));
      expect(row?.at).not.toBeNull();
    });

    it('is turned away by the API even where a session slipped through', async () => {
      const admin = await staff();
      const target = await person();
      // As if a session opened in the same instant: the flag set with the session left alone.
      await updateUser(app, target.id, { suspendedAt: new Date() });
      const response = await call(target, 'get', '/me').expect(403);
      expect(response.body).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
      // Staff can still see and reinstate it, and the person is not locked out for good.
      await reinstate(admin, target.id).expect(200);
      await call(target, 'get', '/me').expect(200);
    });

    it('touches nothing it holds: its listing stays live, and staff are told how many are', async () => {
      const admin = await staff();
      const { owner, id } = await live(`held-${tag}`);
      const driver = await person();
      const upcoming = await booked(driver, id, 20);
      const before = await call(admin, 'get', `/admin/users/${owner.id}`).expect(200);
      expect(before.body).toMatchObject({ liveListings: 1, suspended: false });
      await suspend(admin, owner.id).expect(200);
      expect((await statusOf(id))?.status).toBe('published');
      expect((await bookingOf(upcoming))?.status).toBe('confirmed');
      const after = await call(admin, 'get', `/admin/users/${owner.id}`).expect(200);
      expect(after.body).toMatchObject({ liveListings: 1, suspended: true });
    });

    it('is lifted: the same password signs in again, and the person is told', async () => {
      const admin = await staff();
      const target = await person();
      await suspend(admin, target.id).expect(200);
      const response = await reinstate(admin, target.id, { note: 'Ticket 4822, resolved.' }).expect(
        200,
      );
      expect(response.body).toMatchObject({ suspended: false, canSuspend: true });
      expect((await signIn(target)).status).toBe(200);
      expect((await mailed(target.id)).map((email) => email.kind)).toEqual([
        'account-suspended',
        'account-reinstated',
      ]);
      expect((await moderationLines(target.id)).map((line) => line.action)).toEqual([
        'user.suspended',
        'user.reinstated',
      ]);
    });

    it('is never on yourself or on staff, and is done once', async () => {
      const admin = await staff();
      const colleague = await staff();
      // The route is throttled to a few a minute: a new admin for each of the many calls below.
      const fresh = () => staff();
      for (const id of [admin.id, colleague.id]) {
        const response = await suspend(await fresh(), id).expect(403);
        expect((response.body as { code: string }).code).toMatch(/^(OWN_ACCOUNT|STAFF_ACCOUNT)$/);
        await reinstate(await fresh(), id).expect(403);
      }
      const target = await person();
      await suspend(await fresh(), target.id).expect(200);
      const again = await suspend(await fresh(), target.id).expect(409);
      expect(again.body).toMatchObject({ code: 'ALREADY_SUSPENDED' });
      const none = await person();
      const notYet = await reinstate(await fresh(), none.id).expect(409);
      expect(notYet.body).toMatchObject({ code: 'NOT_SUSPENDED' });
      expect(await moderationLines(target.id)).toHaveLength(1);
      expect(await mailed(none.id)).toEqual([]);
      for (const id of ['not-an-id', randomUUID()]) {
        await suspend(await fresh(), id).expect(404);
      }
    });

    it('is done once when several admins press at the same moment', async () => {
      const admins = await Promise.all(Array.from({ length: 4 }, () => staff()));
      const target = await person();
      const answers = await Promise.all(admins.map((admin) => suspend(admin, target.id)));
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409, 409, 409]);
      expect(await moderationLines(target.id)).toHaveLength(1);
      expect(await mailed(target.id)).toHaveLength(1);
    });

    it('wants a short note for the log, in plain words', async () => {
      const target = await person();
      let admin = await staff();
      let asked = 0;
      const ask = async (body: unknown) => {
        if (asked++ % 4 === 3) admin = await staff();
        return (await suspend(admin, target.id, body)).status;
      };
      const hidden = [0x0, 0xad, 0x202e, 0x2028].map((point) => `a${String.fromCodePoint(point)}b`);
      for (const body of [
        [],
        {},
        { note: '' },
        { note: '   ' },
        { note: 'x'.repeat(ADMIN_REASON_NOTE_MAX + 1) },
        { note: TICKET, extra: true },
        { note: TICKET, cancelBookings: true },
        ...hidden.map((note) => ({ note })),
      ]) {
        expect(await ask(body), JSON.stringify(body)).toBe(400);
      }
      expect(await mailed(target.id)).toEqual([]);
    });

    it('changes nothing when the log cannot be written: still signed in, nobody told', async () => {
      const admin = await staff();
      const target = await person();
      const refusal = `it_refuse_${target.id.slice(0, 8)}`;
      await db.execute(
        sql.raw(
          `alter table audit_log add constraint ${refusal} check (target_id <> '${target.id}') not valid`,
        ),
      );
      try {
        await suspend(admin, target.id).expect(500);
      } finally {
        await db.execute(sql.raw(`alter table audit_log drop constraint ${refusal}`));
      }
      await call(target, 'get', '/me').expect(200);
      expect(await mailed(target.id)).toEqual([]);
      expect((await signIn(target)).status).toBe(200);
    });

    it('is throttled to a few a minute per admin', async () => {
      const busy = await staff();
      const other = await staff();
      const none = randomUUID();
      const answers: number[] = [];
      for (let i = 0; i < 6; i++) answers.push((await suspend(busy, none)).status);
      expect(answers.slice(0, 5).every((status) => status === 404)).toBe(true);
      expect(answers[5]).toBe(429);
      await suspend(other, none).expect(404);
    });
  });

  describe('what the log and the pages say', () => {
    it('lists the four actions by their filter, each as what was done to a listing or an account', async () => {
      const admin = await staff();
      const { id } = await live(`log-${tag}`);
      const target = await person();
      await call(admin, 'post', `/admin/listings/${id}/suspend`)
        .send({ note: WHY, cancelBookings: false })
        .expect(200);
      await call(admin, 'post', `/admin/listings/${id}/reinstate`)
        .send({ note: TICKET })
        .expect(200);
      await call(admin, 'post', `/admin/users/${target.id}/suspend`)
        .send({ note: TICKET })
        .expect(200);
      await call(admin, 'post', `/admin/users/${target.id}/reinstate`)
        .send({ note: TICKET })
        .expect(200);
      for (const [action, targetId, targetType] of [
        ['listing.suspended', id, 'listing'],
        ['listing.reinstated', id, 'listing'],
        ['user.suspended', target.id, 'user'],
        ['user.reinstated', target.id, 'user'],
      ] as const) {
        const log = (await call(admin, 'get', `/admin/audit?action=${action}`).expect(200))
          .body as {
          entries: { targetId: string; targetType: string; actor: { id: string } }[];
        };
        const line = log.entries.find((entry) => entry.targetId === targetId);
        expect(line, action).toMatchObject({ targetType, actor: { id: admin.id } });
      }
    });
  });
});
