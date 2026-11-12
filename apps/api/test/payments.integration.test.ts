import { randomUUID } from 'node:crypto';
import {
  addDays,
  BookingPaymentSchema,
  BookingSchema,
  DEFAULT_TIME_ZONE,
  OwnerPayoutsSchema,
  ParkingListingDetailSchema,
  PayoutLinkSchema,
  zonedParts,
  zonedTimeToUtc,
  type Booking,
} from '@parkfairy/contracts';
import { deleteStaleHolds, expireLapsedHolds, schema, type Database } from '@parkfairy/database';
import { eq, inArray, like, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../src/config/config.module.js';
import { loadEnv } from '../src/config/env.js';
import { DB } from '../src/database/database.module.js';
import { PAYMENTS } from '../src/payments/payments.tokens.js';
import { PaymentProviderError } from '../src/payments/stripe-gateway.js';
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
});

export type { Booking };
