import { randomUUID } from 'node:crypto';

import {
  LISTING_MANAGERS_MAX,
  type ListingOwners,
  ListingOwnersSchema,
  ManagedListingsSchema,
  OwnerCalendarSchema,
  OwnerEarningsSchema,
} from '@parkfairy/contracts';
import {
  claimDueEmails,
  type Database,
  mintInviteToken,
  releaseEmails,
  schema,
} from '@parkfairy/database';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newBookingReference } from '../src/bookings/booking-reference.js';
import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, type TestApp, type TestUser } from './test-app.js';

// A listing's managers (#69–#71). Rethymno's neighbour, far from the demo areas and other suites.
const PREFIX = 'it-mgr-';
const tag = randomUUID().slice(0, 8);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
const DAY_MS = 86_400_000;

describe('a listing’s managers (#69–#71)', () => {
  let app: TestApp;
  let db: Database;
  const users: TestUser[] = [];
  const visitors = new Map<string, string>();

  const call = (
    user: TestUser | null,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
  ) => {
    const req = request(app.getHttpServer())[method](`/v1${path}`);
    if (method !== 'get') req.set('Origin', ORIGIN);
    if (!user) return req;
    let address = visitors.get(user.id);
    if (!address) {
      address = `198.61.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
      visitors.set(user.id, address);
    }
    return req.set('Cookie', user.cookie).set('X-Forwarded-For', address);
  };
  const owners = async (user: TestUser, id: string): Promise<ListingOwners> =>
    ListingOwnersSchema.parse(
      (await call(user, 'get', `/owner/listings/${id}/owners`).expect(200)).body,
    );

  async function person(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }

  async function newListing(user: TestUser): Promise<string> {
    const response = await call(user, 'post', '/owner/listings').expect(201);
    const id = (response.body as { id: string }).id;
    await db
      .update(schema.parkingLocations)
      .set({ slug: `${PREFIX}${tag}-${id}` })
      .where(eq(schema.parkingLocations.id, id));
    return id;
  }

  /** Invites `email` in `role`, and makes the link as the worker would when it sends the email. */
  async function invite(
    by: TestUser,
    listingId: string,
    email: string,
    role: 'manager' | 'co_owner' = 'manager',
  ) {
    const answer = ListingOwnersSchema.parse(
      (
        await call(by, 'post', `/owner/listings/${listingId}/invites`)
          .send({ email, locale: 'en', role })
          .expect(200)
      ).body,
    );
    const made = answer.invites.find((open) => open.email === email.toLowerCase());
    if (!made) throw new Error('No invite');
    const minted = await mintInviteToken(db, made.id);
    if (!minted) throw new Error('Not minted');
    return { id: made.id, token: minted.token, answer };
  }

  /** A manager on a new listing of `primary`'s. */
  async function managed() {
    const primary = await person();
    const manager = await person();
    const id = await newListing(primary);
    const { token } = await invite(primary, id, manager.email);
    await call(manager, 'post', '/owner/invites/accept').send({ token }).expect(200);
    return { primary, manager, id };
  }

  /** A confirmed booking of the listing, by `driver`, starting `inDays` from now. */
  async function booking(driver: TestUser, locationId: string, inDays: number) {
    const startsAt = new Date(Date.now() + inDays * DAY_MS);
    const endsAt = new Date(startsAt.getTime() + 2 * 3_600_000);
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
        holdExpiresAt: startsAt,
        totalMinor: 400,
        currency: 'EUR',
        cancellationPolicy: 'oneDay',
        commissionBps: 1000,
        vehiclePlate: 'IKB1234',
        confirmedAt: new Date(),
      })
      .returning({ id: schema.bookings.id });
    return row?.id ?? '';
  }

  async function removeOurs() {
    const ours = await db
      .select({ id: schema.parkingLocations.id })
      .from(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    const ids = ours.map((found) => found.id);
    if (ids.length === 0) return;
    const ourBookings = db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(inArray(schema.bookings.locationId, ids));
    await db
      .delete(schema.bookingPayees)
      .where(inArray(schema.bookingPayees.bookingId, ourBookings));
    await db.delete(schema.bookings).where(inArray(schema.bookings.locationId, ids));
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
      await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.userId, ids));
      await db.delete(schema.ownerProfiles).where(inArray(schema.ownerProfiles.userId, ids));
      await db.delete(schema.users).where(inArray(schema.users.id, ids));
    }
    await app.close();
  });

  it('needs an account', async () => {
    await call(null, 'get', '/owner/managed').expect(401);
    await call(null, 'delete', `/owner/listings/${randomUUID()}/managers/${randomUUID()}`)
      .send({})
      .expect(401);
  });

  it('is invited by the primary owner alone, as an invite to manage', async () => {
    const primary = await person();
    const invited = await person();
    const id = await newListing(primary);
    const sent = await invite(primary, id, invited.email.toUpperCase());
    expect(sent.answer.invites).toEqual([
      expect.objectContaining({ role: 'manager', canWithdraw: true }),
    ]);
    expect(sent.answer.managersRoom).toBe(LISTING_MANAGERS_MAX - 1);
    // Owners' places are untouched by it.
    expect(sent.answer.room).toBe(9);
    // The email is the manager's, from the same outbox as co-owners'.
    const [queued] = await db
      .select({ kind: schema.emailOutbox.kind })
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.inviteId, sent.id));
    expect(queued?.kind).toBe('listing-invite');
    const [stored] = await db
      .select({ role: schema.listingInvites.role })
      .from(schema.listingInvites)
      .where(eq(schema.listingInvites.id, sent.id));
    expect(stored?.role).toBe('manager');
  });

  it('is refused to a co-owner who tries to add one (#70)', async () => {
    const primary = await person();
    const coOwner = await person();
    const id = await newListing(primary);
    const { token } = await invite(primary, id, coOwner.email, 'co_owner');
    await call(coOwner, 'post', '/owner/invites/accept').send({ token }).expect(200);
    const response = await call(coOwner, 'post', `/owner/listings/${id}/invites`)
      .send({ email: 'someone@example.com', locale: 'en', role: 'manager' })
      .expect(403);
    expect(response.body).toMatchObject({ code: 'PRIMARY_ONLY' });
    expect((await owners(primary, id)).invites).toEqual([]);
  });

  it('previews as an invite to manage, and accepts with no owner profile made (#71)', async () => {
    const primary = await person();
    const invited = await person();
    const id = await newListing(primary);
    const { token } = await invite(primary, id, invited.email);
    const preview = await call(invited, 'post', '/owner/invites/preview')
      .send({ token })
      .expect(200);
    expect(preview.body).toMatchObject({ state: 'open', forYou: true, role: 'manager' });

    await call(invited, 'post', '/owner/invites/accept').send({ token }).expect(200);
    // Asked again: the same answer, no second row.
    await call(invited, 'post', '/owner/invites/accept').send({ token }).expect(200);
    const rows = await db
      .select({ id: schema.listingManagers.id })
      .from(schema.listingManagers)
      .where(eq(schema.listingManagers.locationId, id));
    expect(rows).toHaveLength(1);
    expect(
      await db
        .select({ id: schema.ownerProfiles.id })
        .from(schema.ownerProfiles)
        .where(eq(schema.ownerProfiles.userId, invited.id)),
    ).toEqual([]);

    const seen = await owners(primary, id);
    expect(seen.managers).toEqual([
      expect.objectContaining({ name: 'Test Driver', email: invited.email.toLowerCase() }),
    ]);
    expect(seen.invites).toEqual([]);
    expect(seen.owners).toHaveLength(1);
  });

  it('lists the listings an account manages, and a stranger none', async () => {
    const { manager, id } = await managed();
    const listings = ManagedListingsSchema.parse(
      (await call(manager, 'get', '/owner/managed').expect(200)).body,
    );
    expect(listings.listings).toEqual([expect.objectContaining({ id })]);
    const stranger = await person();
    expect(
      ManagedListingsSchema.parse((await call(stranger, 'get', '/owner/managed').expect(200)).body)
        .listings,
    ).toEqual([]);
  });

  it('runs the listing day to day: the calendar, the bookings, cancelling one, and closures', async () => {
    const { primary, manager, id } = await managed();
    const driver = await person();
    const first = await booking(driver, id, 20);
    await booking(driver, id, 21);

    const month = new Date(Date.now() + 20 * DAY_MS).toISOString().slice(0, 7);
    const calendar = OwnerCalendarSchema.parse(
      (await call(manager, 'get', `/owner/calendar?month=${month}`).expect(200)).body,
    );
    expect(calendar.listings).toEqual([expect.objectContaining({ id })]);
    expect(calendar.days.flatMap((day) => day.bookings).length).toBeGreaterThanOrEqual(1);

    const list = await call(manager, 'get', `/owner/listings/${id}/bookings`).expect(200);
    expect((list.body as { bookings: unknown[] }).bookings).toHaveLength(2);

    await call(manager, 'post', `/owner/listings/${id}/bookings/${first}/cancel`).expect(204);
    const [cancelled] = await db
      .select({ status: schema.bookings.status, by: schema.bookings.cancelledBy })
      .from(schema.bookings)
      .where(eq(schema.bookings.id, first));
    expect(cancelled).toEqual({ status: 'cancelled', by: 'owner' });

    await call(manager, 'get', `/owner/listings/${id}/hours-exceptions`).expect(200);
    await call(manager, 'put', `/owner/listings/${id}/hours-exceptions`)
      .send({ exceptions: [] })
      .expect(200);
    // The primary sees the same listing, nothing of the manager's changed what they own.
    expect((await owners(primary, id)).managers).toHaveLength(1);
  });

  describe('a cancellation, on the record (#69)', () => {
    const toldAbout = (bookingId: string) =>
      db
        .select({
          userId: schema.emailOutbox.userId,
          payload: schema.emailOutbox.payload,
        })
        .from(schema.emailOutbox)
        .where(
          and(
            eq(schema.emailOutbox.kind, 'booking-cancelled-by-team'),
            sql`${schema.emailOutbox.payload} -> 'booking' ->> 'id' = ${bookingId}`,
          ),
        );
    const recorded = async (bookingId: string) =>
      (
        await db
          .select({ by: schema.bookings.cancelledByUserId, who: schema.bookings.cancelledBy })
          .from(schema.bookings)
          .where(eq(schema.bookings.id, bookingId))
      )[0];

    it('records the manager who cancelled, and tells the primary by role, never by name', async () => {
      const { primary, manager, id } = await managed();
      const driver = await person();
      const bookingId = await booking(driver, id, 20);
      await call(manager, 'post', `/owner/listings/${id}/bookings/${bookingId}/cancel`).expect(204);

      expect(await recorded(bookingId)).toEqual({ by: manager.id, who: 'owner' });
      const told = await toldAbout(bookingId);
      expect(told).toHaveLength(1);
      expect(told[0]?.userId).toBe(primary.id);
      expect(told[0]?.payload.booking).toMatchObject({ cancelledByRole: 'manager' });
      // Nothing of the manager's, the driver's or the car in what is kept for the email.
      expect(JSON.stringify(told[0]?.payload)).not.toMatch(/Test Driver|IKB1234|@example\.com/);
      // Asked again, it is already done: still one record, still one email.
      await call(manager, 'post', `/owner/listings/${id}/bookings/${bookingId}/cancel`).expect(204);
      expect(await toldAbout(bookingId)).toHaveLength(1);
      expect(await recorded(bookingId)).toEqual({ by: manager.id, who: 'owner' });
    });

    it('records the primary too, and tells no one: it was them', async () => {
      const { primary, id } = await managed();
      const driver = await person();
      const bookingId = await booking(driver, id, 21);
      await call(primary, 'post', `/owner/listings/${id}/bookings/${bookingId}/cancel`).expect(204);
      expect(await recorded(bookingId)).toEqual({ by: primary.id, who: 'owner' });
      expect(await toldAbout(bookingId)).toEqual([]);
    });

    it('tells the primary of a co-owner’s cancellation as well, by that role', async () => {
      const { primary, id } = await managed();
      const coOwner = await person();
      const { token } = await invite(primary, id, coOwner.email, 'co_owner');
      await call(coOwner, 'post', '/owner/invites/accept').send({ token }).expect(200);
      const driver = await person();
      const bookingId = await booking(driver, id, 22);
      await call(coOwner, 'post', `/owner/listings/${id}/bookings/${bookingId}/cancel`).expect(204);
      expect(await recorded(bookingId)).toEqual({ by: coOwner.id, who: 'owner' });
      const told = await toldAbout(bookingId);
      expect(told.map((email) => email.userId)).toEqual([primary.id]);
      expect(told[0]?.payload.booking).toMatchObject({ cancelledByRole: 'co_owner' });
    });

    it('keeps the record when the manager is removed or deletes their account', async () => {
      const { primary, manager, id } = await managed();
      const driver = await person();
      const bookingId = await booking(driver, id, 23);
      await call(manager, 'post', `/owner/listings/${id}/bookings/${bookingId}/cancel`).expect(204);
      const [row] = await db
        .select({ id: schema.listingManagers.id })
        .from(schema.listingManagers)
        .where(eq(schema.listingManagers.locationId, id));
      await call(primary, 'delete', `/owner/listings/${id}/managers/${row?.id}`).expect(200);
      expect(await recorded(bookingId)).toEqual({ by: manager.id, who: 'owner' });
    });
  });

  it('can do nothing else with the listing: no owners, edits, proofs, earnings or invites', async () => {
    const { manager, id } = await managed();
    // Valid bodies, so that what refuses them is who is asking and not the shape.
    const week = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      opens: '00:00',
      closes: '24:00',
    }));
    const gone = [
      ['get', `/owner/listings/${id}/owners`, undefined],
      ['get', `/owner/listings/${id}`, undefined],
      ['patch', `/owner/listings/${id}/location`, { name: 'Changed by a manager' }],
      [
        'put',
        `/owner/listings/${id}/prices`,
        {
          hourlyRateMinor: 200,
          dailyMaxMinor: null,
          bookingGapMinutes: 0,
          cancellationPolicy: 'oneDay',
          weekendRateMinor: null,
          night: null,
          datedPrices: [],
          longStayDiscounts: [],
        },
      ],
      [
        'put',
        `/owner/listings/${id}/spaces`,
        { spaces: [{ label: 'K1', features: [], hourlyRateMinor: null }] },
      ],
      ['put', `/owner/listings/${id}/hours`, { periods: week }],
      ['get', `/owner/listings/${id}/proofs/${randomUUID()}`, undefined],
      [
        'post',
        `/owner/listings/${id}/invites`,
        { email: 'someone@example.com', locale: 'en', role: 'manager' },
      ],
      [
        'put',
        `/owner/listings/${id}/shares`,
        { shares: [{ ownerId: randomUUID(), percent: 100 }] },
      ],
      ['post', `/owner/listings/${id}/submit`, { confirmed: true }],
      ['delete', `/owner/listings/${id}`, undefined],
      ['post', `/owner/listings/${id}/handover`, { ownerId: randomUUID() }],
    ] as const;
    for (const [method, path, body] of gone) {
      const response = await call(manager, method, path).send(body);
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const [row] = await db
      .select({ name: schema.parkingLocations.name })
      .from(schema.parkingLocations)
      .where(eq(schema.parkingLocations.id, id));
    expect(row?.name).not.toBe('Changed by a manager');
    // Earnings are their owners' alone: a manager has none, whatever the listing earned.
    const earnings = OwnerEarningsSchema.parse(
      (await call(manager, 'get', '/owner/earnings').expect(200)).body,
    );
    expect(earnings).toMatchObject({ sent: { amountMinor: 0 }, lines: [], listings: [] });
  });

  it('sees no stay that ended before they were added', async () => {
    const primary = await person();
    const manager = await person();
    const driver = await person();
    const id = await newListing(primary);
    const before = await booking(driver, id, -3);
    const { token } = await invite(primary, id, manager.email);
    await call(manager, 'post', '/owner/invites/accept').send({ token }).expect(200);
    const after = await booking(driver, id, 2);
    const month = (inDays: number) =>
      new Date(Date.now() + inDays * DAY_MS).toISOString().slice(0, 7);
    const ids = async (inDays: number) =>
      OwnerCalendarSchema.parse(
        (await call(manager, 'get', `/owner/calendar?month=${month(inDays)}`).expect(200)).body,
      ).days.flatMap((day) => day.bookings.map((found) => found.id));
    const seen = [...(await ids(-3)), ...(await ids(2))];
    expect(seen).toContain(after);
    expect(seen).not.toContain(before);
  });

  it('is not an owner already, and not a manager twice', async () => {
    const { primary, manager, id } = await managed();
    const again = await call(primary, 'post', `/owner/listings/${id}/invites`)
      .send({ email: manager.email, locale: 'en', role: 'manager' })
      .expect(409);
    expect(again.body).toMatchObject({ code: 'ALREADY_MANAGER' });
    const own = await call(primary, 'post', `/owner/listings/${id}/invites`)
      .send({ email: primary.email, locale: 'en', role: 'manager' })
      .expect(409);
    expect(own.body).toMatchObject({ code: 'ALREADY_OWNER' });
  });

  it('stops at its own limit, which owners’ places don’t count toward', async () => {
    const primary = await person();
    const id = await newListing(primary);
    for (let n = 0; n < LISTING_MANAGERS_MAX; n++) {
      await invite(primary, id, `mgr-${tag}-${n}@example.com`);
    }
    const over = await call(primary, 'post', `/owner/listings/${id}/invites`)
      .send({ email: `mgr-${tag}-over@example.com`, locale: 'en', role: 'manager' })
      .expect(409);
    expect(over.body).toMatchObject({ code: 'TOO_MANY_MANAGERS' });
    const seen = await owners(primary, id);
    expect(seen.managersRoom).toBe(0);
    expect(seen.room).toBe(9);
    // A co-owner can still be invited.
    await call(primary, 'post', `/owner/listings/${id}/invites`)
      .send({ email: `co-${tag}@example.com`, locale: 'en', role: 'co_owner' })
      .expect(200);
  });

  it('is removed by the primary alone, and can leave on their own (#70)', async () => {
    const { primary, manager, id } = await managed();
    const [row] = await db
      .select({ id: schema.listingManagers.id })
      .from(schema.listingManagers)
      .where(eq(schema.listingManagers.locationId, id));
    const stranger = await person();
    await call(stranger, 'delete', `/owner/listings/${id}/managers/${row?.id}`).expect(404);
    await call(manager, 'delete', `/owner/listings/${id}/managers/${row?.id}`).expect(404);
    expect((await owners(primary, id)).managers).toHaveLength(1);

    const removed = ListingOwnersSchema.parse(
      (await call(primary, 'delete', `/owner/listings/${id}/managers/${row?.id}`).expect(200)).body,
    );
    expect(removed.managers).toEqual([]);
    await call(manager, 'get', `/owner/calendar`).expect(200);
    await call(manager, 'get', `/owner/listings/${id}/bookings`).expect(404);
    await call(primary, 'delete', `/owner/listings/${id}/managers/${row?.id}`).expect(404);
    await call(primary, 'delete', `/owner/listings/${id}/managers/not-an-id`).expect(404);

    // Leaving: their own row, and the listing is the same 404 after.
    const { manager: leaver, id: other, primary: owner2 } = await managed();
    await call(leaver, 'post', `/owner/listings/${other}/leave`).expect(204);
    await call(leaver, 'get', `/owner/listings/${other}/bookings`).expect(404);
    expect((await owners(owner2, other)).managers).toEqual([]);
    // Someone who isn't one: the same 404 as any listing that isn't theirs.
    await call(stranger, 'post', `/owner/listings/${other}/leave`).expect(404);
  });

  it('becomes a co-owner by accepting an invite to co-own, in place of managing', async () => {
    const { primary, manager, id } = await managed();
    const { token } = await invite(primary, id, manager.email, 'co_owner');
    await call(manager, 'post', '/owner/invites/accept').send({ token }).expect(200);
    const seen = await owners(primary, id);
    expect(seen.managers).toEqual([]);
    expect(seen.owners.map((owner) => owner.role)).toEqual(['primary', 'co_owner']);
  });

  it('is turned away from an invite meant for another account', async () => {
    const primary = await person();
    const invited = await person();
    const stranger = await person();
    const id = await newListing(primary);
    const { token } = await invite(primary, id, invited.email);
    const response = await call(stranger, 'post', '/owner/invites/accept')
      .send({ token })
      .expect(409);
    expect(response.body).toMatchObject({ code: 'INVITE_FOR_ANOTHER_ACCOUNT' });
    expect(
      await db
        .select({ id: schema.listingManagers.id })
        .from(schema.listingManagers)
        .where(eq(schema.listingManagers.locationId, id)),
    ).toEqual([]);
  });

  it('cannot accept a manager invite while an owner of the same listing', async () => {
    const primary = await person();
    const coOwner = await person();
    const id = await newListing(primary);
    const co = await invite(primary, id, coOwner.email, 'co_owner');
    await call(coOwner, 'post', '/owner/invites/accept').send({ token: co.token }).expect(200);
    // An invite to manage made out to the same address before it was an owner's.
    const [made] = await db
      .insert(schema.listingInvites)
      .values({
        locationId: id,
        email: coOwner.email.toLowerCase(),
        locale: 'en',
        role: 'manager',
      })
      .returning({ id: schema.listingInvites.id });
    const minted = await mintInviteToken(db, made?.id ?? '');
    const response = await call(coOwner, 'post', '/owner/invites/accept')
      .send({ token: minted?.token })
      .expect(409);
    expect(response.body).toMatchObject({ code: 'ALREADY_OWNER' });
  });

  it('is taken off by the primary alone: a co-owner is refused, and so is the primary of another listing', async () => {
    const { primary, manager, id } = await managed();
    const coOwner = await person();
    const { token } = await invite(primary, id, coOwner.email, 'co_owner');
    await call(coOwner, 'post', '/owner/invites/accept').send({ token }).expect(200);
    const [row] = await db
      .select({ id: schema.listingManagers.id })
      .from(schema.listingManagers)
      .where(eq(schema.listingManagers.locationId, id));

    const refused = await call(
      coOwner,
      'delete',
      `/owner/listings/${id}/managers/${row?.id}`,
    ).expect(403);
    expect(refused.body).toMatchObject({ code: 'PRIMARY_ONLY' });

    // Another listing's primary, through their own listing's path: not this one's manager.
    const other = await person();
    const otherId = await newListing(other);
    const across = await call(
      other,
      'delete',
      `/owner/listings/${otherId}/managers/${row?.id}`,
    ).expect(404);
    expect(across.body).toMatchObject({ code: 'MANAGER_NOT_FOUND' });
    expect(
      await db
        .select({ id: schema.listingManagers.id })
        .from(schema.listingManagers)
        .where(eq(schema.listingManagers.userId, manager.id)),
    ).toHaveLength(1);
  });

  it('cannot come back with the link used before being removed', async () => {
    const primary = await person();
    const manager = await person();
    const id = await newListing(primary);
    const { token } = await invite(primary, id, manager.email);
    await call(manager, 'post', '/owner/invites/accept').send({ token }).expect(200);
    const [row] = await db
      .select({ id: schema.listingManagers.id })
      .from(schema.listingManagers)
      .where(eq(schema.listingManagers.locationId, id));
    await call(primary, 'delete', `/owner/listings/${id}/managers/${row?.id}`).expect(200);
    const replay = await call(manager, 'post', '/owner/invites/accept').send({ token }).expect(404);
    expect(replay.body).toMatchObject({ code: 'INVITE_NOT_FOUND' });
    expect(
      await db
        .select({ id: schema.listingManagers.id })
        .from(schema.listingManagers)
        .where(eq(schema.listingManagers.locationId, id)),
    ).toEqual([]);
  });

  it('cannot accept an invite that was withdrawn', async () => {
    const primary = await person();
    const invited = await person();
    const id = await newListing(primary);
    const { id: inviteId, token } = await invite(primary, id, invited.email);
    const withdrawn = ListingOwnersSchema.parse(
      (await call(primary, 'delete', `/owner/listings/${id}/invites/${inviteId}`).expect(200)).body,
    );
    // The place it held is free again, and it is the managers' place, not an owner's.
    expect(withdrawn.managersRoom).toBe(LISTING_MANAGERS_MAX);
    expect(withdrawn.room).toBe(9);
    const response = await call(invited, 'post', '/owner/invites/accept')
      .send({ token })
      .expect(404);
    expect(response.body).toMatchObject({ code: 'INVITE_NOT_FOUND' });
  });

  it('saves closures as a manager: kept, and the primary reads them back', async () => {
    const { primary, manager, id } = await managed();
    const day = new Date(Date.now() + 40 * DAY_MS).toISOString().slice(0, 10);
    const entry = { label: 'Cleaning', startsOn: day, endsOn: day, hours: null, closedHours: null };
    await call(manager, 'put', `/owner/listings/${id}/hours-exceptions`)
      .send({ exceptions: [entry] })
      .expect(200);
    const seen = await call(primary, 'get', `/owner/listings/${id}/hours-exceptions`).expect(200);
    expect((seen.body as { exceptions: { startsOn: string }[] }).exceptions).toEqual([
      expect.objectContaining({ startsOn: day }),
    ]);
    // Only the closures: the copy to other listings is the owners'.
    await call(manager, 'post', `/owner/listings/${id}/hours-exceptions/copy`)
      .send({ to: [randomUUID()] })
      .expect(404);
    await call(manager, 'get', `/owner/listings/${id}/others`).expect(404);
  });

  it('is told apart in what an owner reads: names for a co-owner, the address for the primary alone', async () => {
    const { primary, id } = await managed();
    const coOwner = await person();
    const { token } = await invite(primary, id, coOwner.email, 'co_owner');
    await call(coOwner, 'post', '/owner/invites/accept').send({ token }).expect(200);
    await invite(primary, id, `pending-${tag}@example.com`);
    const asPrimary = await owners(primary, id);
    expect(asPrimary.managers[0]?.email).not.toBeNull();
    const asCoOwner = await owners(coOwner, id);
    expect(asCoOwner.managers).toEqual([
      expect.objectContaining({ name: 'Test Driver', email: null }),
    ]);
    // A manager invite the co-owner didn't send: its address and its withdrawal are the primary's.
    expect(asCoOwner.invites).toEqual([
      expect.objectContaining({ role: 'manager', email: null, canWithdraw: false }),
    ]);
  });

  it('treats an address with an open invite of either kind as invited, and an owner as an owner', async () => {
    const primary = await person();
    const id = await newListing(primary);
    const address = `either-${tag}@example.com`;
    await invite(primary, id, address, 'manager');
    for (const role of ['manager', 'co_owner'] as const) {
      const again = await call(primary, 'post', `/owner/listings/${id}/invites`)
        .send({ email: address, locale: 'en', role })
        .expect(409);
      expect(again.body).toMatchObject({ code: 'ALREADY_INVITED' });
    }
    // A co-owner already, asked to manage: they are an owner.
    const coOwner = await person();
    const { token } = await invite(primary, id, coOwner.email, 'co_owner');
    await call(coOwner, 'post', '/owner/invites/accept').send({ token }).expect(200);
    const refused = await call(primary, 'post', `/owner/listings/${id}/invites`)
      .send({ email: coOwner.email, locale: 'en', role: 'manager' })
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'ALREADY_OWNER' });
    // Co-owner invites take owners' places, not managers'.
    const seen = await owners(primary, id);
    expect(seen.managersRoom).toBe(LISTING_MANAGERS_MAX - 1);
  });

  it('shows the calendar of one managed listing, and an owner who also manages another sees both', async () => {
    const driver = await person();
    const me = await person();
    const mine = await newListing(me);
    const theirPrimary = await person();
    const theirs = await newListing(theirPrimary);
    const { token } = await invite(theirPrimary, theirs, me.email);
    await call(me, 'post', '/owner/invites/accept').send({ token }).expect(200);
    const a = await booking(driver, mine, 15);
    const b = await booking(driver, theirs, 16);
    const strangerListing = await newListing(await person());
    const c = await booking(driver, strangerListing, 17);
    const month = (inDays: number) =>
      new Date(Date.now() + inDays * DAY_MS).toISOString().slice(0, 7);
    const ids = async (query: string) => {
      const seen = OwnerCalendarSchema.parse(
        (await call(me, 'get', `/owner/calendar${query}`).expect(200)).body,
      );
      return seen.days.flatMap((day) => day.bookings.map((found) => found.id));
    };
    const all = [...(await ids(`?month=${month(15)}`)), ...(await ids(`?month=${month(16)}`))];
    expect(all).toEqual(expect.arrayContaining([a, b]));
    expect(all).not.toContain(c);
    expect(await ids(`?month=${month(16)}&listing=${theirs}`)).toEqual([b]);
    // Someone else's listing: nothing, and not even that it exists.
    expect(await ids(`?month=${month(17)}&listing=${strangerListing}`)).toEqual([]);
  });

  it('is sent the manager’s invitation: the email queue says what it is to', async () => {
    const primary = await person();
    const id = await newListing(primary);
    const { id: inviteId } = await invite(primary, id, `queue-${tag}@example.com`);
    const claimed = await claimDueEmails(db, 200);
    try {
      expect(claimed.find((email) => email.inviteId === inviteId)).toMatchObject({
        kind: 'listing-invite',
        inviteRole: 'manager',
      });
    } finally {
      await releaseEmails(db, claimed);
    }
  });
});
