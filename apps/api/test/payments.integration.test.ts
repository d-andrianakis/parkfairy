import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import {
  addDays,
  type Booking,
  BookingPaymentSchema,
  BookingSchema,
  DEFAULT_TIME_ZONE,
  OwnerPayoutsSchema,
  ParkingListingDetailSchema,
  PayoutLinkSchema,
  zonedParts,
  zonedTimeToUtc,
} from '@parkfairy/contracts';
import {
  type Database,
  deleteStaleHolds,
  disputesToAnswer,
  expireLapsedHolds,
  lapsedPayments,
  ledgerMismatches,
  lostDisputesHeld,
  markTransferSending,
  noteMoneyRetry,
  recordCancelRefund,
  recordCharge,
  recordDispute,
  recordPayeeTransfer,
  recordPaymentCanceled,
  refundsOwed,
  schema,
  transfersDue,
  transfersWaiting,
} from '@parkfairy/database';
import { PaymentProviderError, sharesOf, splitShares } from '@parkfairy/payments';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ENV } from '../src/config/config.module.js';
import { loadEnv } from '../src/config/env.js';
import { DB } from '../src/database/database.module.js';
import { PAYMENTS } from '../src/payments/payments.tokens.js';
import { accountObject, fakeStripe, signedEvent } from './fake-stripe.js';
import { createTestApp, signUpUser, type TestApp, type TestUser } from './test-app.js';

// Rethymno: far from the demo areas and every other suite's point.
const HERE = { latitude: 35.366, longitude: 24.4823 };
const PREFIX = 'it-pay-';
const tag = randomUUID().slice(0, 8);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
const WEEK = [1, 2, 3, 4, 5, 6, 7];
const zone = DEFAULT_TIME_ZONE;
const today = zonedParts(new Date(), zone).date;
let nextOffset = 5;
const freshDay = () => addDays(today, nextOffset++);
const at = (day: string, time: string) => zonedTimeToUtc(day, time, zone)?.toISOString() ?? '';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const stayOn = (day: string) => ({ start: at(day, '10:00'), end: at(day, '12:00') });

