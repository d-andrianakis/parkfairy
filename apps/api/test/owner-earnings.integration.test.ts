import { randomUUID } from 'node:crypto';
import { EARNINGS_PAGE_SIZE, OwnerEarningsSchema, type OwnerEarnings } from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { and, eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/database/database.module.js';
import { newBookingReference } from '../src/bookings/booking-reference.js';
import { createTestApp, signUpUser, type TestApp, type TestUser } from './test-app.js';

// What an owner has earned (5.1). Chania: far from the demo areas and every other suite's point.
const HERE = { latitude: 35.5138, longitude: 24.018 };
const PREFIX = 'it-earn-';
const tag = randomUUID().slice(0, 8);
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

describe('owner earnings (5.1: #50, #51, #54)', () => {
  let app: TestApp;
  let db: Database;
  const users: TestUser[] = [];
  const visitors = new Map<string, string>();

  const call = (user: TestUser | null, path: string) => {
    const req = request(app.getHttpServer()).get(`/v1${path}`);
    if (!user) return req;
    let address = visitors.get(user.id);
    if (!address) {
      address = `198.41.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
      visitors.set(user.id, address);
    }
    return req.set('Cookie', user.cookie).set('X-Forwarded-For', address);
  };
  const earnings = async (user: TestUser, query = ''): Promise<OwnerEarnings> =>
    OwnerEarningsSchema.parse((await call(user, `/owner/earnings${query}`).expect(200)).body);

  async function person(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }

  async function owner(payouts: 'active' | 'restricted') {
    const user = await person();
    const [profile] = await db
      .insert(schema.ownerProfiles)
      .values({ userId: user.id, kind: 'individual' })
      .returning({ id: schema.ownerProfiles.id });
    const profileId = profile?.id ?? '';
    await db.insert(schema.payoutAccounts).values({
      ownerId: profileId,
      stripeAccountId: `acct_it${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      status: payouts,
    });
    return { user, profileId };
  }

  /** A listing owned by `primary`, and by `co` with 30% of the owners' share, if given. */
  async function listingOf(name: string, primary: string, co?: string) {
    const [row] = await db
      .insert(schema.parkingLocations)
      .values({
        ownerId: primary,
        slug: `${PREFIX}${tag}-${name}`,
        name: `Κέρδη ${name}`,
        address: 'Οδός Δοκιμής 5, Χανιά',
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

  type Payee = {
    ownerId: string;
    shareBps: number;
    sent?: { minor: number; at: Date };
    sending?: number;
  };
  /** A paid booking of a listing that ended `endedHoursAgo` hours ago (negative: not yet). */
  async function booking(
    driver: TestUser,
    locationId: string,
    endedHoursAgo: number,
    payees: Payee[],
    extra: Partial<typeof schema.bookings.$inferInsert> = {},
  ) {
    const endsAt = new Date(Date.now() - endedHoursAgo * HOUR_MS);
    const startsAt = new Date(endsAt.getTime() - 2 * HOUR_MS);
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
        confirmedAt: new Date(startsAt.getTime() - DAY_MS),
        paymentIntentId: `pi_it${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        paymentStatus: 'succeeded',
        stripeChargeId: `ch_it${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        ...extra,
      })
      .returning({ id: schema.bookings.id, reference: schema.bookings.reference });
    const id = row?.id ?? '';
    await db.insert(schema.bookingPayees).values(
      payees.map((payee) => ({
        bookingId: id,
        ownerId: payee.ownerId,
        shareBps: payee.shareBps,
        ...(payee.sent
          ? {
              transferMinor: payee.sent.minor,
              transferStatus: 'sent' as const,
              transferredAt: payee.sent.at,
              stripeTransferId: payee.sent.minor > 0 ? `tr_it${randomUUID().slice(0, 12)}` : null,
            }
          : payee.sending !== undefined
            ? { transferMinor: payee.sending, transferStatus: 'sending' as const }
            : {}),
      })),
    );
    return { id, reference: row?.reference ?? '' };
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
      .delete(schema.paymentDisputes)
      .where(inArray(schema.paymentDisputes.bookingId, ourBookings));
    await db
      .delete(schema.bookingPayees)
      .where(inArray(schema.bookingPayees.bookingId, ourBookings));
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
      await db
        .delete(schema.payoutAccounts)
        .where(
          inArray(
            schema.payoutAccounts.ownerId,
            db
              .select({ id: schema.ownerProfiles.id })
              .from(schema.ownerProfiles)
              .where(inArray(schema.ownerProfiles.userId, ids)),
          ),
        );
      await db.delete(schema.ownerProfiles).where(inArray(schema.ownerProfiles.userId, ids));
      await db.delete(schema.users).where(inArray(schema.users.id, ids));
    }
    await app.close();
  });

  it('needs an account', async () => {
    await call(null, '/owner/earnings').expect(401);
  });

  it('is nothing for someone who never started as an owner, and for an owner with no bookings', async () => {
    const nobody = await person();
    const none = await earnings(nobody);
    expect(none).toMatchObject({
      sent: { amountMinor: 0 },
      sending: { amountMinor: 0 },
      coming: 0,
      held: { account: 0, dispute: 0 },
      months: [],
      listings: [],
      inProgress: [],
      lines: [],
      next: null,
    });
    const { user } = await owner('active');
    expect(await earnings(user)).toEqual(none);
  });

  it('shows each co-owner only their own part of a shared booking', async () => {
    const driver = await person();
    const primary = await owner('active');
    const co = await owner('active');
    const id = await listingOf('shared', primary.profileId, co.profileId);
    const sentAt = new Date(Date.now() - 2 * DAY_MS);
    const { reference } = await booking(driver, id, 72, [
      { ownerId: primary.profileId, shareBps: 7000, sent: { minor: 252, at: sentAt } },
      { ownerId: co.profileId, shareBps: 3000, sent: { minor: 108, at: sentAt } },
    ]);

    const mine = await earnings(primary.user);
    expect(mine.sent).toEqual({ amountMinor: 252, currency: 'EUR' });
    expect(mine.lines).toMatchObject([
      {
        reference,
        state: 'sent',
        amount: { amountMinor: 252, currency: 'EUR' },
        sentAt: sentAt.toISOString(),
        hold: null,
        listing: { id, name: 'Κέρδη shared', contentLocale: 'el' },
      },
    ]);
    expect(mine.listings).toEqual([
      expect.objectContaining({ amount: { amountMinor: 252, currency: 'EUR' } }),
    ]);

    const theirs = await earnings(co.user);
    expect(theirs.sent.amountMinor).toBe(108);
    expect(theirs.lines.map((line) => line.amount.amountMinor)).toEqual([108]);
    // Nothing in what either gets back is the other's, in any field.
    expect(JSON.stringify(mine)).not.toMatch(/"amountMinor":108(?!\d)/);
    expect(JSON.stringify(theirs)).not.toMatch(/"amountMinor":252(?!\d)/);
    expect(JSON.stringify(theirs)).not.toContain(primary.profileId);
    expect(JSON.stringify(mine)).not.toContain(co.profileId);
  });

  it('sums by the month a part was sent, and counts what is not worked out yet', async () => {
    const driver = await person();
    const { user, profileId } = await owner('active');
    const id = await listingOf('months', profileId);
    const now = Date.now();
    const sold = (minor: number, daysAgo: number) => ({
      ownerId: profileId,
      shareBps: 10_000,
      sent: { minor, at: new Date(now - daysAgo * DAY_MS) },
    });
    await booking(driver, id, 24 * 3, [sold(100, 2)]);
    await booking(driver, id, 24 * 4, [sold(50, 3)]);
    // Long ago, out of the twelve months, but in the total.
    await booking(driver, id, 24 * 800, [sold(1_000, 790)]);
    // Paid, the stay not over: counted, no amount.
    await booking(driver, id, -48, [{ ownerId: profileId, shareBps: 10_000 }]);
    // Called off with everything back: nothing to come.
    await booking(driver, id, -72, [{ ownerId: profileId, shareBps: 10_000 }], {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: 'driver',
      refundMinor: 400,
    });
    // A hold that was never paid has no payees at all, so it can't be here.

    const seen = await earnings(user);
    expect(seen.sent.amountMinor).toBe(1_150);
    expect(seen.coming).toBe(1);
    expect(seen.held).toEqual({ account: 0, dispute: 0 });
    // The two recent parts are in the months shown (this one, or the one before at the turn).
    const recent = seen.months.reduce((sum, month) => sum + month.amount.amountMinor, 0);
    expect(recent).toBe(150);
    expect(seen.months.length).toBeLessThanOrEqual(2);
    expect(seen.months.every((month) => /^\d{4}-\d{2}$/.test(month.month))).toBe(true);
    // Newest first.
    expect(seen.lines.map((line) => line.amount.amountMinor)).toEqual([100, 50, 1_000]);
  });

  it('tells a part worked out and not sent from one sent, and why it waits', async () => {
    const driver = await person();
    const active = await owner('active');
    const restricted = await owner('restricted');
    const id = await listingOf('waiting', active.profileId, restricted.profileId);
    const plain = await booking(driver, id, 72, [
      { ownerId: active.profileId, shareBps: 7000, sending: 252 },
      { ownerId: restricted.profileId, shareBps: 3000, sending: 108 },
    ]);
    const disputed = await booking(driver, id, 72, [
      { ownerId: active.profileId, shareBps: 7000, sending: 252 },
      { ownerId: restricted.profileId, shareBps: 3000, sending: 108 },
    ]);
    await db.insert(schema.paymentDisputes).values({
      bookingId: disputed.id,
      stripeDisputeId: `dp_it${randomUUID().slice(0, 12)}`,
      status: 'needs_response',
      reason: 'fraudulent',
      amountMinor: 400,
      currency: 'EUR',
    });

    const fine = await earnings(active.user);
    expect(fine.sent.amountMinor).toBe(0);
    expect(fine.sending.amountMinor).toBe(504);
    expect(fine.lines).toEqual([]);
    expect(fine.inProgress.map((line) => line.amount.amountMinor)).toEqual([252, 252]);
    // The other owner's amount, as an amount: an id may hold the digits by chance.
    expect(JSON.stringify(fine.inProgress)).not.toMatch(/"amountMinor":108(?!\d)/);
    expect(fine.inProgress).toHaveLength(2);
    const byReference = new Map(fine.inProgress.map((line) => [line.reference, line]));
    expect(byReference.get(plain.reference)).toMatchObject({ state: 'sending', hold: null });
    expect(byReference.get(disputed.reference)).toMatchObject({
      state: 'sending',
      hold: 'dispute',
    });

    const stuck = await earnings(restricted.user);
    const stuckBy = new Map(stuck.inProgress.map((line) => [line.reference, line]));
    // Their account can't be paid (#52); a dispute outranks it (#58).
    expect(stuckBy.get(plain.reference)).toMatchObject({ hold: 'account', sentAt: null });
    expect(stuckBy.get(disputed.reference)).toMatchObject({ hold: 'dispute' });
    expect(stuck.sending.amountMinor).toBe(216);
    expect(stuck.inProgress.map((line) => line.amount.amountMinor)).toEqual([108, 108]);
    expect(JSON.stringify(stuck.inProgress)).not.toMatch(/"amountMinor":252(?!\d)/);
  });

  it('tells a part staff decided the owners bear that it will not be paid, and one Parkfairy bears that it will (#83)', async () => {
    const driver = await person();
    const active = await owner('active');
    const id = await listingOf('lostdispute', active.profileId);
    const mine = [{ ownerId: active.profileId, shareBps: 10_000, sending: 360 }];
    const forfeited = await booking(driver, id, 72, mine);
    const released = await booking(driver, id, 72, mine);
    const [admin] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, active.user.id));
    const lose = async (bookingId: string, decision: 'owners_bear' | 'parkfairy_bears' | null) => {
      const [row] = await db
        .insert(schema.paymentDisputes)
        .values({
          bookingId,
          stripeDisputeId: `dp_it${randomUUID().slice(0, 12)}`,
          status: 'lost',
          reason: 'fraudulent',
          amountMinor: 400,
          currency: 'EUR',
          ...(decision ? { decision, decidedBy: admin?.id, decidedAt: new Date() } : {}),
        })
        .returning({ id: schema.paymentDisputes.id });
      return row?.id ?? '';
    };
    // Lost and nobody has decided: held, as a dispute.
    await lose(forfeited.id, null);
    await lose(released.id, null);
    const waiting = new Map(
      (await earnings(active.user)).inProgress.map((line) => [line.reference, line]),
    );
    expect(waiting.get(forfeited.reference)).toMatchObject({ hold: 'dispute' });
    expect(waiting.get(released.reference)).toMatchObject({ hold: 'dispute' });
    // Decided: the owners bear it, and the part says it will not be paid; Parkfairy bears it, and
    // the part is no longer held.
    await db
      .update(schema.paymentDisputes)
      .set({ decision: 'owners_bear', decidedBy: admin?.id ?? '', decidedAt: new Date() })
      .where(eq(schema.paymentDisputes.bookingId, forfeited.id));
    await db
      .update(schema.paymentDisputes)
      .set({ decision: 'parkfairy_bears', decidedBy: admin?.id ?? '', decidedAt: new Date() })
      .where(eq(schema.paymentDisputes.bookingId, released.id));
    const decided = new Map(
      (await earnings(active.user)).inProgress.map((line) => [line.reference, line]),
    );
    expect(decided.get(forfeited.reference)).toMatchObject({ state: 'sending', hold: 'lost' });
    expect(decided.get(released.reference)).toMatchObject({ state: 'sending', hold: null });
  });

  it('counts what is due and held, by the account or by a dispute', async () => {
    const driver = await person();
    const restricted = await owner('restricted');
    const id = await listingOf('held', restricted.profileId);
    const mine = [{ ownerId: restricted.profileId, shareBps: 10_000 }];
    // Over 24 hours ago, so due, and the account can't take it.
    await booking(driver, id, 72, mine);
    // Over, but not 24 hours yet: still only coming.
    await booking(driver, id, 5, mine);
    const disputed = await booking(driver, id, 72, mine);
    await db.insert(schema.paymentDisputes).values({
      bookingId: disputed.id,
      stripeDisputeId: `dp_it${randomUUID().slice(0, 12)}`,
      status: 'needs_response',
      reason: 'fraudulent',
      amountMinor: 400,
      currency: 'EUR',
    });
    expect(await earnings(restricted.user)).toMatchObject({
      coming: 3,
      held: { account: 1, dispute: 1 },
    });
  });

  it('counts only each co-owner’s own bookings still to come, and what holds them', async () => {
    const driver = await person();
    const primary = await owner('active');
    const co = await owner('restricted');
    const id = await listingOf('counts', primary.profileId, co.profileId);
    const both = [
      { ownerId: primary.profileId, shareBps: 7000 },
      { ownerId: co.profileId, shareBps: 3000 },
    ];
    // Over a day ago: due, and only the restricted co-owner is held by their account.
    await booking(driver, id, 72, both);
    // Not over yet: coming for both.
    await booking(driver, id, -48, both);
    // A booking of the co-owner's own, on another listing the primary has no part in.
    const own = await listingOf('counts-own', co.profileId);
    await booking(driver, own, -24, [{ ownerId: co.profileId, shareBps: 10_000 }]);

    expect(await earnings(primary.user)).toMatchObject({
      coming: 2,
      held: { account: 0, dispute: 0 },
    });
    expect(await earnings(co.user)).toMatchObject({
      coming: 3,
      held: { account: 1, dispute: 0 },
    });
  });

  it('holds nothing for a dispute settled for the owners, and an owner with no account at all is held by it', async () => {
    const driver = await person();
    const user = await person();
    const [profile] = await db
      .insert(schema.ownerProfiles)
      .values({ userId: user.id, kind: 'individual' })
      .returning({ id: schema.ownerProfiles.id });
    const profileId = profile?.id ?? '';
    const id = await listingOf('no-account', profileId);
    const mine = [{ ownerId: profileId, shareBps: 10_000 }];
    const won = await booking(driver, id, 72, mine);
    await db.insert(schema.paymentDisputes).values({
      bookingId: won.id,
      stripeDisputeId: `dp_it${randomUUID().slice(0, 12)}`,
      status: 'won',
      reason: 'fraudulent',
      amountMinor: 400,
      currency: 'EUR',
    });
    // Due, no payout account row at all, and the dispute is over: held by the account only.
    expect(await earnings(user)).toMatchObject({
      coming: 1,
      held: { account: 1, dispute: 0 },
    });
  });

  it('pages the parts sent from a place, newest first, with none missed or repeated', async () => {
    const driver = await person();
    const { user, profileId } = await owner('active');
    const id = await listingOf('pages', profileId);
    const total = EARNINGS_PAGE_SIZE + 5;
    const base = Date.now() - 100 * HOUR_MS;
    for (let n = 0; n < total; n++) {
      // Two to an instant, so the id decides between them.
      await booking(driver, id, 100, [
        {
          ownerId: profileId,
          shareBps: 10_000,
          sent: { minor: n + 1, at: new Date(base + Math.floor(n / 2) * 1000) },
        },
      ]);
    }
    const first = await earnings(user);
    expect(first.lines).toHaveLength(EARNINGS_PAGE_SIZE);
    expect(first.next).not.toBeNull();
    const second = await earnings(user, `?after=${first.next}`);
    expect(second.lines).toHaveLength(total - EARNINGS_PAGE_SIZE);
    expect(second.next).toBeNull();
    const ids = [...first.lines, ...second.lines].map((line) => line.id);
    expect(new Set(ids).size).toBe(total);
    // The totals don't depend on the page; what is on its way is shown on the first only.
    expect(second.sent).toEqual(first.sent);
    expect(second.inProgress).toEqual([]);
    const times = [...first.lines, ...second.lines].map((line) => line.sentAt ?? '');
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('refuses a place that no page gave out', async () => {
    const { user } = await owner('active');
    for (const after of ['soon', '1_x', `${'9'.repeat(15)}_${randomUUID()}`]) {
      await call(user, `/owner/earnings?after=${after}`).expect(400);
    }
    // Another owner's place is just a place: it reads this owner's rows, so nothing of theirs.
    const other = await owner('active');
    const driver = await person();
    const id = await listingOf('theirs', other.profileId);
    await booking(driver, id, 72, [
      { ownerId: other.profileId, shareBps: 10_000, sent: { minor: 77, at: new Date() } },
    ]);
    const seen = await earnings(other.user);
    const place = seen.lines[0];
    expect(place).toBeDefined();
    const mine = await earnings(user, `?after=${Date.now()}_${place?.id}`);
    expect(mine.lines).toEqual([]);
    expect(JSON.stringify(mine)).not.toContain('77');
  });

  it('keeps a booking another owner’s listing to them, however it was reached', async () => {
    const driver = await person();
    const a = await owner('active');
    const b = await owner('active');
    const idA = await listingOf('only-a', a.profileId);
    await booking(driver, idA, 72, [
      { ownerId: a.profileId, shareBps: 10_000, sent: { minor: 360, at: new Date() } },
    ]);
    const seen = await earnings(b.user);
    expect(seen.sent.amountMinor).toBe(0);
    expect(seen.listings).toEqual([]);
    expect(
      await db
        .select({ id: schema.bookingPayees.id })
        .from(schema.bookingPayees)
        .where(and(eq(schema.bookingPayees.ownerId, b.profileId))),
    ).toEqual([]);
  });
});