describe('payments (Stripe in test mode, faked: decision #47)', () => {
  let app: TestApp;
  let db: Database;
  const stripe = fakeStripe();
  const users: TestUser[] = [];
  let addresses = 0;
  const visitors = new Map<string, string>();

  const api = (user: TestUser | null, method: 'get' | 'post', path: string) => {
    const call = request(app.getHttpServer())[method](`/v1${path}`);
    if (method !== 'get') call.set('Origin', ORIGIN);
    if (!user) return call;
    let address = visitors.get(user.id);
    if (!address) {
      address = `198.20.${Math.floor(addresses / 250)}.${(addresses % 250) + 1}`;
      addresses++;
      visitors.set(user.id, address);
    }
    return call.set('Cookie', user.cookie).set('X-Forwarded-For', address);
  };
  const deliver = ({ payload, signature }: { payload: string; signature?: string }) => {
    const call = request(app.getHttpServer())
      .post('/v1/payments/webhook')
      .set('Content-Type', 'application/json');
    return (signature ? call.set('Stripe-Signature', signature) : call).send(payload);
  };

  async function person(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }

  /** An owner with a profile, and an Express account in the state asked for (or none). */
  async function owner(
    payouts: 'active' | 'restricted' | null,
    kind: 'individual' | 'business' = 'individual',
  ) {
    const user = await person();
    const [profile] = await db
      .insert(schema.ownerProfiles)
      .values({ userId: user.id, kind })
      .returning({ id: schema.ownerProfiles.id });
    const profileId = profile?.id ?? '';
    if (payouts) {
      const accountId = `acct_it${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      await db
        .insert(schema.payoutAccounts)
        .values({ ownerId: profileId, stripeAccountId: accountId, status: payouts });
      stripe.accounts.set(accountId, payouts);
    }
    return { user, profileId };
  }

  async function listingOf(ownerProfileId: string, name: string) {
    const slug = `${PREFIX}${tag}-${name}`;
    const [row] = await db
      .insert(schema.parkingLocations)
      .values({
        ownerId: ownerProfileId,
        slug,
        name: `Πληρωμή ${name}`,
        address: 'Οδός Δοκιμής 3, Ρέθυμνο',
        areaId: 'syntagma',
        location: HERE,
        hourlyRateMinor: 200,
        bookingGapMinutes: 0,
        cancellationPolicy: 'oneDay',
        status: 'published',
      })
      .returning({ id: schema.parkingLocations.id });
    const id = row?.id ?? '';
    // Its owner, as the API makes a listing: the primary, with all of the owners' share (#53).
    await db
      .insert(schema.listingOwners)
      .values({ locationId: id, ownerId: ownerProfileId, role: 'primary', shareBps: 10_000 });
    const [space] = await db
      .insert(schema.parkingSpaces)
      .values({ locationId: id, label: 'A1' })
      .returning({ id: schema.parkingSpaces.id });
    await db
      .insert(schema.parkingOpeningHours)
      .values(
        WEEK.map((weekday) => ({ locationId: id, weekday, opensMinute: 0, closesMinute: 1440 })),
      );
    return { id, slug, spaceId: space?.id ?? '' };
  }

  const hold = (user: TestUser, listing: { slug: string; spaceId: string }, day: string) =>
    api(user, 'post', '/bookings').send({
      listing: listing.slug,
      spaceId: listing.spaceId,
      ...stayOn(day),
    });
  const pay = (user: TestUser, id: string, vehiclePlate = 'ΙΚΒ-1234') =>
    api(user, 'post', `/bookings/${id}/payment`).send({ vehiclePlate });
  const settle = (user: TestUser, id: string) =>
    api(user, 'post', `/bookings/${id}/payment/settle`);
  const row = async (id: string) => {
    const [found] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    if (!found) throw new Error('No booking');
    return found;
  };
  const emailsAbout = (id: string) =>
    db
      .select({ kind: schema.emailOutbox.kind })
      .from(schema.emailOutbox)
      .where(sql`${schema.emailOutbox.payload} -> 'booking' ->> 'id' = ${id}`);

  let paidListing: { id: string; slug: string; spaceId: string };

  /** A driver's hold on the paid listing, the payment asked for. */
  async function heldAndPaying(driver: TestUser, day = freshDay()) {
    const held = BookingSchema.parse((await hold(driver, paidListing, day).expect(201)).body);
    const payment = BookingPaymentSchema.parse((await pay(driver, held.id).expect(200)).body);
    const intent = (await row(held.id)).paymentIntentId ?? '';
    return { held, payment, intent, day };
  }

  async function removeOurs() {
    const ours = await db
      .select({ id: schema.parkingLocations.id })
      .from(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    const ids = ours.map((found) => found.id);
    if (ids.length === 0) return;
    // Financial records: they never cascade, so they go first, by hand.
    await db
      .delete(schema.paymentDisputes)
      .where(
        inArray(
          schema.paymentDisputes.bookingId,
          db
            .select({ id: schema.bookings.id })
            .from(schema.bookings)
            .where(inArray(schema.bookings.locationId, ids)),
        ),
      );
    await db
      .delete(schema.ledgerEntries)
      .where(
        inArray(
          schema.ledgerEntries.bookingId,
          db
            .select({ id: schema.bookings.id })
            .from(schema.bookings)
            .where(inArray(schema.bookings.locationId, ids)),
        ),
      );
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
    // As production has it: with Stripe, never the stand-in (loadEnv can't give both).
    app = await createTestApp([], (builder) =>
      builder
        .overrideProvider(PAYMENTS)
        .useValue(stripe.gateway)
        .overrideProvider(ENV)
        .useValue({ ...loadEnv(), bookingWithoutPayment: false }),
    );
    db = app.get<Database>(DB);
    await removeOurs();
    const { profileId } = await owner('active');
    paidListing = await listingOf(profileId, 'paid');
  });

  beforeEach(() => {
    // Back to the fake's own behaviour, with nothing queued from a test before.
    for (const fn of Object.values(stripe.gateway)) {
      if ('mockReset' in fn) fn.mockReset();
    }
  });

  afterAll(async () => {
    await removeOurs();
    const ids = users.map((user) => user.id);
    await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.userId, ids));
    const profiles = await db
      .select({ id: schema.ownerProfiles.id })
      .from(schema.ownerProfiles)
      .where(inArray(schema.ownerProfiles.userId, ids));
    const profileIds = profiles.map((found) => found.id);
    if (profileIds.length > 0) {
      await db
        .delete(schema.payoutAccounts)
        .where(inArray(schema.payoutAccounts.ownerId, profileIds));
    }
    await app.close();
  });

  it.each([
    ['get', '/owner/payouts'],
    ['post', '/owner/payouts/onboarding'],
    ['post', '/owner/payouts/dashboard'],
    ['post', `/bookings/${randomUUID()}/payment`],
    ['post', `/bookings/${randomUUID()}/payment/settle`],
  ] as const)('needs an account for %s %s', async (method, path) => {
    await api(null, method, path).send({}).expect(401);
  });

  describe('owner payouts (decision #48)', () => {
    it('starts with none, and needs to know who the owner is before an account', async () => {
      const stranger = await person();
      const status = OwnerPayoutsSchema.parse(
        (await api(stranger, 'get', '/owner/payouts').expect(200)).body,
      );
      expect(status).toEqual({ available: true, status: 'none' });
      const refused = await api(stranger, 'post', '/owner/payouts/onboarding')
        .send({ locale: 'el' })
        .expect(409);
      expect(refused.body).toMatchObject({ code: 'PROFILE_REQUIRED' });
      expect(stripe.gateway.createPayoutAccount).not.toHaveBeenCalled();
      await api(stranger, 'post', '/owner/payouts/onboarding').send({ locale: 'fr' }).expect(400);
    });

    it('makes one Express account and links into onboarding, back in the owner’s language', async () => {
      const { user, profileId } = await owner(null, 'business');
      const first = PayoutLinkSchema.parse(
        (await api(user, 'post', '/owner/payouts/onboarding').send({ locale: 'el' }).expect(200))
          .body,
      );
      expect(first.url).toMatch(/^https:\/\/connect\.stripe\.com\//);
      expect(stripe.gateway.createPayoutAccount).toHaveBeenCalledWith({
        ownerId: profileId,
        email: user.email,
        country: 'GR',
        businessType: 'company',
      });
      expect(stripe.gateway.onboardingLink).toHaveBeenCalledWith(
        expect.objectContaining({
          returnUrl: `${ORIGIN}/el/owner/payouts?link=returned`,
          refreshUrl: `${ORIGIN}/el/owner/payouts?link=expired`,
        }),
      );
      const [account] = await db
        .select()
        .from(schema.payoutAccounts)
        .where(eq(schema.payoutAccounts.ownerId, profileId));
      expect(account?.status).toBe('restricted');

      // Again: the same account, linked again.
      await api(user, 'post', '/owner/payouts/onboarding').send({ locale: 'en' }).expect(200);
      expect(stripe.gateway.createPayoutAccount).toHaveBeenCalledOnce();
      expect(stripe.gateway.onboardingLink).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: account?.stripeAccountId }),
      );
    });

    it('asks Stripe how it stands until active, a minute apart at most, and keeps what it says', async () => {
      const { user, profileId } = await owner('restricted');
      const [account] = await db
        .select()
        .from(schema.payoutAccounts)
        .where(eq(schema.payoutAccounts.ownerId, profileId));
      const accountId = account?.stripeAccountId ?? '';
      const age = () =>
        db
          .update(schema.payoutAccounts)
          .set({ statusAt: sql`now() - interval '2 minutes'` })
          .where(eq(schema.payoutAccounts.ownerId, profileId));
      // Heard of just now: not asked again.
      stripe.accounts.set(accountId, 'pending');
      expect(
        OwnerPayoutsSchema.parse((await api(user, 'get', '/owner/payouts').expect(200)).body)
          .status,
      ).toBe('restricted');
      expect(stripe.gateway.accountStatus).not.toHaveBeenCalled();
      await age();
      expect((await api(user, 'get', '/owner/payouts').expect(200)).body).toEqual({
        available: true,
        status: 'pending',
      });
      stripe.accounts.set(accountId, 'active');
      await age();
      expect(
        OwnerPayoutsSchema.parse((await api(user, 'get', '/owner/payouts').expect(200)).body)
          .status,
      ).toBe('active');
      const asked = stripe.gateway.accountStatus.mock.calls.length;
      // Active is kept: nothing more to ask.
      await age();
      expect(
        OwnerPayoutsSchema.parse((await api(user, 'get', '/owner/payouts').expect(200)).body)
          .status,
      ).toBe('active');
      expect(stripe.gateway.accountStatus).toHaveBeenCalledTimes(asked);
    });

    it('answers what it last heard when Stripe can’t be asked', async () => {
      const { user } = await owner('restricted');
      stripe.gateway.accountStatus.mockRejectedValueOnce(new PaymentProviderError('api_error'));
      expect(
        OwnerPayoutsSchema.parse((await api(user, 'get', '/owner/payouts').expect(200)).body),
      ).toEqual({ available: true, status: 'restricted' });
    });

    it('opens the Stripe dashboard only once onboarding is done', async () => {
      const unfinished = await owner('restricted');
      const refused = await api(unfinished.user, 'post', '/owner/payouts/dashboard').expect(409);
      expect(refused.body).toMatchObject({ code: 'PAYOUTS_NOT_STARTED' });
      const done = await owner('active');
      const link = PayoutLinkSchema.parse(
        (await api(done.user, 'post', '/owner/payouts/dashboard').expect(200)).body,
      );
      expect(link.url).toMatch(/^https:\/\/connect\.stripe\.com\/express\//);
    });

    it('answers 503 when Stripe fails, and keeps no account', async () => {
      const { user, profileId } = await owner(null);
      stripe.gateway.createPayoutAccount.mockRejectedValueOnce(
        new PaymentProviderError('api_error'),
      );
      const failed = await api(user, 'post', '/owner/payouts/onboarding')
        .send({ locale: 'en' })
        .expect(503);
      expect(failed.body).toMatchObject({ code: 'PAYMENT_PROVIDER_ERROR' });
      expect(JSON.stringify(failed.body)).not.toMatch(/api_error/);
      expect(
        await db
          .select()
          .from(schema.payoutAccounts)
          .where(eq(schema.payoutAccounts.ownerId, profileId)),
      ).toEqual([]);
    });
  });

  describe('the webhook', () => {
    it('refuses what Stripe didn’t sign, touching nothing', async () => {
      const { profileId } = await owner('restricted');
      const [account] = await db
        .select()
        .from(schema.payoutAccounts)
        .where(eq(schema.payoutAccounts.ownerId, profileId));
      const accountId = account?.stripeAccountId ?? '';
      const event = signedEvent('account.updated', accountObject(accountId, 'active'));
      await deliver({ payload: event.payload }).expect(400);
      const forged = signedEvent('account.updated', accountObject(accountId, 'active'), {
        secret: 'whsec_somebodyElse',
      });
      expect((await deliver(forged).expect(400)).body).toMatchObject({ code: 'INVALID_SIGNATURE' });
      // Signed, then changed.
      await deliver({
        payload: event.payload.replace('"active"', '"inactive"'),
        signature: event.signature,
      }).expect(400);
      const [after] = await db
        .select()
        .from(schema.payoutAccounts)
        .where(eq(schema.payoutAccounts.stripeAccountId, accountId));
      expect(after?.status).toBe('restricted');
    });

    it('keeps the newer word on an account: an older event arriving late changes nothing', async () => {
      const { profileId } = await owner('restricted');
      const [account] = await db
        .select()
        .from(schema.payoutAccounts)
        .where(eq(schema.payoutAccounts.ownerId, profileId));
      const accountId = account?.stripeAccountId ?? '';
      const now = Math.floor(Date.now() / 1000);
      await deliver(
        signedEvent('account.updated', accountObject(accountId, 'active'), { created: now + 5 }),
      ).expect(200);
      await deliver(
        signedEvent('account.updated', accountObject(accountId, 'restricted'), { created: now }),
      ).expect(200);
      const [after] = await db
        .select()
        .from(schema.payoutAccounts)
        .where(eq(schema.payoutAccounts.stripeAccountId, accountId));
      expect(after?.status).toBe('active');
    });

    it('answers events it has no use for, and leaves another app’s payments alone', async () => {
      await deliver(signedEvent('customer.created', { id: 'cus_1', object: 'customer' })).expect(
        200,
      );
      const foreign = stripe.foreignPayment();
      await deliver(
        signedEvent('payment_intent.succeeded', { id: foreign, object: 'payment_intent' }),
      ).expect(200);
      expect(stripe.refunds).not.toContain(foreign);
    });
  });

  describe('paying for a booking (decisions #3, #49)', () => {
    it('books nothing where the owner can’t be paid yet', async () => {
      const { profileId } = await owner('restricted');
      const unpaid = await listingOf(profileId, 'unpaid');
      const detail = ParkingListingDetailSchema.parse(
        (await api(null, 'get', `/parking/${unpaid.slug}`).expect(200)).body,
      );
      expect(detail.bookingOpen).toBe(false);
      const refused = await hold(await person(), unpaid, freshDay()).expect(409);
      expect(refused.body).toMatchObject({ code: 'BOOKING_UNAVAILABLE' });
    });

    it('books nothing for an owner with no payout account at all', async () => {
      const { profileId } = await owner(null);
      const none = await listingOf(profileId, 'no-account');
      const detail = ParkingListingDetailSchema.parse(
        (await api(null, 'get', `/parking/${none.slug}`).expect(200)).body,
      );
      expect(detail.bookingOpen).toBe(false);
    });

    it('holds with the commission of the day, and takes the plate and the payment', async () => {
      const detail = ParkingListingDetailSchema.parse(
        (await api(null, 'get', `/parking/${paidListing.slug}`).expect(200)).body,
      );
      expect(detail.bookingOpen).toBe(true);
      const driver = await person();
      const held = BookingSchema.parse(
        (await hold(driver, paidListing, freshDay()).expect(201)).body,
      );
      expect(held).toMatchObject({ status: 'held', checkout: 'payment', payment: null });
      expect((await row(held.id)).commissionBps).toBe(1000);

      // The stand-in press isn't offered beside Stripe.
      expect(
        (
          await api(driver, 'post', `/bookings/${held.id}/confirm`)
            .send({ vehiclePlate: 'IKB1234' })
            .expect(409)
        ).body,
      ).toMatchObject({ code: 'BOOKING_UNAVAILABLE' });

      const payment = BookingPaymentSchema.parse((await pay(driver, held.id).expect(200)).body);
      expect(payment.status).toBe('pending');
      expect(stripe.gateway.createPayment).toHaveBeenCalledWith({
        bookingId: held.id,
        reference: held.reference,
        amountMinor: held.total.amountMinor,
        currency: 'EUR',
      });
      const stored = await row(held.id);
      expect(stored).toMatchObject({
        vehiclePlate: 'IKB1234',
        paymentStatus: 'pending',
        status: 'held',
      });
      expect(payment.clientSecret.startsWith(`${stored.paymentIntentId}_secret_`)).toBe(true);

      // Asked again (a reload, a second press): the same payment.
      const again = BookingPaymentSchema.parse(
        (await pay(driver, held.id, 'IKB 1235').expect(200)).body,
      );
      expect(again.clientSecret).toBe(payment.clientSecret);
      expect(stripe.gateway.createPayment).toHaveBeenCalledOnce();
      expect((await row(held.id)).vehiclePlate).toBe('IKB1235');
    });

    it('takes the commission as it is on the day of the hold', async () => {
      await db.update(schema.platformSettings).set({ commissionBps: 1200 });
      try {
        const held = BookingSchema.parse(
          (await hold(await person(), paidListing, freshDay()).expect(201)).body,
        );
        expect((await row(held.id)).commissionBps).toBe(1200);
      } finally {
        await db.update(schema.platformSettings).set({ commissionBps: 1000 });
      }
    });

    it('confirms when Stripe says the money is in, once, with both emails', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      stripe.setPayment(intent, { status: 'succeeded' });
      const event = signedEvent('payment_intent.succeeded', {
        id: intent,
        object: 'payment_intent',
      });
      await deliver(event).expect(200);
      const stored = await row(held.id);
      expect(stored).toMatchObject({ status: 'confirmed', paymentStatus: 'succeeded' });
      expect(stored.confirmedAt).not.toBeNull();
      expect((await emailsAbout(held.id)).map(({ kind }) => kind).sort()).toEqual([
        'booking-confirmed',
        'booking-received',
      ]);
      // Delivered again: handled once.
      const asked = stripe.gateway.payment.mock.calls.length;
      await deliver(event).expect(200);
      expect(stripe.gateway.payment).toHaveBeenCalledTimes(asked);
      expect(await emailsAbout(held.id)).toHaveLength(2);
      // The driver's page says so, and paying again is refused.
      const seen = BookingSchema.parse(
        (await api(driver, 'get', `/bookings/${held.id}`).expect(200)).body,
      );
      expect(seen).toMatchObject({ status: 'confirmed', payment: 'succeeded' });
      expect((await pay(driver, held.id).expect(409)).body).toMatchObject({
        code: 'BOOKING_NOT_ACTIVE',
      });
    });

    it('settles from the driver’s page, without waiting for the webhook', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      stripe.setPayment(intent, { status: 'processing' });
      const processing = BookingSchema.parse((await settle(driver, held.id).expect(200)).body);
      expect(processing).toMatchObject({ status: 'held', payment: 'processing' });
      stripe.setPayment(intent, { status: 'succeeded' });
      const settled = BookingSchema.parse((await settle(driver, held.id).expect(200)).body);
      expect(settled).toMatchObject({ status: 'confirmed', payment: 'succeeded' });
      // Asked again, as it is.
      await settle(driver, held.id).expect(200);
      expect(await emailsAbout(held.id)).toHaveLength(2);
    });

    it('keeps a late payment while the space is still free (#3)', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: sql`now() - interval '1 minute'` })
        .where(eq(schema.bookings.id, held.id));
      await expireLapsedHolds(db, new Date());
      expect((await row(held.id)).status).toBe('expired');
      stripe.setPayment(intent, { status: 'succeeded' });
      const late = BookingSchema.parse((await settle(driver, held.id).expect(200)).body);
      expect(late).toMatchObject({ status: 'confirmed', payment: 'succeeded' });
      expect(stripe.refunds).not.toContain(intent);
    });

    it('gives a late payment back when the space was taken meanwhile (#3)', async () => {
      const driver = await person();
      const { held, intent, day } = await heldAndPaying(driver);
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: sql`now() - interval '1 minute'` })
        .where(eq(schema.bookings.id, held.id));
      await expireLapsedHolds(db, new Date());
      // Another driver holds the space for the same stay.
      await hold(await person(), paidListing, day).expect(201);
      stripe.setPayment(intent, { status: 'succeeded' });
      await deliver(
        signedEvent('payment_intent.succeeded', { id: intent, object: 'payment_intent' }),
      ).expect(200);
      expect(stripe.refunds).toContain(intent);
      expect(stripe.gateway.refundPayment).toHaveBeenCalledWith(intent, 'not_bookable');
      const seen = BookingSchema.parse(
        (await api(driver, 'get', `/bookings/${held.id}`).expect(200)).body,
      );
      expect(seen).toMatchObject({ status: 'expired', payment: 'refunded' });
      // The driver hears of it, whether or not the page is open; the owner, of nothing.
      expect(await emailsAbout(held.id)).toEqual([{ kind: 'booking-payment-refunded' }]);
      expect((await row(held.id)).vehiclePlate).toBeNull();
      // Asked again, nothing more happens.
      await settle(driver, held.id).expect(200);
      expect(stripe.gateway.refundPayment).toHaveBeenCalledOnce();
    });

    it('gives the money back for a hold let go, or an amount not the booking’s', async () => {
      const driver = await person();
      const released = await heldAndPaying(driver);
      await api(driver, 'post', `/bookings/${released.held.id}/cancel`).send({}).expect(200);
      stripe.setPayment(released.intent, { status: 'succeeded' });
      expect(
        BookingSchema.parse((await settle(driver, released.held.id).expect(200)).body),
      ).toMatchObject({
        status: 'released',
        payment: 'refunded',
      });

      const other = await person();
      const odd = await heldAndPaying(other);
      stripe.setPayment(odd.intent, {
        status: 'succeeded',
        amountMinor: odd.held.total.amountMinor - 1,
      });
      expect(
        BookingSchema.parse((await settle(other, odd.held.id).expect(200)).body),
      ).toMatchObject({
        status: 'released',
        payment: 'refunded',
      });
      expect(stripe.refunds).toEqual(expect.arrayContaining([released.intent, odd.intent]));
    });

    it('answers 503 when Stripe fails, charging nothing and keeping no payment', async () => {
      const driver = await person();
      const held = BookingSchema.parse(
        (await hold(driver, paidListing, freshDay()).expect(201)).body,
      );
      stripe.gateway.createPayment.mockRejectedValueOnce(
        new PaymentProviderError('api_connection_error'),
      );
      expect((await pay(driver, held.id).expect(503)).body).toMatchObject({
        code: 'PAYMENT_PROVIDER_ERROR',
      });
      expect((await row(held.id)).paymentIntentId).toBeNull();
    });

    it('never refunds a booking made, cancelled since: its refund is its policy’s (H1)', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      stripe.setPayment(intent, { status: 'succeeded' });
      await settle(driver, held.id).expect(200);
      await api(driver, 'post', `/bookings/${held.id}/cancel`).send({}).expect(200);
      expect((await row(held.id)).status).toBe('cancelled');
      await settle(driver, held.id).expect(200);
      await deliver(
        signedEvent('payment_intent.succeeded', { id: intent, object: 'payment_intent' }),
      ).expect(200);
      expect(stripe.gateway.refundPayment).not.toHaveBeenCalled();
      expect((await row(held.id)).paymentStatus).toBe('succeeded');
    });

    it('records a refund before asking Stripe, and nothing books it while Stripe fails (H2)', async () => {
      const driver = await person();
      const { held, intent, day } = await heldAndPaying(driver);
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: sql`now() - interval '1 minute'` })
        .where(eq(schema.bookings.id, held.id));
      await expireLapsedHolds(db, new Date());
      const other = await person();
      const blocker = BookingSchema.parse((await hold(other, paidListing, day).expect(201)).body);
      stripe.setPayment(intent, { status: 'succeeded' });
      stripe.gateway.refundPayment.mockRejectedValueOnce(new PaymentProviderError('api_error'));
      const event = signedEvent('payment_intent.succeeded', {
        id: intent,
        object: 'payment_intent',
      });
      await deliver(event).expect(500);
      expect(await row(held.id)).toMatchObject({ status: 'expired', paymentStatus: 'refunding' });
      // The space comes free meanwhile: a settle now finishes the refund, it books nothing.
      await api(other, 'post', `/bookings/${blocker.id}/cancel`).send({}).expect(200);
      const seen = BookingSchema.parse((await settle(driver, held.id).expect(200)).body);
      expect(seen).toMatchObject({ status: 'expired', payment: 'refunded' });
      // Stripe's retry of the event changes nothing more, and one refund is kept.
      await deliver(event).expect(200);
      expect(stripe.gateway.refundPayment).toHaveBeenCalledTimes(2);
      expect(stripe.refunds.filter((id) => id === intent)).toHaveLength(1);
      expect(await emailsAbout(held.id)).toEqual([{ kind: 'booking-payment-refunded' }]);
    });

    it('records a refund Stripe already made, rather than ask for it again (N1)', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      // Refunded at Stripe, and our write lost after its answer: the row says `refunding`.
      stripe.setPayment(intent, { status: 'succeeded' });
      stripe.setPayment(intent, { refundedMinor: held.total.amountMinor });
      await db
        .update(schema.bookings)
        .set({ paymentStatus: 'refunding', status: 'released', vehiclePlate: null })
        .where(eq(schema.bookings.id, held.id));
      expect(BookingSchema.parse((await settle(driver, held.id).expect(200)).body)).toMatchObject({
        payment: 'refunded',
      });
      expect(stripe.gateway.refundPayment).not.toHaveBeenCalled();
    });

    it('gives back a late payment for a stay already begun (M1)', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      await db
        .update(schema.bookings)
        .set({
          status: 'expired',
          startsAt: sql`now() - interval '1 hour'`,
          endsAt: sql`now() + interval '1 hour'`,
          blockedUntil: sql`now() + interval '1 hour'`,
          holdExpiresAt: sql`now() - interval '2 hours'`,
        })
        .where(eq(schema.bookings.id, held.id));
      stripe.setPayment(intent, { status: 'succeeded' });
      expect(BookingSchema.parse((await settle(driver, held.id).expect(200)).body)).toMatchObject({
        status: 'expired',
        payment: 'refunded',
      });
    });

    it('leaves alone a payment for a booking this database doesn’t have', async () => {
      const foreign = (
        await stripe.gateway.createPayment({
          bookingId: randomUUID(),
          reference: 'K7M4-Q2ZD',
          amountMinor: 400,
          currency: 'EUR',
        })
      ).id;
      stripe.setPayment(foreign, { status: 'succeeded' });
      await deliver(
        signedEvent('payment_intent.succeeded', { id: foreign, object: 'payment_intent' }),
      ).expect(200);
      expect(stripe.gateway.refundPayment).not.toHaveBeenCalled();
    });

    it('answers 500 when Stripe can’t be asked, keeps no event, and handles the retry', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      stripe.setPayment(intent, { status: 'succeeded' });
      const event = signedEvent('payment_intent.succeeded', {
        id: intent,
        object: 'payment_intent',
      });
      stripe.gateway.payment.mockRejectedValueOnce(new PaymentProviderError('api_error'));
      await deliver(event).expect(500);
      expect(
        await db
          .select()
          .from(schema.stripeEvents)
          .where(eq(schema.stripeEvents.stripeEventId, event.id)),
      ).toEqual([]);
      await deliver(event).expect(200);
      expect((await row(held.id)).status).toBe('confirmed');
      expect(await emailsAbout(held.id)).toHaveLength(2);
    });

    it('confirms once when the page and the webhook settle at the same moment', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      stripe.setPayment(intent, { status: 'succeeded' });
      const event = signedEvent('payment_intent.succeeded', {
        id: intent,
        object: 'payment_intent',
      });
      await Promise.all([settle(driver, held.id).expect(200), deliver(event).expect(200)]);
      expect((await row(held.id)).status).toBe('confirmed');
      expect(await emailsAbout(held.id)).toHaveLength(2);
      expect(stripe.gateway.refundPayment).not.toHaveBeenCalled();
    });

    it('finds the booking by its PaymentIntent’s metadata when the PaymentIntent wasn’t kept', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      await db
        .update(schema.bookings)
        .set({ paymentIntentId: null, paymentStatus: null })
        .where(eq(schema.bookings.id, held.id));
      stripe.setPayment(intent, { status: 'succeeded' });
      await deliver(
        signedEvent('payment_intent.succeeded', { id: intent, object: 'payment_intent' }),
      ).expect(200);
      expect(await row(held.id)).toMatchObject({
        status: 'confirmed',
        paymentIntentId: intent,
        paymentStatus: 'succeeded',
      });
    });

    it('asks Stripe nothing more once a booking is settled', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      stripe.setPayment(intent, { status: 'succeeded' });
      await settle(driver, held.id).expect(200);
      const asked = stripe.gateway.payment.mock.calls.length;
      await settle(driver, held.id).expect(200);
      expect(stripe.gateway.payment).toHaveBeenCalledTimes(asked);
    });

    it('keeps a paying driver’s hold, by a press or by going to pay when it runs low', async () => {
      const driver = await person();
      const held = BookingSchema.parse(
        (await hold(driver, paidListing, freshDay()).expect(201)).body,
      );
      const kept = BookingSchema.parse(
        (await api(driver, 'post', `/bookings/${held.id}/extend`).expect(200)).body,
      );
      expect(kept.holdExtensionsLeft).toBe(held.holdExtensionsLeft - 1);
      // Two minutes left when the driver goes to pay: a full ten again (WCAG 2.2.1).
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: sql`now() + interval '2 minutes'` })
        .where(eq(schema.bookings.id, held.id));
      await pay(driver, held.id).expect(200);
      const renewed = await row(held.id);
      expect(renewed.holdExpiresAt.getTime() - Date.now()).toBeGreaterThan(8 * 60_000);
      expect(renewed.holdExtensions).toBe(2);
      // Plenty left: paying keeps it as it is.
      await pay(driver, held.id).expect(200);
      expect((await row(held.id)).holdExtensions).toBe(2);
    });

    it('keeps another driver away from my payment', async () => {
      const driver = await person();
      const { held } = await heldAndPaying(driver);
      const stranger = await person();
      expect((await pay(stranger, held.id).expect(404)).body).toMatchObject({
        code: 'BOOKING_NOT_FOUND',
      });
      expect((await settle(stranger, held.id).expect(404)).body).toMatchObject({
        code: 'BOOKING_NOT_FOUND',
      });
    });

    it('keeps a hold a payment was asked for out of the stale-hold sweep', async () => {
      const driver = await person();
      const { held } = await heldAndPaying(driver);
      await api(driver, 'post', `/bookings/${held.id}/cancel`).send({}).expect(200);
      // Beside it, a hold let go without a payment: that one goes.
      const plain = BookingSchema.parse(
        (await hold(await person(), paidListing, freshDay()).expect(201)).body,
      );
      await db
        .update(schema.bookings)
        .set({ status: 'released' })
        .where(eq(schema.bookings.id, plain.id));
      await deleteStaleHolds(db, new Date(Date.now() + 86_400_000));
      expect((await row(held.id)).status).toBe('released');
      expect(
        await db.select().from(schema.bookings).where(eq(schema.bookings.id, plain.id)),
      ).toEqual([]);
    });
  });
  describe('refunds, transfers and the ledger (4.2: decisions #4, #50, #51, #52)', () => {
    let pastDays = 3;

    /** A driver's booking on a listing, paid for and confirmed. */
    async function paidBooking(listing = paidListing) {
      const driver = await person();
      const held = BookingSchema.parse((await hold(driver, listing, freshDay()).expect(201)).body);
      await pay(driver, held.id).expect(200);
      const intent = (await row(held.id)).paymentIntentId ?? '';
      stripe.setPayment(intent, { status: 'succeeded' });
      expect(BookingSchema.parse((await settle(driver, held.id).expect(200)).body).status).toBe(
        'confirmed',
      );
      return { driver, held, intent, total: held.total.amountMinor };
    }

    /** The stay moved back to days ago, each its own day: its transfer is due a day on. */
    async function endedDaysAgo(id: string) {
      const days = pastDays++;
      await db
        .update(schema.bookings)
        .set({
          startsAt: sql`now() - make_interval(days => ${days}, hours => 2)`,
          endsAt: sql`now() - make_interval(days => ${days})`,
          blockedUntil: sql`now() - make_interval(days => ${days})`,
        })
        .where(eq(schema.bookings.id, id));
    }

    const cancel = (driver: TestUser, id: string) =>
      api(driver, 'post', `/bookings/${id}/cancel`).send({});
    const inLedger = async (id: string) =>
      Object.fromEntries(
        (
          await db
            .select({ kind: schema.ledgerEntries.kind, amount: schema.ledgerEntries.amountMinor })
            .from(schema.ledgerEntries)
            .where(eq(schema.ledgerEntries.bookingId, id))
        ).map(({ kind, amount }) => [kind, amount]),
      );
    const dueIds = async (now = new Date()) => (await transfersDue(db, now)).map(({ id }) => id);
    const soon = () => new Date(Date.now() + 60_000);
    const recently = () => new Date(Date.now() - 60_000);
    /** A ledger entry made wrong for a moment, put back after. */
    async function tamper(
      bookingId: string,
      kind: 'refund' | 'commission',
      amountMinor: number,
      check: () => Promise<void>,
    ) {
      const entry = and(
        eq(schema.ledgerEntries.bookingId, bookingId),
        eq(schema.ledgerEntries.kind, kind),
      );
      const [was] = await db
        .select({ amount: schema.ledgerEntries.amountMinor })
        .from(schema.ledgerEntries)
        .where(entry);
      await db.update(schema.ledgerEntries).set({ amountMinor }).where(entry);
      try {
        await check();
      } finally {
        await db
          .update(schema.ledgerEntries)
          .set({ amountMinor: was?.amount ?? 0 })
          .where(entry);
      }
    }
    /** An owner, active, with a listing of their own under the policy given. */
    async function ownListing(name: string, policy: 'oneDay' | 'oneDayThenHalf' = 'oneDay') {
      const { user, profileId } = await owner('active');
      const listing = await listingOf(profileId, name);
      if (policy !== 'oneDay') {
        await db
          .update(schema.parkingLocations)
          .set({ cancellationPolicy: policy })
          .where(eq(schema.parkingLocations.id, listing.id));
      }
      return { user, profileId, listing };
    }
    /** The stay moved to start within the day: a cancellation now falls under its late terms. */
    const startingSoon = (id: string) =>
      db
        .update(schema.bookings)
        .set({
          startsAt: sql`now() + interval '2 hours'`,
          endsAt: sql`now() + interval '4 hours'`,
          blockedUntil: sql`now() + interval '4 hours'`,
        })
        .where(eq(schema.bookings.id, id));

    it('enters the payment that booked, with the charge it came by', async () => {
      const { held, intent, total } = await paidBooking();
      const stored = await row(held.id);
      expect(stored.stripeChargeId).toBe(`ch_${intent.slice(3)}`);
      const entries = await db
        .select({
          kind: schema.ledgerEntries.kind,
          amountMinor: schema.ledgerEntries.amountMinor,
          currency: schema.ledgerEntries.currency,
          stripeId: schema.ledgerEntries.stripeId,
        })
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.bookingId, held.id));
      expect(entries).toEqual([
        { kind: 'charge', amountMinor: total, currency: 'EUR', stripeId: stored.stripeChargeId },
      ]);
      // Settled again: one entry still.
      await deliver(
        signedEvent('payment_intent.succeeded', { id: intent, object: 'payment_intent' }),
      ).expect(200);
      expect(await inLedger(held.id)).toEqual({ charge: total });
    });

    it('gives back what a driver’s cancellation gives, once, and enters it', async () => {
      const { driver, held, intent, total } = await paidBooking();
      const cancelled = BookingSchema.parse((await cancel(driver, held.id).expect(200)).body);
      // A week ahead under “a day before”: all of it.
      expect(cancelled).toMatchObject({ status: 'cancelled', refund: held.total });
      const stored = await row(held.id);
      expect(stored).toMatchObject({ refundStatus: 'sent', refundMinor: total });
      // One short try while the driver waits; the worker sends it otherwise.
      expect(stripe.gateway.refundCancelled).toHaveBeenCalledWith(
        { paymentIntentId: intent, bookingId: held.id, amountMinor: total },
        { quick: true },
      );
      expect(stripe.cancellationRefunds.get(held.id)).toMatchObject({
        id: stored.stripeRefundId,
        amountMinor: total,
      });
      // Asked again: as it is, and Stripe isn't asked twice.
      await cancel(driver, held.id).expect(200);
      expect(stripe.gateway.refundCancelled).toHaveBeenCalledOnce();
      expect(await inLedger(held.id)).toEqual({ charge: total, refund: total });
      // The day's check finds a refund entered that isn't the one the booking gives.
      await tamper(held.id, 'refund', total - 1, async () => {
        expect(await ledgerMismatches(db, recently())).toContain(held.id);
      });
      expect(await ledgerMismatches(db, recently())).not.toContain(held.id);
      // All of it went back: nothing for the owner, ever.
      await endedDaysAgo(held.id);
      expect(await dueIds()).not.toContain(held.id);
    });

    it('gives all of it back when the owner calls the booking off', async () => {
      const { user: ownerUser, profileId } = await owner('active');
      const listing = await listingOf(profileId, 'owner-cancels');
      const { held, total } = await paidBooking(listing);
      await api(ownerUser, 'post', `/owner/listings/${listing.id}/bookings/${held.id}/cancel`)
        .send({})
        .expect(204);
      expect(await row(held.id)).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'owner',
        refundMinor: total,
        refundStatus: 'sent',
      });
      expect(stripe.cancellationRefunds.get(held.id)?.amountMinor).toBe(total);
      expect(await inLedger(held.id)).toEqual({ charge: total, refund: total });
    });

    it('keeps the cancellation when Stripe fails, the refund owed until it is sent', async () => {
      const { driver, held, intent, total } = await paidBooking();
      const warned = vi.spyOn(Logger.prototype, 'warn');
      stripe.gateway.refundCancelled.mockRejectedValueOnce(
        new TypeError('card for maria@example.gr refused'),
      );
      expect(BookingSchema.parse((await cancel(driver, held.id).expect(200)).body)).toMatchObject({
        status: 'cancelled',
        refund: held.total,
      });
      // Its kind only: Stripe's words can name the driver.
      expect(warned).toHaveBeenCalledWith(
        { bookingId: held.id, detail: 'TypeError' },
        'cancellation refund left for the worker',
      );
      expect(JSON.stringify(warned.mock.calls)).not.toContain('maria');
      warned.mockRestore();
      expect(await row(held.id)).toMatchObject({ refundStatus: 'owed', stripeRefundId: null });
      expect(await inLedger(held.id)).toEqual({ charge: total });

      // Left alone while the API's own try may still be on its way; then owed, all of it.
      const owedIds = async (before: Date) => (await refundsOwed(db, before)).map(({ id }) => id);
      expect(await owedIds(new Date(Date.now() - 60_000))).not.toContain(held.id);
      expect((await refundsOwed(db, soon())).find(({ id }) => id === held.id)).toMatchObject({
        kind: 'cancelled',
        paymentIntentId: intent,
        amountMinor: total,
      });

      // As the worker sends it: recorded once, whatever comes after.
      const refundId = await stripe.gateway.refundCancelled({
        paymentIntentId: intent,
        bookingId: held.id,
        amountMinor: total,
      });
      await recordCancelRefund(db, held.id, refundId);
      await recordCancelRefund(db, held.id, 're_someOtherOne');
      expect(await row(held.id)).toMatchObject({ refundStatus: 'sent', stripeRefundId: refundId });
      expect(await inLedger(held.id)).toEqual({ charge: total, refund: total });
      expect(await owedIds(soon())).not.toContain(held.id);
    });

    it('sends the owner 90% of what’s kept a day after the stay, once, and it adds up', async () => {
      const { profileId } = await owner('active');
      const [account] = await db
        .select({ id: schema.payoutAccounts.stripeAccountId })
        .from(schema.payoutAccounts)
        .where(eq(schema.payoutAccounts.ownerId, profileId));
      const listing = await listingOf(profileId, 'half-back');
      await db
        .update(schema.parkingLocations)
        .set({ cancellationPolicy: 'oneDayThenHalf' })
        .where(eq(schema.parkingLocations.id, listing.id));
      const { driver, held, total } = await paidBooking(listing);
      expect(total).toBe(400);
      // Called off with the stay hours away: half back (#16), half kept.
      await db
        .update(schema.bookings)
        .set({
          cancellationPolicy: 'oneDayThenHalf',
          startsAt: sql`now() + interval '2 hours'`,
          endsAt: sql`now() + interval '4 hours'`,
          blockedUntil: sql`now() + interval '4 hours'`,
        })
        .where(eq(schema.bookings.id, held.id));
      await cancel(driver, held.id).expect(200);
      expect(await row(held.id)).toMatchObject({ refundMinor: 200, refundStatus: 'sent' });

      // Not until a day after the stay (#4): it ends in four hours.
      expect(await dueIds()).not.toContain(held.id);
      expect(await dueIds(new Date(Date.now() + 27 * HOUR_MS))).not.toContain(held.id);
      expect(await dueIds(new Date(Date.now() + 29 * HOUR_MS))).toContain(held.id);
      await endedDaysAgo(held.id);
      const due = (await transfersDue(db, new Date())).find(({ id }) => id === held.id);
      expect(due).toMatchObject({
        totalMinor: 400,
        refundMinor: 200,
        commissionBps: 1000,
        sending: null,
        // Its payee, copied at the hold: the owner, with all of the owners' share (#54).
        payees: [
          {
            ownerId: profileId,
            shareBps: 10_000,
            primary: true,
            accountId: account?.id,
            active: true,
            transferMinor: null,
            sent: false,
          },
        ],
      });
      expect(due?.chargeId).toMatch(/^ch_/);

      // 10% of what's kept to Parkfairy, the rest to the owner (#50, #51): €0.20 and €1.80.
      const shares = sharesOf({ totalMinor: 400, refundMinor: 200, commissionBps: 1000 });
      expect(shares).toEqual({ keptMinor: 200, commissionMinor: 20, ownerMinor: 180 });
      const amounts = { transferMinor: shares.ownerMinor, commissionMinor: shares.commissionMinor };
      expect(await markTransferSending(db, held.id, amounts, new Map([[profileId, 180]]))).toBe(
        true,
      );
      // A second worker's sums never replace the first's.
      expect(
        await markTransferSending(
          db,
          held.id,
          { transferMinor: 1, commissionMinor: 0 },
          new Map([[profileId, 1]]),
        ),
      ).toBe(false);
      expect(
        (await transfersDue(db, new Date())).find(({ id }) => id === held.id)?.sending,
      ).toMatchObject(amounts);
      const transferId = await stripe.gateway.transfer({
        bookingId: held.id,
        ownerId: profileId,
        accountId: account?.id ?? '',
        amountMinor: amounts.transferMinor,
        currency: 'EUR',
        chargeId: due?.chargeId ?? '',
      });
      await recordPayeeTransfer(db, held.id, profileId, transferId);
      await recordPayeeTransfer(db, held.id, profileId, 'tr_someOtherOne');
      const sent = await row(held.id);
      expect(sent).toMatchObject({
        transferStatus: 'sent',
        transferMinor: 180,
        commissionMinor: 20,
      });
      expect(sent.transferredAt).toBeInstanceOf(Date);
      const [paid] = await db
        .select()
        .from(schema.bookingPayees)
        .where(eq(schema.bookingPayees.bookingId, held.id));
      expect(paid).toMatchObject({
        ownerId: profileId,
        transferStatus: 'sent',
        transferMinor: 180,
        stripeTransferId: transferId,
      });
      expect(await dueIds()).not.toContain(held.id);
      expect(await inLedger(held.id)).toEqual({
        charge: 400,
        refund: 200,
        transfer: 180,
        commission: 20,
      });

      // The day's check finds it adds up, and finds it when it doesn't.
      const since = new Date(Date.now() - 60_000);
      expect(await ledgerMismatches(db, since)).not.toContain(held.id);
      const commission = and(
        eq(schema.ledgerEntries.bookingId, held.id),
        eq(schema.ledgerEntries.kind, 'commission'),
      );
      await db.update(schema.ledgerEntries).set({ amountMinor: 21 }).where(commission);
      expect(await ledgerMismatches(db, since)).toContain(held.id);
      await db.update(schema.ledgerEntries).set({ amountMinor: 20 }).where(commission);
      // Entered long before the window: not read again.
      expect(await ledgerMismatches(db, soon())).not.toContain(held.id);
    });

    it('keeps a restricted owner’s transfers waiting, counted for support, until active (#52)', async () => {
      const { profileId } = await owner('active');
      const listing = await listingOf(profileId, 'restricted');
      const { held } = await paidBooking(listing);
      await endedDaysAgo(held.id);
      const restricted = eq(schema.payoutAccounts.ownerId, profileId);
      await db.update(schema.payoutAccounts).set({ status: 'restricted' }).where(restricted);

      expect(await dueIds()).not.toContain(held.id);
      const waiting = await transfersWaiting(db, new Date());
      expect(waiting.bookings).toBeGreaterThanOrEqual(1);
      expect(waiting.owners).toBeGreaterThanOrEqual(1);
      // Due for a day or two only: not past the alert's days yet.
      const longer = await transfersWaiting(db, new Date(Date.now() - 30 * 86_400_000));
      expect(longer.bookings).toBeLessThan(waiting.bookings);

      // Active again: it goes on the next run.
      await db.update(schema.payoutAccounts).set({ status: 'active' }).where(restricted);
      expect(await dueIds()).toContain(held.id);
    });

    it('enters a paid hold’s money both ways when it all goes back', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      await cancel(driver, held.id).expect(200);
      stripe.setPayment(intent, { status: 'succeeded' });
      stripe.gateway.refundPayment.mockRejectedValueOnce(new PaymentProviderError('api_error'));
      await settle(driver, held.id).expect(503);
      // Decided, not yet with Stripe: owed, all of it.
      expect((await refundsOwed(db, soon())).find(({ id }) => id === held.id)).toMatchObject({
        kind: 'unbooked',
        paymentIntentId: intent,
        amountMinor: held.total.amountMinor,
      });
      await settle(driver, held.id).expect(200);
      expect(await row(held.id)).toMatchObject({ paymentStatus: 'refunded' });
      const total = held.total.amountMinor;
      expect(await inLedger(held.id)).toEqual({ charge: total, refund: total });
      expect(await ledgerMismatches(db, recently())).not.toContain(held.id);
      await tamper(held.id, 'refund', total - 1, async () => {
        expect(await ledgerMismatches(db, recently())).toContain(held.id);
      });
      // Money entered: the stale-hold sweep never takes it (nor fails on it).
      await expect(deleteStaleHolds(db, new Date(Date.now() + DAY_MS))).resolves.toBeTypeOf(
        'number',
      );
      expect((await row(held.id)).paymentStatus).toBe('refunded');
    });

    it('calls off the payment of a hold that lapsed unpaid, and lets the row go', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      await cancel(driver, held.id).expect(200);
      const lapsedIds = async (before: Date, cursor?: { at: string; id: string }) =>
        (await lapsedPayments(db, before, cursor)).map(({ id }) => id);
      // A late payment has its hour first (#3).
      expect(await lapsedIds(new Date(Date.now() - 3_600_000))).not.toContain(held.id);
      const lapsed = (await lapsedPayments(db, soon())).find(({ id }) => id === held.id);
      expect(lapsed).toMatchObject({ paymentIntentId: intent });
      // The next page starts after it.
      expect(await lapsedIds(soon(), lapsed?.cursor)).not.toContain(held.id);

      expect((await stripe.gateway.cancelPayment(intent)).status).toBe('canceled');
      await recordPaymentCanceled(db, held.id);
      expect(await row(held.id)).toMatchObject({
        status: 'released',
        paymentStatus: 'canceled',
        vehiclePlate: null,
      });
      expect(await lapsedIds(soon())).not.toContain(held.id);
      // The driver's page says so, and the row goes like any lapsed hold.
      expect(
        BookingSchema.parse((await api(driver, 'get', `/bookings/${held.id}`).expect(200)).body),
      ).toMatchObject({ status: 'released', payment: 'canceled' });
      await deleteStaleHolds(db, new Date(Date.now() + 86_400_000));
      expect(
        await db.select().from(schema.bookings).where(eq(schema.bookings.id, held.id)),
      ).toEqual([]);
    });

    it('holds the owner’s transfer while a partial refund is owed, even one Stripe refuses for good', async () => {
      const { listing } = await ownListing('owed-holds', 'oneDayThenHalf');
      const { driver, held, intent } = await paidBooking(listing);
      await startingSoon(held.id);
      stripe.gateway.refundCancelled.mockRejectedValueOnce(
        new PaymentProviderError('invalid_request_error charge_disputed'),
      );
      await cancel(driver, held.id).expect(200);
      expect(await row(held.id)).toMatchObject({ refundStatus: 'owed', refundMinor: 200 });
      await endedDaysAgo(held.id);
      // What's kept isn't final until the refund is with Stripe: nothing for the owner yet.
      expect(await dueIds()).not.toContain(held.id);
      expect(
        await markTransferSending(
          db,
          held.id,
          { transferMinor: 180, commissionMinor: 20 },
          new Map(),
        ),
      ).toBe(false);
      expect((await refundsOwed(db, soon())).find(({ id }) => id === held.id)).toMatchObject({
        kind: 'cancelled',
        paymentIntentId: intent,
        amountMinor: 200,
      });
      await recordCancelRefund(db, held.id, 're_supportMadeIt');
      expect(await dueIds()).toContain(held.id);
    });

    it('refunds once when the driver and the owner cancel at the same moment', async () => {
      const { user: ownerUser, listing } = await ownListing('both-cancel');
      const { driver, held, total } = await paidBooking(listing);
      await Promise.all([
        cancel(driver, held.id).expect(200),
        api(ownerUser, 'post', `/owner/listings/${listing.id}/bookings/${held.id}/cancel`)
          .send({})
          .expect(204),
      ]);
      expect(stripe.gateway.refundCancelled).toHaveBeenCalledOnce();
      const stored = await row(held.id);
      expect(stored).toMatchObject({ status: 'cancelled', refundStatus: 'sent' });
      expect(await inLedger(held.id)).toEqual({ charge: total, refund: stored.refundMinor });
    });

    it('lets no owner cancel, and so refund, another owner’s booking through their own listing', async () => {
      const { held } = await paidBooking();
      const { user: stranger, listing: theirs } = await ownListing('stranger');
      expect(
        (
          await api(stranger, 'post', `/owner/listings/${theirs.id}/bookings/${held.id}/cancel`)
            .send({})
            .expect(404)
        ).body,
      ).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      expect(stripe.gateway.refundCancelled).not.toHaveBeenCalled();
      expect((await row(held.id)).status).toBe('confirmed');
    });

    it('keeps all of a booking cancelled too late for a refund, and pays the owner 90% of it', async () => {
      const { listing } = await ownListing('too-late');
      const { driver, held, total } = await paidBooking(listing);
      await startingSoon(held.id);
      expect(BookingSchema.parse((await cancel(driver, held.id).expect(200)).body).refund).toEqual({
        amountMinor: 0,
        currency: 'EUR',
      });
      expect(await row(held.id)).toMatchObject({ refundMinor: 0, refundStatus: null });
      expect(stripe.gateway.refundCancelled).not.toHaveBeenCalled();
      expect(await inLedger(held.id)).toEqual({ charge: total });
      await endedDaysAgo(held.id);
      const due = (await transfersDue(db, new Date())).find(({ id }) => id === held.id);
      expect(due).toMatchObject({ totalMinor: 400, refundMinor: 0 });
      expect(sharesOf({ totalMinor: 400, refundMinor: 0, commissionBps: 1000 })).toMatchObject({
        commissionMinor: 40,
        ownerMinor: 360,
      });
    });

    it('enters what Stripe received for a paid hold given back, not the booking’s total', async () => {
      const driver = await person();
      const odd = await heldAndPaying(driver);
      const received = odd.held.total.amountMinor - 1;
      stripe.setPayment(odd.intent, { status: 'succeeded', amountMinor: received });
      expect(
        BookingSchema.parse((await settle(driver, odd.held.id).expect(200)).body).payment,
      ).toBe('refunded');
      expect(await inLedger(odd.held.id)).toEqual({ charge: received, refund: received });
      expect(await ledgerMismatches(db, recently())).not.toContain(odd.held.id);
    });

    it('keeps the charge Stripe names late, entering the payment once', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      stripe.setPayment(intent, { status: 'succeeded', chargeId: null });
      await settle(driver, held.id).expect(200);
      const total = held.total.amountMinor;
      expect((await row(held.id)).stripeChargeId).toBeNull();
      expect(await inLedger(held.id)).toEqual({ charge: total });
      await recordCharge(db, held.id, { amountMinor: total, chargeId: 'ch_late' });
      await recordCharge(db, held.id, { amountMinor: total, chargeId: 'ch_other' });
      expect((await row(held.id)).stripeChargeId).toBe('ch_late');
      expect(
        await db
          .select({
            stripeId: schema.ledgerEntries.stripeId,
            amount: schema.ledgerEntries.amountMinor,
          })
          .from(schema.ledgerEntries)
          .where(eq(schema.ledgerEntries.bookingId, held.id)),
      ).toEqual([{ stripeId: 'ch_late', amount: total }]);
    });

    it('pages transfers due by their end and then their id, equal ends included', async () => {
      const ours = [];
      for (const name of ['page-a', 'page-b', 'page-c']) {
        const { listing } = await ownListing(name);
        ours.push((await paidBooking(listing)).held.id);
      }
      const [first, second, third] = ours as [string, string, string];
      // Stays ending at the very same microsecond, and one a microsecond on.
      const end = '2025-01-15 12:00:00.123456+00';
      const later = '2025-01-15 12:00:00.123457+00';
      for (const [id, ends] of [
        [first, end],
        [second, end],
        [third, later],
      ] as const) {
        await db.execute(sql`
          update bookings set starts_at = ${ends}::timestamptz - interval '2 hours',
            ends_at = ${ends}::timestamptz, blocked_until = ${ends}::timestamptz
          where id = ${id}
        `);
      }
      const [low, high] = [first, second].sort() as [string, string];
      const page = (cursor?: { at: string; id: string }) =>
        transfersDue(db, new Date(), cursor).then((rows) => rows.map(({ id }) => id));
      const all = await page();
      expect(all.indexOf(low)).toBeLessThan(all.indexOf(high));
      expect(all.indexOf(high)).toBeLessThan(all.indexOf(third));
      const atLow = (await transfersDue(db, new Date())).find(({ id }) => id === low)?.cursor;
      expect(atLow?.at).toMatch(/\.123456/);
      const afterLow = await page(atLow);
      expect(afterLow).not.toContain(low);
      expect(afterLow).toEqual(expect.arrayContaining([high, third]));
      const afterHigh = await page({ at: atLow?.at ?? '', id: high });
      expect(afterHigh).not.toContain(high);
      expect(afterHigh).toContain(third);
    });

    it('pages refunds owed by when they were decided, equal times included', async () => {
      const ids = [];
      for (let n = 0; n < 2; n++) {
        const { driver, held } = await paidBooking();
        stripe.gateway.refundCancelled.mockRejectedValueOnce(new PaymentProviderError('api_error'));
        await cancel(driver, held.id).expect(200);
        ids.push(held.id);
      }
      const at = '2025-02-01 08:00:00.654321+00';
      await db.execute(
        sql`update bookings set updated_at = ${at}::timestamptz where id in (${ids[0]}, ${ids[1]})`,
      );
      const [low, high] = [...ids].sort() as [string, string];
      const owed = await refundsOwed(db, soon());
      const atLow = owed.find(({ id }) => id === low)?.cursor;
      expect(atLow?.id).toBe(low);
      expect(atLow?.at).toMatch(/\.654321/);
      const next = (await refundsOwed(db, soon(), atLow)).map(({ id }) => id);
      expect(next).toContain(high);
      expect(next).not.toContain(low);
    });

    it('backs a refused refund off, without making it look newly owed', async () => {
      const { driver, held } = await paidBooking();
      stripe.gateway.refundCancelled.mockRejectedValueOnce(new PaymentProviderError('api_error'));
      await cancel(driver, held.id).expect(200);
      const decided = (await row(held.id)).updatedAt;
      await noteMoneyRetry(db, held.id);
      const waiting = await row(held.id);
      expect(waiting.moneyAttempts).toBe(1);
      expect(waiting.moneyRetryAt?.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
      expect(waiting.updatedAt).toEqual(decided);
      expect((await refundsOwed(db, soon())).map(({ id }) => id)).not.toContain(held.id);
      // Twice as long the next time, six hours at most.
      for (let n = 0; n < 12; n++) await noteMoneyRetry(db, held.id);
      const longest = (await row(held.id)).moneyRetryAt?.getTime() ?? 0;
      expect(longest).toBeLessThanOrEqual(Date.now() + 6 * HOUR_MS + 60_000);
      // Once sent, back to none.
      await recordCancelRefund(db, held.id, 're_atLast');
      expect(await row(held.id)).toMatchObject({ moneyAttempts: 0, moneyRetryAt: null });
    });

    it('takes a refund that failed after Stripe took it out of the ledger, and tells support', async () => {
      const { driver, held, total } = await paidBooking();
      await cancel(driver, held.id).expect(200);
      const refundId = (await row(held.id)).stripeRefundId ?? '';
      // Still fine: an update that isn't a failure changes nothing.
      await deliver(signedEvent('refund.updated', { id: refundId, object: 'refund' })).expect(200);
      expect(await row(held.id)).toMatchObject({ refundStatus: 'sent' });

      const told = vi.spyOn(Logger.prototype, 'error');
      stripe.failRefund(held.id);
      const failed = signedEvent('refund.failed', { id: refundId, object: 'refund' });
      await deliver(failed).expect(200);
      expect(await row(held.id)).toMatchObject({
        refundStatus: 'failed',
        stripeRefundId: refundId,
      });
      expect(await inLedger(held.id)).toEqual({ charge: total });
      expect(told).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: held.id, refundId, status: 'failed' }),
        'refund failed at Stripe',
      );
      told.mockRestore();
      // Delivered again: handled once.
      await deliver(failed).expect(200);
      expect(stripe.gateway.refund).toHaveBeenCalledTimes(2);
    });

    it('never calls off the payment of a hold still held, or one the bank is deciding', async () => {
      const driver = await person();
      const { held } = await heldAndPaying(driver);
      await db.execute(
        sql`update bookings set updated_at = now() - interval '2 hours' where id = ${held.id}`,
      );
      const lapsedIds = async () => (await lapsedPayments(db, soon())).map(({ id }) => id);
      expect(await lapsedIds()).not.toContain(held.id);

      const other = await person();
      const deciding = await heldAndPaying(other);
      await cancel(other, deciding.held.id).expect(200);
      await db
        .update(schema.bookings)
        .set({ paymentStatus: 'processing' })
        .where(eq(schema.bookings.id, deciding.held.id));
      expect(await lapsedIds()).not.toContain(deciding.held.id);

      // Run out, though: it lapsed, and is called off an hour on.
      await db
        .update(schema.bookings)
        .set({ holdExpiresAt: sql`now() - interval '1 minute'` })
        .where(eq(schema.bookings.id, held.id));
      await expireLapsedHolds(db, new Date());
      expect(await lapsedIds()).toContain(held.id);
    });

    it('says a payment called off at Stripe is canceled when asked, and the hold still goes', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      await cancel(driver, held.id).expect(200);
      await stripe.gateway.cancelPayment(intent);
      expect(BookingSchema.parse((await settle(driver, held.id).expect(200)).body)).toMatchObject({
        status: 'released',
        payment: 'canceled',
      });
      expect((await row(held.id)).vehiclePlate).toBeNull();
      expect((await lapsedPayments(db, soon())).map(({ id }) => id)).not.toContain(held.id);
      await deleteStaleHolds(db, new Date(Date.now() + DAY_MS));
      expect(
        await db.select().from(schema.bookings).where(eq(schema.bookings.id, held.id)),
      ).toEqual([]);
    });

    it('counts a transfer as waiting only once due for the alert’s days', async () => {
      const { profileId, listing } = await ownListing('waiting-count');
      const { held } = await paidBooking(listing);
      await endedDaysAgo(held.id);
      await db
        .update(schema.payoutAccounts)
        .set({ status: 'restricted' })
        .where(eq(schema.payoutAccounts.ownerId, profileId));
      const dueAt = (await row(held.id)).endsAt.getTime() + DAY_MS;
      const before = await transfersWaiting(db, new Date(dueAt - 1_000));
      const after = await transfersWaiting(db, new Date(dueAt + 1_000));
      expect(after.bookings - before.bookings).toBe(1);
    });

    describe('co-owned listings (#53, #54)', () => {
      const open = async (slug: string) =>
        ParkingListingDetailSchema.parse(
          (await api(null, 'get', `/parking/${slug}`).expect(200)).body,
        ).bookingOpen;
      const share = (locationId: string, ownerId: string, shareBps: number) =>
        db
          .update(schema.listingOwners)
          .set({ shareBps })
          .where(
            and(
              eq(schema.listingOwners.locationId, locationId),
              eq(schema.listingOwners.ownerId, ownerId),
            ),
          );
      const accountOf = async (ownerId: string) => {
        const [row] = await db
          .select({ id: schema.payoutAccounts.stripeAccountId })
          .from(schema.payoutAccounts)
          .where(eq(schema.payoutAccounts.ownerId, ownerId));
        return row?.id ?? '';
      };
      const payeesOf = (bookingId: string) =>
        db
          .select({
            ownerId: schema.bookingPayees.ownerId,
            shareBps: schema.bookingPayees.shareBps,
            transferMinor: schema.bookingPayees.transferMinor,
            transferStatus: schema.bookingPayees.transferStatus,
          })
          .from(schema.bookingPayees)
          .where(eq(schema.bookingPayees.bookingId, bookingId));

      it('opens only while every owner with a share can be paid, and pays each their part', async () => {
        const { profileId: primaryId } = await owner('active');
        const co = await owner(null);
        const listing = await listingOf(primaryId, 'co-owned');
        await db
          .insert(schema.listingOwners)
          .values({ locationId: listing.id, ownerId: co.profileId, role: 'co_owner', shareBps: 0 });
        // At 0% a co-owner is paid nothing and needs no account: still open.
        expect(await open(listing.slug)).toBe(true);

        await share(listing.id, primaryId, 7000);
        await share(listing.id, co.profileId, 3000);
        // With a share and no account, drivers can't book it.
        expect(await open(listing.slug)).toBe(false);
        expect((await hold(await person(), listing, freshDay()).expect(409)).body).toMatchObject({
          code: 'BOOKING_UNAVAILABLE',
        });
        const coAccount = `acct_it${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        await db
          .insert(schema.payoutAccounts)
          .values({ ownerId: co.profileId, stripeAccountId: coAccount, status: 'active' });
        stripe.accounts.set(coAccount, 'active');
        expect(await open(listing.slug)).toBe(true);

        const { held } = await paidBooking(listing);
        expect(await payeesOf(held.id)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ ownerId: primaryId, shareBps: 7000 }),
            expect.objectContaining({ ownerId: co.profileId, shareBps: 3000 }),
          ]),
        );
        await endedDaysAgo(held.id);
        const due = (await transfersDue(db, new Date())).find(({ id }) => id === held.id);
        expect(due?.payees).toHaveLength(2);

        // 10% of €4.00 to Parkfairy; the owners' €3.60 split 70/30: €2.52 and €1.08.
        const shares = sharesOf({ totalMinor: 400, refundMinor: 0, commissionBps: 1000 });
        const parts = splitShares(shares.ownerMinor, due?.payees ?? []);
        expect(Object.fromEntries(parts)).toEqual({ [primaryId]: 252, [co.profileId]: 108 });
        expect(
          await markTransferSending(
            db,
            held.id,
            { transferMinor: shares.ownerMinor, commissionMinor: shares.commissionMinor },
            parts,
          ),
        ).toBe(true);

        // The co-owner's account restricted since: the primary is paid, the co-owner waits (#52).
        await db
          .update(schema.payoutAccounts)
          .set({ status: 'restricted' })
          .where(eq(schema.payoutAccounts.ownerId, co.profileId));
        expect(await dueIds()).toContain(held.id);
        const toPrimary = await stripe.gateway.transfer({
          bookingId: held.id,
          ownerId: primaryId,
          accountId: await accountOf(primaryId),
          amountMinor: 252,
          currency: 'EUR',
          chargeId: due?.chargeId ?? '',
        });
        await recordPayeeTransfer(db, held.id, primaryId, toPrimary);
        expect((await row(held.id)).transferStatus).toBe('sending');
        expect(await inLedger(held.id)).toEqual({ charge: 400, transfer: 252 });
        // Only the restricted one left: not due now, but counted as waiting.
        expect(await dueIds()).not.toContain(held.id);
        expect((await transfersWaiting(db, new Date())).owners).toBeGreaterThanOrEqual(1);

        await db
          .update(schema.payoutAccounts)
          .set({ status: 'active' })
          .where(eq(schema.payoutAccounts.ownerId, co.profileId));
        expect(await dueIds()).toContain(held.id);
        const toCo = await stripe.gateway.transfer({
          bookingId: held.id,
          ownerId: co.profileId,
          accountId: coAccount,
          amountMinor: 108,
          currency: 'EUR',
          chargeId: due?.chargeId ?? '',
        });
        expect(toCo).not.toBe(toPrimary);
        await recordPayeeTransfer(db, held.id, co.profileId, toCo);
        expect((await row(held.id)).transferStatus).toBe('sent');
        expect(await payeesOf(held.id)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              ownerId: primaryId,
              transferMinor: 252,
              transferStatus: 'sent',
            }),
            expect.objectContaining({
              ownerId: co.profileId,
              transferMinor: 108,
              transferStatus: 'sent',
            }),
          ]),
        );
        // Two transfers entered, one each, and the commission once all were paid: it adds up.
        const transfers = await db
          .select({
            ownerId: schema.ledgerEntries.ownerId,
            amount: schema.ledgerEntries.amountMinor,
          })
          .from(schema.ledgerEntries)
          .where(
            and(
              eq(schema.ledgerEntries.bookingId, held.id),
              eq(schema.ledgerEntries.kind, 'transfer'),
            ),
          );
        expect(transfers).toEqual(
          expect.arrayContaining([
            { ownerId: primaryId, amount: 252 },
            { ownerId: co.profileId, amount: 108 },
          ]),
        );
        expect((await inLedger(held.id)).commission).toBe(40);
        expect(await ledgerMismatches(db, recently())).not.toContain(held.id);
        expect(await dueIds()).not.toContain(held.id);
      });
    });

    describe('disputes (4.3: #57–#60)', () => {
      const disputeOf = async (stripeDisputeId: string) => {
        const [found] = await db
          .select()
          .from(schema.paymentDisputes)
          .where(eq(schema.paymentDisputes.stripeDisputeId, stripeDisputeId));
        return found;
      };
      const tell = (type: string, disputeId: string) =>
        deliver(signedEvent(type, { id: disputeId, object: 'dispute' }));

      it('records a dispute, stages the booking’s facts for support once, and holds the payout', async () => {
        const { driver, held, intent, total } = await paidBooking();
        await endedDaysAgo(held.id);
        expect(await dueIds()).toContain(held.id);

        const disputeId = stripe.openDispute(intent);
        await tell('charge.dispute.created', disputeId).expect(200);
        const recorded = await disputeOf(disputeId);
        expect(recorded).toMatchObject({
          bookingId: held.id,
          status: 'needs_response',
          reason: 'product_not_received',
          amountMinor: total,
          currency: 'EUR',
          submissions: 0,
        });
        expect(recorded?.dueBy).toBeInstanceOf(Date);
        expect(recorded?.evidenceStagedAt).toBeInstanceOf(Date);

        // The booking's facts, staged for support to complete and submit (#59).
        const staged = stripe.evidence.get(disputeId);
        expect(staged).toMatchObject({
          bookingId: held.id,
          customerEmail: driver.email,
          customerName: 'Test Driver',
        });
        expect(staged?.productDescription).toContain('A1');
        expect(staged?.productDescription).toContain('Πληρωμή paid');
        expect(staged?.cancellationPolicy).toContain('24 hours before the start');
        expect(staged?.uncategorized).toContain(held.reference);
        expect(staged?.refundPolicy).toContain('was not cancelled');
        // Not the plate (kept as Latin letters): support adds it if it helps.
        const plate = (await row(held.id)).vehiclePlate;
        expect(plate).toBe('IKB1234');
        expect(JSON.stringify(staged)).not.toContain(plate);

        // Told again: brought up to date, nothing staged twice.
        await tell('charge.dispute.updated', disputeId).expect(200);
        expect(stripe.gateway.stageDisputeEvidence).toHaveBeenCalledOnce();

        // Held while open (#58).
        expect(await dueIds()).not.toContain(held.id);
        expect(
          await markTransferSending(
            db,
            held.id,
            { transferMinor: 360, commissionMinor: 40 },
            new Map(),
          ),
        ).toBe(false);
      });

      it('lets the payout go once a dispute is won, and holds it when lost, for support (#57)', async () => {
        const won = await paidBooking();
        await endedDaysAgo(won.held.id);
        const wonId = stripe.openDispute(won.intent);
        await tell('charge.dispute.created', wonId).expect(200);
        stripe.setDispute(wonId, { status: 'under_review', submissions: 1 });
        await tell('charge.dispute.updated', wonId).expect(200);
        expect(await disputeOf(wonId)).toMatchObject({ status: 'under_review', submissions: 1 });
        expect(await dueIds()).not.toContain(won.held.id);
        stripe.setDispute(wonId, { status: 'won' });
        await tell('charge.dispute.closed', wonId).expect(200);
        expect((await disputeOf(wonId))?.status).toBe('won');
        expect(await dueIds()).toContain(won.held.id);

        const lost = await paidBooking();
        await endedDaysAgo(lost.held.id);
        const lostId = stripe.openDispute(lost.intent);
        await tell('charge.dispute.created', lostId).expect(200);
        stripe.setDispute(lostId, { status: 'lost' });
        const before = await lostDisputesHeld(db);
        await tell('charge.dispute.closed', lostId).expect(200);
        expect((await disputeOf(lostId))?.status).toBe('lost');
        expect(await dueIds()).not.toContain(lost.held.id);
        expect(await lostDisputesHeld(db)).toBe(before + 1);
        // Nothing happens to the driver's account (#60): they can still book.
        await hold(lost.driver, paidListing, freshDay()).expect(201);
      });

      it('leaves another app’s dispute alone', async () => {
        const foreign = stripe.foreignPayment();
        const disputeId = stripe.openDispute(foreign);
        await tell('charge.dispute.created', disputeId).expect(200);
        expect(await disputeOf(disputeId)).toBeUndefined();
        expect(stripe.gateway.stageDisputeEvidence).not.toHaveBeenCalled();
      });

      it('answers 500 when Stripe can’t take the evidence, and stages it when told again', async () => {
        const { intent } = await paidBooking();
        const disputeId = stripe.openDispute(intent);
        stripe.gateway.stageDisputeEvidence.mockRejectedValueOnce(
          new PaymentProviderError('api_connection_error'),
        );
        const event = signedEvent('charge.dispute.created', { id: disputeId, object: 'dispute' });
        await deliver(event).expect(500);
        // Recorded already, so it holds the payout; the evidence still to stage.
        expect(await disputeOf(disputeId)).toMatchObject({ evidenceStagedAt: null });
        await deliver(event).expect(200);
        expect((await disputeOf(disputeId))?.evidenceStagedAt).toBeInstanceOf(Date);
        expect(stripe.evidence.has(disputeId)).toBe(true);
      });

      const payeesOf = async (bookingId: string) =>
        (
          await db
            .select({ ownerId: schema.bookingPayees.ownerId })
            .from(schema.bookingPayees)
            .where(eq(schema.bookingPayees.bookingId, bookingId))
        ).map((payee) => payee.ownerId);
      /** What a spied logger was told about this dispute, in so many words. */
      const opened = (told: { mock: { calls: unknown[][] } }, disputeId: string, message: string) =>
        told.mock.calls.filter(
          ([facts, text]) =>
            text === message && (facts as { disputeId?: string }).disputeId === disputeId,
        );

      it('tells support once when a dispute opens and again when it is lost, with ids only (#57)', async () => {
        const { driver, held, intent } = await paidBooking();
        const told = vi.spyOn(Logger.prototype, 'error');
        try {
          const disputeId = stripe.openDispute(intent);
          await tell('charge.dispute.created', disputeId).expect(200);
          await tell('charge.dispute.updated', disputeId).expect(200);
          const open = 'payment disputed: support to answer before it is due';
          expect(opened(told, disputeId, open)).toEqual([
            [expect.objectContaining({ bookingId: held.id, disputeId, ownersPaid: false }), open],
          ]);
          stripe.setDispute(disputeId, { status: 'lost' });
          await tell('charge.dispute.closed', disputeId).expect(200);
          const lost = 'dispute lost: support decides who bears it';
          expect(opened(told, disputeId, lost)).toHaveLength(1);
          // Ids, the reason and dates: nothing of the driver's.
          const logged = JSON.stringify(told.mock.calls);
          expect(logged).not.toContain(driver.email);
          expect(logged).not.toContain('Test Driver');
        } finally {
          told.mockRestore();
        }
      });

      it('lists for the day’s look only disputes due soon with nothing sent to the bank', async () => {
        const soon = new Date(Date.now() + 2 * DAY_MS);
        const at = new Date(Date.now() + 3 * DAY_MS);
        const before = await disputesToAnswer(db, at);
        const dispute = async (change: Parameters<typeof stripe.openDispute>[1]) => {
          const { intent } = await paidBooking();
          await tell('charge.dispute.created', stripe.openDispute(intent, change)).expect(200);
        };
        await dispute({ dueBy: soon }); // counted
        await dispute({ dueBy: soon, status: 'warning_needs_response' }); // counted
        await dispute({ dueBy: new Date(Date.now() + 7 * DAY_MS) }); // due later
        await dispute({ dueBy: soon, submissions: 1 }); // answered
        await dispute({ dueBy: soon, status: 'under_review' }); // with the bank
        expect(await disputesToAnswer(db, at)).toBe(before + 2);
      });

      it('doesn’t count a lost dispute whose owners were paid already, and says they were', async () => {
        const { held, intent, total } = await paidBooking();
        await endedDaysAgo(held.id);
        const [ownerId = ''] = await payeesOf(held.id);
        const shares = sharesOf({ totalMinor: total, refundMinor: 0, commissionBps: 1000 });
        expect(
          await markTransferSending(
            db,
            held.id,
            { transferMinor: shares.ownerMinor, commissionMinor: shares.commissionMinor },
            new Map([[ownerId, shares.ownerMinor]]),
          ),
        ).toBe(true);
        await recordPayeeTransfer(db, held.id, ownerId, `tr_${randomUUID().slice(0, 8)}`);
        expect((await row(held.id)).transferStatus).toBe('sent');

        const told = vi.spyOn(Logger.prototype, 'error');
        try {
          const before = await lostDisputesHeld(db);
          const disputeId = stripe.openDispute(intent, { status: 'lost' });
          await tell('charge.dispute.created', disputeId).expect(200);
          expect(await lostDisputesHeld(db)).toBe(before);
          expect(
            opened(told, disputeId, 'payment disputed: support to answer before it is due')[0]?.[0],
          ).toMatchObject({ ownersPaid: true });
        } finally {
          told.mockRestore();
        }
      });

      it('stages a cancelled booking’s refund, and the stay in Athens time', async () => {
        const { driver, held, intent, total } = await paidBooking();
        await cancel(driver, held.id).expect(200);
        // 00:30 in Athens on the day the clocks go back: the day of the stay is Athens's.
        await db
          .update(schema.bookings)
          .set({
            startsAt: new Date('2026-10-24T21:30:00Z'),
            endsAt: new Date('2026-10-24T23:30:00Z'),
            blockedUntil: new Date('2026-10-24T23:30:00Z'),
          })
          .where(eq(schema.bookings.id, held.id));
        const disputeId = stripe.openDispute(intent);
        await tell('charge.dispute.created', disputeId).expect(200);
        const staged = stripe.evidence.get(disputeId);
        expect(staged?.refundPolicy).toContain('cancelled by the driver');
        expect(staged?.refundPolicy).toContain(`${(total / 100).toFixed(2)} EUR was refunded`);
        expect(staged?.serviceDate).toBe('2026-10-25');
        expect(staged?.productDescription).toContain('00:30');
        expect(staged?.productDescription).toContain('(Athens time)');
      });

      it('stages the evidence of a warning to answer too, and none without a PaymentIntent', async () => {
        const warned = await paidBooking();
        const warningId = stripe.openDispute(warned.intent, { status: 'warning_needs_response' });
        await tell('charge.dispute.created', warningId).expect(200);
        expect(stripe.evidence.has(warningId)).toBe(true);
        // Every charge of ours comes from a PaymentIntent: one without is another app's.
        const bare = await paidBooking();
        const bareId = stripe.openDispute(bare.intent, { paymentIntentId: null });
        await tell('charge.dispute.created', bareId).expect(200);
        expect(await disputeOf(bareId)).toBeUndefined();
        expect(stripe.evidence.has(bareId)).toBe(false);
      });

      it('never stages over evidence Stripe holds already (support’s, from the dashboard)', async () => {
        const { intent } = await paidBooking();
        const disputeId = stripe.openDispute(intent, { evidenceGiven: true });
        await tell('charge.dispute.created', disputeId).expect(200);
        expect(stripe.gateway.stageDisputeEvidence).not.toHaveBeenCalled();
        // Done with: a later delivery doesn't try again.
        expect((await disputeOf(disputeId))?.evidenceStagedAt).toBeInstanceOf(Date);
      });

      it('takes two deliveries of one dispute at once as one, staged once', async () => {
        const { intent } = await paidBooking();
        const disputeId = stripe.openDispute(intent);
        const answers = await Promise.all([
          tell('charge.dispute.created', disputeId),
          tell('charge.dispute.funds_withdrawn', disputeId),
        ]);
        // Either both took it, or one asks Stripe to try again, which then finds it done.
        for (const answer of answers) expect([200, 500]).toContain(answer.status);
        if (answers.some((answer) => answer.status === 500)) {
          await tell('charge.dispute.updated', disputeId).expect(200);
        }
        const rows = await db
          .select({ id: schema.paymentDisputes.id })
          .from(schema.paymentDisputes)
          .where(eq(schema.paymentDisputes.stripeDisputeId, disputeId));
        expect(rows).toHaveLength(1);
        expect(stripe.evidence.has(disputeId)).toBe(true);
      });

      it('keeps a settled dispute settled when an older reading arrives after it', async () => {
        const won = await paidBooking();
        await endedDaysAgo(won.held.id);
        const disputeId = stripe.openDispute(won.intent, { status: 'won' });
        await tell('charge.dispute.closed', disputeId).expect(200);
        // A delivery that read Stripe before the dispute was won, recorded after it.
        expect(
          await recordDispute(db, won.held.id, {
            stripeDisputeId: disputeId,
            status: 'needs_response',
            reason: 'fraudulent',
            amountMinor: won.total,
            currency: 'EUR',
            dueBy: new Date(Date.now() + 7 * DAY_MS),
            submissions: 0,
          }),
        ).toBeNull();
        expect((await disputeOf(disputeId))?.status).toBe('won');
        expect(await dueIds()).toContain(won.held.id);
        expect(stripe.gateway.stageDisputeEvidence).not.toHaveBeenCalled();
      });

      it.each(['warning_closed', 'prevented'] as const)(
        'lets the payout go once a dispute is %s',
        async (status) => {
          const { held, intent } = await paidBooking();
          await endedDaysAgo(held.id);
          const disputeId = stripe.openDispute(intent);
          await tell('charge.dispute.created', disputeId).expect(200);
          expect(await dueIds()).not.toContain(held.id);
          stripe.setDispute(disputeId, { status });
          await tell('charge.dispute.closed', disputeId).expect(200);
          expect(await dueIds()).toContain(held.id);
        },
      );

      it('stages nothing once the bank has a response, or for one already settled', async () => {
        const answered = await paidBooking();
        const answeredId = stripe.openDispute(answered.intent, {
          status: 'under_review',
          submissions: 1,
        });
        await tell('charge.dispute.created', answeredId).expect(200);
        const settled = await paidBooking();
        const settledId = stripe.openDispute(settled.intent, { status: 'warning_closed' });
        await tell('charge.dispute.created', settledId).expect(200);
        expect(stripe.gateway.stageDisputeEvidence).not.toHaveBeenCalled();
        expect((await disputeOf(settledId))?.status).toBe('warning_closed');
      });
    });

    it('leaves a lapsed hold paid meanwhile to its webhook', async () => {
      const driver = await person();
      const { held, intent } = await heldAndPaying(driver);
      await cancel(driver, held.id).expect(200);
      stripe.setPayment(intent, { status: 'succeeded' });
      expect((await stripe.gateway.cancelPayment(intent)).status).toBe('succeeded');
      // Not called off, so the worker records nothing: the webhook gives it back (#3).
      expect(await row(held.id)).toMatchObject({ paymentStatus: 'pending' });
      await deliver(
        signedEvent('payment_intent.succeeded', { id: intent, object: 'payment_intent' }),
      ).expect(200);
      expect(await row(held.id)).toMatchObject({ paymentStatus: 'refunded' });
    });
  });
});

export type { Booking };
