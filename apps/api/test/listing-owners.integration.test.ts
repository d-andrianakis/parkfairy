import { randomUUID } from 'node:crypto';
import {
  addDays,
  DEFAULT_TIME_ZONE,
  INVITES_PER_ADDRESS_WEEK,
  INVITES_PER_DAY,
  InvitePreviewSchema,
  ListingOwnersSchema,
  OwnerOnboardingSchema,
  zonedParts,
  zonedTimeToUtc,
  type ListingOwners,
} from '@parkfairy/contracts';
import {
  claimDueEmails,
  enqueueOnboardingReminders,
  markEmailSent,
  mintInviteToken,
  releaseEmails,
  schema,
  type Database,
} from '@parkfairy/database';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, updateUser, type TestApp, type TestUser } from './test-app.js';

// Co-ownership (#53–#56). Kalamata: far from the demo areas and every other suite's point.
const HERE = { latitude: 37.0389, longitude: 22.1142 };
const PREFIX = 'it-coown-';
const tag = randomUUID().slice(0, 8);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
const zone = DEFAULT_TIME_ZONE;
const today = zonedParts(new Date(), zone).date;
let nextOffset = 6;
const at = (day: string, time: string) => zonedTimeToUtc(day, time, zone)?.toISOString() ?? '';
// What a paid owner must have filled in (#22): their details, and their tax.
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
const DAY_MS = 24 * 60 * 60 * 1000;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

describe('co-ownership of a listing (#53–#56)', () => {
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
      address = `198.31.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
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
    // Ours to clean up after, whatever the test made of it.
    await db
      .update(schema.parkingLocations)
      .set({ slug: `${PREFIX}${tag}-${id}` })
      .where(eq(schema.parkingLocations.id, id));
    return id;
  }

  /** Invites `email`, and makes the link as the worker would when it sends the email. */
  async function invite(by: TestUser, listingId: string, email: string) {
    const answer = ListingOwnersSchema.parse(
      (
        await call(by, 'post', `/owner/listings/${listingId}/invites`)
          .send({ email, locale: 'en' })
          .expect(200)
      ).body,
    );
    const made = answer.invites.find((open) => open.email === email.toLowerCase());
    if (!made) throw new Error('No invite');
    const minted = await mintInviteToken(db, made.id);
    if (!minted) throw new Error('Not minted');
    return { id: made.id, token: minted.token, answer };
  }

  /** Fills in an owner's details and tax, as they would in their own account. */
  async function report(user: TestUser) {
    await call(user, 'patch', '/owner/profile').send(DETAILS).expect(200);
    await call(user, 'put', '/owner/profile/tax').send(TAX).expect(200);
  }

  const profileOf = async (user: TestUser) =>
    (
      await db
        .select({ id: schema.ownerProfiles.id })
        .from(schema.ownerProfiles)
        .where(eq(schema.ownerProfiles.userId, user.id))
    )[0];

  /** A listing with a co-owner who accepted: the primary, the co-owner, the listing. */
  async function coOwned() {
    const primary = await person();
    const coOwner = await person();
    const id = await newListing(primary);
    const { token } = await invite(primary, id, coOwner.email);
    await call(coOwner, 'post', '/owner/invites/accept').send({ token }).expect(200);
    return { primary, coOwner, id };
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

  it.each([
    ['get', `/owner/listings/${randomUUID()}/owners`],
    ['post', `/owner/listings/${randomUUID()}/invites`],
    ['put', `/owner/listings/${randomUUID()}/shares`],
    ['post', `/owner/listings/${randomUUID()}/leave`],
    ['delete', `/owner/listings/${randomUUID()}/invites/${randomUUID()}`],
    ['delete', `/owner/listings/${randomUUID()}/owners/${randomUUID()}`],
    ['post', '/owner/invites/preview'],
    ['post', '/owner/invites/accept'],
  ] as const)('needs an account for %s %s', async (method, path) => {
    await call(null, method, path).send({}).expect(401);
  });

  it('makes a new listing’s maker its primary owner, with all of the owners’ share', async () => {
    const maker = await person();
    const id = await newListing(maker);
    const seen = await owners(maker, id);
    expect(seen).toMatchObject({ listingId: id, role: 'primary', invites: [], room: 9 });
    expect(seen.owners).toEqual([
      expect.objectContaining({ role: 'primary', sharePercent: 100, you: true, payouts: 'none' }),
    ]);
    // No payout account yet: drivers can't book it (#54).
    expect(seen.payable).toBe(false);
  });

  it('invites by email, the link made as it is sent, and only the account invited accepts', async () => {
    const primary = await person();
    const invited = await person();
    const stranger = await person();
    const id = await newListing(primary);
    await db
      .update(schema.parkingLocations)
      .set({ name: 'Γκαράζ Καλαμάτας' })
      .where(eq(schema.parkingLocations.id, id));

    // In capitals, as people type addresses: matched as accounts are.
    const { id: inviteId, token, answer } = await invite(primary, id, invited.email.toUpperCase());
    expect(answer.invites).toEqual([
      expect.objectContaining({ id: inviteId, email: invited.email, canWithdraw: true }),
    ]);
    const [queued] = await db
      .select()
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.inviteId, inviteId));
    // No address and no link in the outbox: the worker reads both when it sends. Nor the
    // listing's name: nothing an owner typed goes out to someone who never asked.
    expect(queued).toMatchObject({ kind: 'listing-invite', userId: null, payload: {} });
    expect(JSON.stringify(queued?.payload)).not.toContain(token);
    expect(JSON.stringify(queued?.payload)).not.toContain(invited.email);
    // Only the token's hash is kept.
    const [stored] = await db
      .select({ tokenHash: schema.listingInvites.tokenHash })
      .from(schema.listingInvites)
      .where(eq(schema.listingInvites.id, inviteId));
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.tokenHash).not.toContain(token);

    const preview = (user: TestUser) =>
      call(user, 'post', '/owner/invites/preview').send({ token });
    expect(InvitePreviewSchema.parse((await preview(invited).expect(200)).body)).toEqual({
      state: 'open',
      listingName: 'Γκαράζ Καλαμάτας',
      contentLocale: 'el',
      invitedBy: 'Test Driver',
      forYou: true,
    });
    expect((await preview(stranger).expect(200)).body).toMatchObject({ forYou: false });
    // A forwarded link is no use to anyone else.
    expect(
      (await call(stranger, 'post', '/owner/invites/accept').send({ token }).expect(409)).body,
    ).toMatchObject({ code: 'INVITE_FOR_ANOTHER_ACCOUNT' });
    // Refused, it leaves nothing behind: no owner profile for the account that tried.
    expect(await profileOf(stranger)).toBeUndefined();

    const accepted = await call(invited, 'post', '/owner/invites/accept')
      .send({ token })
      .expect(200);
    expect(accepted.body).toEqual({ listingId: id });
    // Asked again: the same answer.
    await call(invited, 'post', '/owner/invites/accept').send({ token }).expect(200);
    expect((await preview(invited).expect(200)).body).toMatchObject({ state: 'used' });

    const seen = await owners(invited, id);
    expect(seen.role).toBe('co_owner');
    expect(seen.invites).toEqual([]);
    expect(seen.owners.map(({ role, sharePercent, you }) => ({ role, sharePercent, you }))).toEqual(
      [
        { role: 'primary', sharePercent: 100, you: false },
        { role: 'co_owner', sharePercent: 0, you: true },
      ],
    );
    // An owner profile was made for the account.
    expect(await profileOf(invited)).toBeDefined();
  });

  it('accepts only for a confirmed address', async () => {
    const primary = await person();
    const invited = await person();
    const id = await newListing(primary);
    const { token } = await invite(primary, id, invited.email);
    await updateUser(app, invited.id, { emailVerified: false });
    // The session reads the account as it is now (Better Auth's cookie cache aside).
    const answer = await call(invited, 'post', '/owner/invites/accept').send({ token });
    expect([401, 403, 409]).toContain(answer.status);
    await updateUser(app, invited.id, { emailVerified: true });
  });

  it('lets a co-owner run the listing, but not remove owners, set shares or delete it (#55)', async () => {
    const { primary, coOwner, id } = await coOwned();
    await call(coOwner, 'get', `/owner/listings/${id}`).expect(200);
    await call(coOwner, 'patch', `/owner/listings/${id}/location`)
      .send({ name: 'Run together' })
      .expect(200);
    const [row] = await db
      .select({ name: schema.parkingLocations.name })
      .from(schema.parkingLocations)
      .where(eq(schema.parkingLocations.id, id));
    expect(row?.name).toBe('Run together');

    const primaryId = (await owners(primary, id)).owners[0]?.id ?? '';
    // Each made when it's sent: supertest can't hold several at once.
    const refusals = [
      () => call(coOwner, 'delete', `/owner/listings/${id}`),
      () =>
        call(coOwner, 'put', `/owner/listings/${id}/shares`).send({
          shares: [{ ownerId: primaryId, percent: 100 }],
        }),
      () => call(coOwner, 'delete', `/owner/listings/${id}/owners/${primaryId}`),
    ];
    for (const refused of refusals) {
      expect((await refused().expect(403)).body).toMatchObject({ code: 'PRIMARY_ONLY' });
    }
    // But they may invite, and withdraw their own invite; the primary, any.
    const fromCo = await invite(coOwner, id, `co-${randomUUID()}@example.com`);
    const fromPrimary = await invite(primary, id, `pr-${randomUUID()}@example.com`);
    expect(
      (await owners(coOwner, id)).invites.find((open) => open.id === fromPrimary.id)?.canWithdraw,
    ).toBe(false);
    expect(
      (await call(coOwner, 'delete', `/owner/listings/${id}/invites/${fromPrimary.id}`).expect(403))
        .body,
    ).toMatchObject({ code: 'PRIMARY_ONLY' });
    await call(coOwner, 'delete', `/owner/listings/${id}/invites/${fromCo.id}`).expect(200);
    await call(primary, 'delete', `/owner/listings/${id}/invites/${fromPrimary.id}`).expect(200);
    expect((await owners(primary, id)).invites).toEqual([]);
    // A withdrawn invite's link opens nothing.
    expect(
      (
        await call(coOwner, 'post', '/owner/invites/preview')
          .send({ token: fromCo.token })
          .expect(200)
      ).body,
    ).toMatchObject({ state: 'used' });
  });

  it('lets the primary set the shares, whole percents adding up to 100, for exactly its owners', async () => {
    const { primary, coOwner, id } = await coOwned();
    const [first, second] = (await owners(primary, id)).owners;
    const shares = (a: number, b: number) => ({
      shares: [
        { ownerId: first?.id, percent: a },
        { ownerId: second?.id, percent: b },
      ],
    });
    // Paid means reported (#22): no share for an owner whose details and tax aren't in, and
    // the answer says whose.
    expect(
      (await call(primary, 'put', `/owner/listings/${id}/shares`).send(shares(100, 0)).expect(409))
        .body,
    ).toMatchObject({ code: 'OWNER_DETAILS_MISSING', owners: [first?.id] });
    await report(primary);
    await call(primary, 'put', `/owner/listings/${id}/shares`).send(shares(100, 0)).expect(200);
    expect(
      (await call(primary, 'put', `/owner/listings/${id}/shares`).send(shares(70, 30)).expect(409))
        .body,
    ).toMatchObject({ code: 'OWNER_DETAILS_MISSING', owners: [second?.id] });
    expect((await owners(primary, id)).owners.map((owner) => owner.sharePercent)).toEqual([100, 0]);
    await report(coOwner);
    const set = ListingOwnersSchema.parse(
      (await call(primary, 'put', `/owner/listings/${id}/shares`).send(shares(70, 30)).expect(200))
        .body,
    );
    expect(set.owners.map((owner) => owner.sharePercent)).toEqual([70, 30]);
    // Paid now, on a listing that may be live already: theirs for staff to verify.
    const [verified] = await db
      .select({ verification: schema.ownerProfiles.verification })
      .from(schema.ownerProfiles)
      .where(eq(schema.ownerProfiles.userId, coOwner.id));
    expect(verified?.verification).toBe('pending');
    // The co-owner has a share now and can't be paid: drivers can't book it until they can.
    expect(set.payable).toBe(false);
    expect(
      (await call(primary, 'put', `/owner/listings/${id}/shares`).send(shares(70, 20)).expect(400))
        .body,
    ).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(
      (
        await call(primary, 'put', `/owner/listings/${id}/shares`)
          .send({ shares: [{ ownerId: first?.id, percent: 100 }] })
          .expect(409)
      ).body,
    ).toMatchObject({ code: 'SHARES_MISMATCH' });
    expect((await owners(coOwner, id)).owners.map((owner) => owner.sharePercent)).toEqual([70, 30]);
  });

  it('keeps an owner with a share from leaving their details incomplete (#22)', async () => {
    const { primary, coOwner, id } = await coOwned();
    const [first, second] = (await owners(primary, id)).owners;
    await report(primary);
    await report(coOwner);
    const patch = (user: TestUser) => call(user, 'patch', '/owner/profile');

    // A draft pays no one (sending it in checks every paid owner's details): nothing holds them.
    await patch(primary).send({ firstName: null }).expect(200);
    await patch(primary).send({ firstName: 'Ελένη' }).expect(200);
    await publish(id);

    // The primary has all of the share: no field cleared, no switch that drops the birth date.
    expect((await patch(primary).send({ firstName: null }).expect(409)).body).toMatchObject({
      code: 'PROFILE_HAS_SHARE',
    });
    expect((await patch(primary).send({ kind: 'business' }).expect(409)).body).toMatchObject({
      code: 'PROFILE_HAS_SHARE',
    });
    // Nothing was kept of the refused saves; a change that leaves them complete is still fine.
    await patch(primary).send({ firstName: 'Μαρία' }).expect(200);
    const kept = (await call(primary, 'get', '/owner/profile').expect(200)).body as {
      kind: string;
      firstName: string;
      tax: { birthDateSaved: boolean };
    };
    expect(kept).toMatchObject({ kind: 'individual', firstName: 'Μαρία' });
    expect(kept.tax.birthDateSaved).toBe(true);

    // A co-owner at 0% is paid nothing, so nothing holds their details.
    await patch(coOwner).send({ firstName: null }).expect(200);
    await patch(coOwner).send({ firstName: 'Ελένη' }).expect(200);

    // Given a share, they are held to it, and the primary taking it back sets them free.
    const shares = (a: number, b: number) => ({
      shares: [
        { ownerId: first?.id, percent: a },
        { ownerId: second?.id, percent: b },
      ],
    });
    await call(primary, 'put', `/owner/listings/${id}/shares`).send(shares(70, 30)).expect(200);
    expect((await patch(coOwner).send({ lastName: null }).expect(409)).body).toMatchObject({
      code: 'PROFILE_HAS_SHARE',
    });
    await call(primary, 'put', `/owner/listings/${id}/shares`).send(shares(100, 0)).expect(200);
    await patch(coOwner).send({ lastName: null }).expect(200);
  });

  /** With staff or live: complete enough for the database, and past the stages that pay no one. */
  async function publish(id: string) {
    await db
      .update(schema.parkingLocations)
      .set({
        name: 'Κοινό γκαράζ',
        address: 'Οδός Δοκιμής 7, Καλαμάτα',
        areaId: 'syntagma',
        location: HERE,
        hourlyRateMinor: 200,
        cancellationPolicy: 'oneDay',
        status: 'published',
      })
      .where(eq(schema.parkingLocations.id, id));
  }

  // The refusals below need the share and the save to meet: a second transaction holds one side's
  // lock while the other's request is made, so the order is ours and no timing is left to luck.
  const settlesWithin = (pending: Promise<unknown>, ms: number) =>
    Promise.race([
      pending.then(() => true),
      new Promise<boolean>((done) => setTimeout(done, ms, false)),
    ]);

  async function holding(hold: (tx: Transaction) => Promise<void>) {
    let release!: () => void;
    const gate = new Promise<void>((open) => (release = open));
    let held!: () => void;
    const ready = new Promise<void>((open) => (held = open));
    const holder = db.transaction(async (tx) => {
      await hold(tx);
      held();
      await gate;
    });
    await ready;
    return async () => {
      release();
      await holder;
    };
  }

  it('makes a save wait for a share being given, then refuses it (the locks, not luck)', async () => {
    const { primary, coOwner, id } = await coOwned();
    await report(primary);
    await report(coOwner);
    const mine = await profileOf(coOwner);
    // A share to the co-owner, given but not yet committed, with their profile row read shared:
    // what `setShares` is in the middle of.
    await publish(id);
    const commit = await holding(async (tx) => {
      await tx
        .select()
        .from(schema.ownerProfiles)
        .where(eq(schema.ownerProfiles.id, mine?.id ?? ''))
        .for('share');
      await tx
        .update(schema.listingOwners)
        .set({ shareBps: 3000 })
        .where(
          and(
            eq(schema.listingOwners.locationId, id),
            eq(schema.listingOwners.ownerId, mine?.id ?? ''),
          ),
        );
    });
    const save = call(coOwner, 'patch', '/owner/profile')
      .send({ firstName: null })
      .then((response) => response);
    expect(await settlesWithin(save, 500)).toBe(false);
    await commit();
    const answered = await save;
    expect(answered.status).toBe(409);
    expect(answered.body).toMatchObject({ code: 'PROFILE_HAS_SHARE' });
  });

  it('makes a share wait for a save being made, then refuses it (the locks, not luck)', async () => {
    const { primary, coOwner, id } = await coOwned();
    const [first, second] = (await owners(primary, id)).owners;
    await report(primary);
    await report(coOwner);
    const mine = await profileOf(coOwner);
    // The co-owner's save, emptying their name, made but not yet committed.
    const commit = await holding(async (tx) => {
      await tx
        .update(schema.ownerProfiles)
        .set({ firstName: null })
        .where(eq(schema.ownerProfiles.id, mine?.id ?? ''));
    });
    const share = call(primary, 'put', `/owner/listings/${id}/shares`)
      .send({
        shares: [
          { ownerId: first?.id, percent: 70 },
          { ownerId: second?.id, percent: 30 },
        ],
      })
      .then((response) => response);
    expect(await settlesWithin(share, 500)).toBe(false);
    await commit();
    const answered = await share;
    expect(answered.status).toBe(409);
    expect(answered.body).toMatchObject({ code: 'OWNER_DETAILS_MISSING', owners: [second?.id] });
  });

  /** A co-owner with a share of 30%, their details and tax in. */
  async function paidCoOwner() {
    const { primary, coOwner, id } = await coOwned();
    await report(primary);
    await report(coOwner);
    await publish(id);
    const [first, second] = (await owners(primary, id)).owners;
    await call(primary, 'put', `/owner/listings/${id}/shares`)
      .send({
        shares: [
          { ownerId: first?.id, percent: 70 },
          { ownerId: second?.id, percent: 30 },
        ],
      })
      .expect(200);
    return { primary, coOwner, id };
  }

  it.each([
    ['firstName', null],
    ['lastName', ''],
    ['phone', null],
    ['addressLine', ''],
    ['city', null],
    ['postalCode', ''],
  ] as const)('refuses a paid owner emptying %s (as %j)', async (field, empty) => {
    const { coOwner } = await paidCoOwner();
    const refused = await call(coOwner, 'patch', '/owner/profile')
      .send({ [field]: empty })
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'PROFILE_HAS_SHARE' });
    const kept = (await call(coOwner, 'get', '/owner/profile').expect(200)).body as Record<
      string,
      unknown
    >;
    expect(kept[field]).toBe((DETAILS as Record<string, string>)[field]);
  });

  it('lets a paid owner change what stays complete, kind sent again included', async () => {
    const { coOwner } = await paidCoOwner();
    const patch = (body: object) => call(coOwner, 'patch', '/owner/profile').send(body);
    await patch({ kind: 'individual' }).expect(200);
    await patch({ city: 'Πάτρα', phone: '+30 2610 000 000' }).expect(200);
    // The tax step can't empty anything: a new number, a new birth date, a change of country with
    // its number are all still theirs to make.
    const tax = (body: object) => call(coOwner, 'put', '/owner/profile/tax').send(body);
    await tax({ taxCountry: 'GR', taxId: '094259216', birthDate: '1981-04-05' }).expect(200);
    await tax({ taxCountry: 'CY', taxId: '10259033P', birthDate: '1981-04-05' }).expect(200);
    // A country changed with no number is refused, as for anyone.
    await tax({ taxCountry: 'GR' }).expect(400);
  });

  it('holds a business owner’s legal name and registration number, and a switch back', async () => {
    const { primary, coOwner, id } = await coOwned();
    await report(primary);
    // A business at 0%: the person's names stay on file, the birth date goes with the switch.
    await report(coOwner);
    const patch = (body: object) => call(coOwner, 'patch', '/owner/profile').send(body);
    await patch({ kind: 'business', legalName: 'Δοκιμή ΙΚΕ' }).expect(200);
    await call(coOwner, 'put', '/owner/profile/tax')
      .send({ taxCountry: 'GR', registrationNumber: '123456789012' })
      .expect(200);
    // Free to switch while unpaid.
    await patch({ kind: 'individual' }).expect(200);
    await call(coOwner, 'put', '/owner/profile/tax').send(TAX).expect(200);
    await patch({ kind: 'business' }).expect(200);
    await call(coOwner, 'put', '/owner/profile/tax')
      .send({ taxCountry: 'GR', registrationNumber: '123456789012' })
      .expect(200);

    await publish(id);
    const [first, second] = (await owners(primary, id)).owners;
    await call(primary, 'put', `/owner/listings/${id}/shares`)
      .send({
        shares: [
          { ownerId: first?.id, percent: 70 },
          { ownerId: second?.id, percent: 30 },
        ],
      })
      .expect(200);
    for (const body of [{ legalName: null }, { legalName: '' }, { kind: 'individual' }]) {
      expect((await patch(body).expect(409)).body).toMatchObject({ code: 'PROFILE_HAS_SHARE' });
    }
    await patch({ kind: 'business' }).expect(200);
    await patch({ legalName: 'Άλλη ΙΚΕ' }).expect(200);
  });

  it('holds a share on any of an owner’s listings, until the last is gone', async () => {
    const { primary, coOwner, id } = await coOwned();
    await report(primary);
    await report(coOwner);
    const other = await person();
    await report(other);
    const second = await newListing(other);
    await publish(second);
    await publish(id);
    const { token } = await invite(other, second, coOwner.email);
    await call(coOwner, 'post', '/owner/invites/accept').send({ token }).expect(200);
    // 0% on the first listing, 30% on the second: the second alone holds them.
    const [a, b] = (await owners(other, second)).owners;
    await call(other, 'put', `/owner/listings/${second}/shares`)
      .send({
        shares: [
          { ownerId: a?.id, percent: 70 },
          { ownerId: b?.id, percent: 30 },
        ],
      })
      .expect(200);
    const clear = () => call(coOwner, 'patch', '/owner/profile').send({ lastName: null });
    expect((await clear().expect(409)).body).toMatchObject({ code: 'PROFILE_HAS_SHARE' });
    // Leaving the listing that paid them frees them; the one that never paid them is no hold.
    await call(coOwner, 'post', `/owner/listings/${second}/leave`).expect(204);
    expect(id).not.toBe(second);
    await clear().expect(200);
  });

  describe('handing the primary role to a co-owner (two steps)', () => {
    /** A payout account in the state given, as Stripe's webhook would leave it. */
    async function payouts(user: TestUser, status: 'active' | 'restricted' = 'active') {
      const mine = await profileOf(user);
      await db
        .insert(schema.payoutAccounts)
        .values({
          ownerId: mine?.id ?? '',
          stripeAccountId: `acct_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
          status,
        })
        .onConflictDoUpdate({ target: schema.payoutAccounts.ownerId, set: { status } });
    }
    const offer = (user: TestUser, id: string, ownerId: string | undefined) =>
      call(user, 'post', `/owner/listings/${id}/handover`).send({ ownerId });

    /** A listing whose co-owner is ready to lead: details, tax and an active payout account. */
    async function ready() {
      const { primary, coOwner, id } = await coOwned();
      await report(primary);
      await report(coOwner);
      await payouts(coOwner);
      const [first, second] = (await owners(primary, id)).owners;
      return { primary, coOwner, id, first, second };
    }

    it('moves the role only when the co-owner accepts, the old primary staying as a co-owner', async () => {
      const { primary, coOwner, id, second } = await ready();
      const offered = ListingOwnersSchema.parse(
        (await offer(primary, id, second?.id).expect(200)).body,
      );
      expect(offered.handover).toMatchObject({ toOwnerId: second?.id, canAccept: false });
      // Nothing changed yet; the co-owner sees it and may accept, everyone may see it.
      const seen = await owners(coOwner, id);
      expect(seen.role).toBe('co_owner');
      expect(seen.handover).toMatchObject({ canAccept: true, canWithdraw: true });
      await call(primary, 'put', `/owner/listings/${id}/shares`)
        .send({
          shares: [
            { ownerId: offered.owners[0]?.id, percent: 60 },
            { ownerId: second?.id, percent: 40 },
          ],
        })
        .expect(200);

      const now = ListingOwnersSchema.parse(
        (await call(coOwner, 'post', `/owner/listings/${id}/handover/accept`).expect(200)).body,
      );
      expect(now.role).toBe('primary');
      expect(now.handover).toBeNull();
      // Roles swapped, shares as they were, the listing's owner_id the new primary's.
      expect(now.owners.map((owner) => [owner.you, owner.role, owner.sharePercent])).toEqual([
        [true, 'primary', 40],
        [false, 'co_owner', 60],
      ]);
      const [row] = await db
        .select({ ownerId: schema.parkingLocations.ownerId })
        .from(schema.parkingLocations)
        .where(eq(schema.parkingLocations.id, id));
      expect(row?.ownerId).toBe(second?.id);
      // The rights went with the role: the old primary can no longer set shares or remove.
      for (const refused of [
        () => call(primary, 'put', `/owner/listings/${id}/shares`).send({ shares: [] }),
        () => call(primary, 'delete', `/owner/listings/${id}/owners/${second?.id}`),
      ]) {
        expect([400, 403]).toContain((await refused()).status);
      }
      expect((await owners(primary, id)).role).toBe('co_owner');
      await call(coOwner, 'put', `/owner/listings/${id}/shares`)
        .send({
          shares: [
            { ownerId: now.owners[1]?.id, percent: 100 },
            { ownerId: second?.id, percent: 0 },
          ],
        })
        .expect(200);
      // The new primary is staff's to verify, as a paid owner is.
      const [verified] = await db
        .select({ verification: schema.ownerProfiles.verification })
        .from(schema.ownerProfiles)
        .where(eq(schema.ownerProfiles.userId, coOwner.id));
      expect(verified?.verification).toBe('pending');
      // And only the primary now deletes the draft: the one who handed it over is refused.
      expect((await call(primary, 'delete', `/owner/listings/${id}`)).status).toBe(403);
      // Accepting again is no offer.
      await call(coOwner, 'post', `/owner/listings/${id}/handover/accept`).expect(404);
    });

    it('refuses a draft’s deletion by a primary demoted while it waited on the lock', async () => {
      const { primary, id, first, second } = await ready();
      // What accepting does, held open: the listing locked, the roles swapped, not yet committed.
      const commit = await holding(async (tx) => {
        await tx
          .select({ id: schema.parkingLocations.id })
          .from(schema.parkingLocations)
          .where(eq(schema.parkingLocations.id, id))
          .for('update');
        await tx
          .update(schema.listingOwners)
          .set({ role: 'co_owner' })
          .where(
            and(
              eq(schema.listingOwners.locationId, id),
              eq(schema.listingOwners.ownerId, first?.id ?? ''),
            ),
          );
        await tx
          .update(schema.listingOwners)
          .set({ role: 'primary' })
          .where(
            and(
              eq(schema.listingOwners.locationId, id),
              eq(schema.listingOwners.ownerId, second?.id ?? ''),
            ),
          );
      });
      // They were the primary when they asked: the check before the lock passes, and waits.
      const deleting = call(primary, 'delete', `/owner/listings/${id}`).then(
        (response) => response,
      );
      expect(await settlesWithin(deleting, 500)).toBe(false);
      await commit();
      expect((await deleting).status).toBe(403);
      const [still] = await db
        .select({ id: schema.parkingLocations.id })
        .from(schema.parkingLocations)
        .where(eq(schema.parkingLocations.id, id));
      expect(still?.id).toBe(id);
    });

    it('is the primary’s to offer, to a co-owner who is ready to lead', async () => {
      const { primary, coOwner, id, first, second } = await ready();
      expect((await offer(coOwner, id, first?.id).expect(403)).body).toMatchObject({
        code: 'PRIMARY_ONLY',
      });
      // Not oneself, not a stranger, not nobody.
      for (const target of [first?.id, randomUUID()]) {
        expect((await offer(primary, id, target).expect(404)).body).toMatchObject({
          code: 'OWNER_NOT_FOUND',
        });
      }
      await offer(primary, id, 'not-an-id').expect(400);
      await offer(await person(), id, second?.id).expect(404);
      // Ready means details and tax, and an active payout account.
      await payouts(coOwner, 'restricted');
      expect((await offer(primary, id, second?.id).expect(409)).body).toMatchObject({
        code: 'PAYOUTS_NOT_ACTIVE',
      });
      await payouts(coOwner);
      await db
        .update(schema.ownerProfiles)
        .set({ phone: null })
        .where(eq(schema.ownerProfiles.id, second?.id ?? ''));
      expect((await offer(primary, id, second?.id).expect(409)).body).toMatchObject({
        code: 'OWNER_DETAILS_MISSING',
        owners: [second?.id],
      });
    });

    it('lets the primary take the offer back and the co-owner decline it, nobody else', async () => {
      const { primary, coOwner, id, second } = await ready();
      const third = await person();
      const { token } = await invite(primary, id, third.email);
      await call(third, 'post', '/owner/invites/accept').send({ token }).expect(200);
      const del = (user: TestUser) => call(user, 'delete', `/owner/listings/${id}/handover`);

      await del(primary).expect(404);
      await offer(primary, id, second?.id).expect(200);
      expect((await del(third).expect(403)).body).toMatchObject({ code: 'PRIMARY_ONLY' });
      expect((await del(primary).expect(200)).body).toMatchObject({ handover: null });
      await call(coOwner, 'post', `/owner/listings/${id}/handover/accept`).expect(404);

      await offer(primary, id, second?.id).expect(200);
      expect((await del(coOwner).expect(200)).body).toMatchObject({ handover: null });
      expect((await owners(primary, id)).role).toBe('primary');
    });

    it('lapses after seven days, is replaced by a new offer, and goes with a removed co-owner', async () => {
      const { primary, coOwner, id, second } = await ready();
      await offer(primary, id, second?.id).expect(200);
      await db
        .update(schema.listingHandovers)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.listingHandovers.locationId, id));
      expect(
        (await call(coOwner, 'post', `/owner/listings/${id}/handover/accept`).expect(409)).body,
      ).toMatchObject({ code: 'HANDOVER_EXPIRED' });
      expect((await owners(primary, id)).handover).toBeNull();
      // A lapsed one isn't in the way of the next.
      await offer(primary, id, second?.id).expect(200);
      await call(primary, 'delete', `/owner/listings/${id}/owners/${second?.id}`).expect(200);
      expect((await owners(primary, id)).handover).toBeNull();
    });

    it('checks again when accepting: payouts that went wrong since, or a co-owner not offered', async () => {
      const { primary, coOwner, id, second } = await ready();
      await offer(primary, id, second?.id).expect(200);
      await payouts(coOwner, 'restricted');
      expect(
        (await call(coOwner, 'post', `/owner/listings/${id}/handover/accept`).expect(409)).body,
      ).toMatchObject({ code: 'PAYOUTS_NOT_ACTIVE' });
      // Still the co-owner, the primary still the primary.
      expect((await owners(coOwner, id)).role).toBe('co_owner');
      await call(primary, 'post', `/owner/listings/${id}/handover/accept`).expect(404);
    });
  });

  it('gives a leaving or removed co-owner’s share back to the primary', async () => {
    const { primary, coOwner, id } = await coOwned();
    await report(primary);
    await report(coOwner);
    const [first, second] = (await owners(primary, id)).owners;
    await call(primary, 'put', `/owner/listings/${id}/shares`)
      .send({
        shares: [
          { ownerId: first?.id, percent: 60 },
          { ownerId: second?.id, percent: 40 },
        ],
      })
      .expect(200);
    await call(coOwner, 'post', `/owner/listings/${id}/leave`).expect(204);
    await call(coOwner, 'get', `/owner/listings/${id}/owners`).expect(404);
    await call(coOwner, 'get', `/owner/listings/${id}`).expect(404);
    expect((await owners(primary, id)).owners).toEqual([
      expect.objectContaining({ role: 'primary', sharePercent: 100 }),
    ]);
    // The primary can't leave their own listing, nor be removed.
    expect(
      (await call(primary, 'post', `/owner/listings/${id}/leave`).expect(409)).body,
    ).toMatchObject({ code: 'PRIMARY_CANNOT_LEAVE' });

    const { token } = await invite(primary, id, coOwner.email);
    await call(coOwner, 'post', '/owner/invites/accept').send({ token }).expect(200);
    const back = (await owners(primary, id)).owners[1]?.id ?? '';
    const removed = ListingOwnersSchema.parse(
      (await call(primary, 'delete', `/owner/listings/${id}/owners/${back}`).expect(200)).body,
    );
    expect(removed.owners).toHaveLength(1);
    expect(
      (await call(primary, 'delete', `/owner/listings/${id}/owners/${first?.id}`).expect(409)).body,
    ).toMatchObject({ code: 'PRIMARY_CANNOT_LEAVE' });
  });

  it('refuses an owner invited, an address invited twice, more than ten, and a lapsed invite', async () => {
    const primary = await person();
    const id = await newListing(primary);
    const send = (email: string) =>
      call(primary, 'post', `/owner/listings/${id}/invites`).send({ email, locale: 'el' });
    expect((await send(primary.email).expect(409)).body).toMatchObject({ code: 'ALREADY_OWNER' });
    const twice = `twice-${randomUUID()}@example.com`;
    const first = await invite(primary, id, twice);
    expect((await send(twice).expect(409)).body).toMatchObject({ code: 'ALREADY_INVITED' });

    // Lapsed: it can't be accepted, and the address can be invited again.
    await db
      .update(schema.listingInvites)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(schema.listingInvites.id, first.id));
    const late = await person();
    await db
      .update(schema.listingInvites)
      .set({ email: late.email })
      .where(eq(schema.listingInvites.id, first.id));
    expect(
      (await call(late, 'post', '/owner/invites/accept').send({ token: first.token }).expect(409))
        .body,
    ).toMatchObject({ code: 'INVITE_EXPIRED' });
    expect(await profileOf(late)).toBeUndefined();
    expect(
      (await call(late, 'post', '/owner/invites/preview').send({ token: first.token }).expect(200))
        .body,
    ).toMatchObject({ state: 'expired' });
    await send(late.email).expect(200);

    // Ten owners and open invites at most: filled in the database, past the invites' rate limit.
    const room = (await owners(primary, id)).room;
    await db.insert(schema.listingInvites).values(
      Array.from({ length: room }, (_, n) => ({
        locationId: id,
        email: `fill-${n}-${randomUUID()}@example.com`,
        locale: 'el' as const,
      })),
    );
    expect((await owners(primary, id)).room).toBe(0);
    expect((await send(`one-more-${randomUUID()}@example.com`).expect(409)).body).toMatchObject({
      code: 'TOO_MANY_OWNERS',
    });
  });

  it('keeps another account out of a listing’s owners, and a made-up link out of everything', async () => {
    const { id } = await coOwned();
    const stranger = await person();
    await call(stranger, 'get', `/owner/listings/${id}/owners`).expect(404);
    await call(stranger, 'post', `/owner/listings/${id}/invites`)
      .send({ email: 'x@example.com', locale: 'en' })
      .expect(404);
    await call(stranger, 'post', `/owner/listings/${id}/leave`).expect(404);
    const madeUp = 'A'.repeat(43);
    expect(
      (await call(stranger, 'post', '/owner/invites/accept').send({ token: madeUp }).expect(404))
        .body,
    ).toMatchObject({ code: 'INVITE_NOT_FOUND' });
    await call(stranger, 'post', '/owner/invites/preview').send({ token: 'short' }).expect(400);
  });

  it('shows a co-owner the others’ names only, and the addresses of the invitations they sent', async () => {
    const { primary, coOwner, id } = await coOwned();
    const fromPrimary = await invite(primary, id, `p-${randomUUID()}@example.com`);
    const fromCo = await invite(coOwner, id, `c-${randomUUID()}@example.com`);

    const theirs = await owners(coOwner, id);
    expect(theirs.owners).toEqual([
      expect.objectContaining({ role: 'primary', name: 'Test Driver', email: null, payouts: null }),
      expect.objectContaining({
        role: 'co_owner',
        email: coOwner.email,
        payouts: 'none',
        you: true,
      }),
    ]);
    expect(theirs.invites).toEqual([
      expect.objectContaining({ id: fromPrimary.id, email: null, canWithdraw: false }),
      expect.objectContaining({ id: fromCo.id, canWithdraw: true }),
    ]);
    expect(theirs.invites[1]?.email).toMatch(/^c-/);
    // The primary's view: everyone's address and Stripe's state, and every invitation.
    const primarys = await owners(primary, id);
    expect(primarys.owners.map((owner) => [owner.email, owner.payouts])).toEqual([
      [primary.email, 'none'],
      [coOwner.email, 'none'],
    ]);
    expect(primarys.invites.map((open) => [open.email !== null, open.canWithdraw])).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it('counts a co-owner’s try at an address already here, so asking costs what inviting does', async () => {
    const { primary, coOwner, id } = await coOwned();
    const invited = await invite(primary, id, `p-${randomUUID()}@example.com`);
    const coOwnerId = (await owners(primary, id)).owners[1]?.id ?? '';
    const tries = async () =>
      (
        await db
          .select({ id: schema.listingInvites.id })
          .from(schema.listingInvites)
          .where(eq(schema.listingInvites.invitedBy, coOwnerId))
      ).length;
    const send = (email: string) =>
      call(coOwner, 'post', `/owner/listings/${id}/invites`).send({ email, locale: 'en' });
    expect(await tries()).toBe(0);
    // The primary's address, and one the primary invited, which the co-owner can't see.
    expect((await send(primary.email).expect(409)).body).toMatchObject({ code: 'ALREADY_OWNER' });
    const [made] = await db
      .select({ email: schema.listingInvites.email })
      .from(schema.listingInvites)
      .where(eq(schema.listingInvites.id, invited.id));
    expect((await send(made?.email ?? '').expect(409)).body).toMatchObject({
      code: 'ALREADY_INVITED',
    });
    // Each kept, withdrawn, sending nothing: counted against their caps, invisible in the list.
    expect(await tries()).toBe(2);
    expect((await owners(coOwner, id)).invites.map((open) => open.id)).toEqual([invited.id]);
  });

  it('withdraws a removed owner’s invitations with them, and nobody else’s', async () => {
    const { primary, coOwner, id } = await coOwned();
    const friend = await person();
    const theirs = await invite(coOwner, id, friend.email);
    const kept = await invite(primary, id, `kept-${randomUUID()}@example.com`);
    const coOwnerId = (await owners(primary, id)).owners[1]?.id ?? '';
    await call(primary, 'delete', `/owner/listings/${id}/owners/${coOwnerId}`).expect(200);

    expect((await owners(primary, id)).invites.map((open) => open.id)).toEqual([kept.id]);
    // Their link opens nothing now: no way back in through one, theirs or a friend's.
    expect(
      (
        await call(friend, 'post', '/owner/invites/preview')
          .send({ token: theirs.token })
          .expect(200)
      ).body,
    ).toMatchObject({ state: 'used' });
    await call(friend, 'post', '/owner/invites/accept').send({ token: theirs.token }).expect(404);
    expect(await profileOf(friend)).toBeUndefined();
  });

  it('caps invitations: a few a week to one address, and a day’s worth from one owner', async () => {
    const primary = await person();
    const id = await newListing(primary);
    const send = (email: string) =>
      call(primary, 'post', `/owner/listings/${id}/invites`).send({ email, locale: 'en' });
    // Invite and withdraw, again and again: an inbox no one asked to fill.
    const again = `again-${randomUUID()}@example.com`;
    for (let round = 0; round < INVITES_PER_ADDRESS_WEEK; round++) {
      const sent = await invite(primary, id, again);
      await call(primary, 'delete', `/owner/listings/${id}/invites/${sent.id}`).expect(200);
    }
    expect((await send(again).expect(409)).body).toMatchObject({
      code: 'TOO_MANY_INVITES',
      limit: 'address',
    });
    // The cap is per listing: the same address may be asked to another.
    const elsewhere = await newListing(primary);
    await call(primary, 'post', `/owner/listings/${elsewhere}/invites`)
      .send({ email: again, locale: 'en' })
      .expect(200);

    // Across their listings, in a day: the rest filled in the database, withdrawn so they take
    // no room.
    const me = (await owners(primary, id)).owners[0]?.id ?? '';
    const other = await newListing(primary);
    await db.insert(schema.listingInvites).values(
      Array.from({ length: INVITES_PER_DAY - INVITES_PER_ADDRESS_WEEK - 1 }, (_, n) => ({
        locationId: other,
        invitedBy: me,
        email: `day-${n}-${randomUUID()}@example.com`,
        locale: 'en' as const,
        withdrawnAt: new Date(),
      })),
    );
    expect((await send(`fresh-${randomUUID()}@example.com`).expect(409)).body).toMatchObject({
      code: 'TOO_MANY_INVITES',
      limit: 'day',
    });
    // A day later, the owner may invite again.
    await db
      .update(schema.listingInvites)
      .set({ createdAt: new Date(Date.now() - 2 * DAY_MS) })
      .where(eq(schema.listingInvites.invitedBy, me));
    await send(`fresh-${randomUUID()}@example.com`).expect(200);
  });

  it('counts an inbox once whatever +tag the address carries', async () => {
    const primary = await person();
    const id = await newListing(primary);
    const name = `tagged-${randomUUID()}`;
    const send = (tag: string) =>
      call(primary, 'post', `/owner/listings/${id}/invites`).send({
        email: `${name}${tag}@example.com`,
        locale: 'en',
      });
    for (let n = 1; n <= INVITES_PER_ADDRESS_WEEK; n++) await send(`+${n}`).expect(200);
    // Another tag, or none: the same inbox, and its week's invitations are used up.
    for (const tag of ['+more', '']) {
      expect((await send(tag).expect(409)).body).toMatchObject({
        code: 'TOO_MANY_INVITES',
        limit: 'address',
      });
    }
    // Another inbox is unaffected.
    await call(primary, 'post', `/owner/listings/${id}/invites`)
      .send({ email: `other-${randomUUID()}@example.com`, locale: 'en' })
      .expect(200);
  });

  it('writes the invitation in the language of the account it goes to, once confirmed', async () => {
    const primary = await person();
    const invitee = await person();
    const id = await newListing(primary);
    await updateUser(app, invitee.id, { locale: 'el' });
    const confirmed = await invite(primary, id, invitee.email); // asked for in English
    const unknown = await invite(primary, id, `nobody-${randomUUID()}@example.com`);
    const mine = new Set([confirmed.id, unknown.id]);

    const due = await claimDueEmails(db, 500);
    const ours = (inviteId: string) => due.find((email) => email.inviteId === inviteId);
    try {
      expect(ours(confirmed.id)).toMatchObject({ to: invitee.email, locale: 'el' });
      expect(ours(unknown.id)).toMatchObject({ locale: 'en' });
    } finally {
      // This suite's are done with; anyone else's go back to the queue as they were.
      await Promise.all(
        due
          .filter((email) => email.inviteId !== null && mine.has(email.inviteId))
          .map((email) => markEmailSent(db, email.id)),
      );
      await releaseEmails(
        db,
        due.filter((email) => email.inviteId === null || !mine.has(email.inviteId)),
      );
    }

    // An unconfirmed account's language is no one's word: the inviter's choice stands.
    await updateUser(app, invitee.id, { emailVerified: false });
    const third = await invite(primary, await newListing(primary), invitee.email);
    const later = await claimDueEmails(db, 500);
    try {
      expect(later.find((email) => email.inviteId === third.id)).toMatchObject({ locale: 'en' });
    } finally {
      await updateUser(app, invitee.id, { emailVerified: true });
      await Promise.all(
        later
          .filter((email) => email.inviteId === third.id)
          .map((email) => markEmailSent(db, email.id)),
      );
      await releaseEmails(
        db,
        later.filter((email) => email.inviteId !== third.id),
      );
    }
  });

  it('never reminds a co-owner to finish a listing of their own they never started', async () => {
    const { coOwner } = await coOwned();
    await db
      .update(schema.ownerProfiles)
      // First in the sweep's order, so a cap on how many it takes can't hide them.
      .set({ updatedAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(schema.ownerProfiles.userId, coOwner.id));
    await enqueueOnboardingReminders(db, new Date(Date.now() - 3 * DAY_MS));
    const reminded = await db
      .select({ id: schema.emailOutbox.id })
      .from(schema.emailOutbox)
      .where(
        and(
          eq(schema.emailOutbox.userId, coOwner.id),
          eq(schema.emailOutbox.kind, 'onboarding-reminder'),
        ),
      );
    expect(reminded).toEqual([]);
  });

  it('shows a co-owned listing on the co-owner’s dashboard, and among theirs to copy to', async () => {
    const { coOwner, id } = await coOwned();
    const theirOwn = await newListing(coOwner);
    const dashboard = OwnerOnboardingSchema.parse(
      (await call(coOwner, 'get', '/owner/onboarding').expect(200)).body,
    );
    expect(dashboard.listings.map((listing) => listing.id)).toEqual(
      expect.arrayContaining([id, theirOwn]),
    );
    const others = (await call(coOwner, 'get', `/owner/listings/${id}/others`).expect(200))
      .body as { listings: { id: string }[] };
    expect(others.listings.map((listing) => listing.id)).toContain(theirOwn);
  });

  describe('bookings on a co-owned listing (without payments: the stand-in, #33)', () => {
    async function live(id: string) {
      await db
        .update(schema.parkingLocations)
        .set({
          name: 'Κοινό γκαράζ',
          address: 'Οδός Δοκιμής 7, Καλαμάτα',
          areaId: 'syntagma',
          location: HERE,
          hourlyRateMinor: 200,
          bookingGapMinutes: 0,
          cancellationPolicy: 'oneDay',
          status: 'published',
        })
        .where(eq(schema.parkingLocations.id, id));
      const [space] = await db
        .insert(schema.parkingSpaces)
        .values({ locationId: id, label: 'K1' })
        .returning({ id: schema.parkingSpaces.id });
      await db.insert(schema.parkingOpeningHours).values(
        [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          locationId: id,
          weekday,
          opensMinute: 0,
          closesMinute: 1440,
        })),
      );
      const [row] = await db
        .select({ slug: schema.parkingLocations.slug })
        .from(schema.parkingLocations)
        .where(eq(schema.parkingLocations.id, id));
      return { slug: row?.slug ?? '', spaceId: space?.id ?? '' };
    }

    async function book(driver: TestUser, listing: { slug: string; spaceId: string }) {
      const day = addDays(today, nextOffset++);
      const held = await call(driver, 'post', '/bookings')
        .send({
          listing: listing.slug,
          spaceId: listing.spaceId,
          start: at(day, '10:00'),
          end: at(day, '12:00'),
        })
        .expect(201);
      const bookingId = (held.body as { id: string }).id;
      await call(driver, 'post', `/bookings/${bookingId}/confirm`)
        .send({ vehiclePlate: 'ΙΚΒ-1234' })
        .expect(200);
      return bookingId;
    }

    /**
     * Runs `request` while the listing's lock is held as a change to its owners holds it, and
     * removes the co-owner before letting go: what was asked must see they're gone.
     */
    async function removedWhileWaiting(
      id: string,
      coOwnerId: string,
      request: () => Promise<{ status: number }>,
    ) {
      let answer: Promise<{ status: number }> | undefined;
      await db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from parking_locations where id = ${id} for update`);
        answer = request();
        // Waiting on the lock, as seen by Postgres: no sleeping and hoping.
        await expect
          .poll(
            async () =>
              (
                await db.execute<{ waiting: number }>(sql`
                  select count(*)::int as waiting from pg_stat_activity
                  where datname = current_database() and wait_event_type = 'Lock'`)
              ).rows[0]?.waiting ?? 0,
            { timeout: 10_000, interval: 50 },
          )
          .toBeGreaterThan(0);
        await tx
          .delete(schema.listingOwners)
          .where(
            and(
              eq(schema.listingOwners.locationId, id),
              eq(schema.listingOwners.ownerId, coOwnerId),
            ),
          );
      });
      if (!answer) throw new Error('No request');
      return answer;
    }

    it('lets a co-owner removed while their cancel or edit waits on the lock do neither', async () => {
      const { primary, coOwner, id } = await coOwned();
      const listing = await live(id);
      const bookingId = await book(await person(), listing);
      const coOwnerId = (await owners(primary, id)).owners[1]?.id ?? '';
      const cancelled = await removedWhileWaiting(id, coOwnerId, () =>
        call(coOwner, 'post', `/owner/listings/${id}/bookings/${bookingId}/cancel`)
          .send({})
          .then((response) => response),
      );
      expect(cancelled.status).toBe(404);
      const [still] = await db
        .select({ status: schema.bookings.status })
        .from(schema.bookings)
        .where(eq(schema.bookings.id, bookingId));
      expect(still?.status).toBe('confirmed');

      // The same for an edit: back in as a co-owner, then removed while it waits.
      const { token } = await invite(primary, id, coOwner.email);
      await call(coOwner, 'post', '/owner/invites/accept').send({ token }).expect(200);
      const again = (await owners(primary, id)).owners[1]?.id ?? '';
      const edited = await removedWhileWaiting(id, again, () =>
        call(coOwner, 'patch', `/owner/listings/${id}/location`)
          .send({ description: 'Changed by someone no longer here.' })
          .then((response) => response),
      );
      expect(edited.status).toBe(404);
      const [unchanged] = await db
        .select({ description: schema.parkingLocations.description })
        .from(schema.parkingLocations)
        .where(eq(schema.parkingLocations.id, id));
      expect(unchanged?.description).not.toBe('Changed by someone no longer here.');
    });

    it('lets no owner book their own, tells every owner, and pays each by share', async () => {
      const { primary, coOwner, id } = await coOwned();
      await report(primary);
      await report(coOwner);
      const listing = await live(id);
      const [first, second] = (await owners(primary, id)).owners;
      await call(primary, 'put', `/owner/listings/${id}/shares`)
        .send({
          shares: [
            { ownerId: first?.id, percent: 75 },
            { ownerId: second?.id, percent: 25 },
          ],
        })
        .expect(200);

      // A co-owner booking their own listing would pay themselves.
      expect(
        (
          await call(coOwner, 'post', '/bookings')
            .send({
              listing: listing.slug,
              spaceId: listing.spaceId,
              start: at(addDays(today, nextOffset), '10:00'),
              end: at(addDays(today, nextOffset), '12:00'),
            })
            .expect(409)
        ).body,
      ).toMatchObject({ code: 'OWN_LISTING' });

      const driver = await person();
      const bookingId = await book(driver, listing);
      // Every owner hears of it.
      const told = await db
        .select({ userId: schema.emailOutbox.userId })
        .from(schema.emailOutbox)
        .where(
          and(
            eq(schema.emailOutbox.kind, 'booking-received'),
            sql`${schema.emailOutbox.payload} -> 'booking' ->> 'id' = ${bookingId}`,
          ),
        );
      expect(told.map((row) => row.userId).sort()).toEqual([primary.id, coOwner.id].sort());
      // Who is paid for it, as the shares were when it was made (#54).
      const payees = await db
        .select({
          ownerId: schema.bookingPayees.ownerId,
          shareBps: schema.bookingPayees.shareBps,
        })
        .from(schema.bookingPayees)
        .where(eq(schema.bookingPayees.bookingId, bookingId));
      expect(payees).toEqual(
        expect.arrayContaining([
          { ownerId: first?.id, shareBps: 7500 },
          { ownerId: second?.id, shareBps: 2500 },
        ]),
      );
      // A share changed after doesn't reach it.
      await call(primary, 'put', `/owner/listings/${id}/shares`)
        .send({
          shares: [
            { ownerId: first?.id, percent: 100 },
            { ownerId: second?.id, percent: 0 },
          ],
        })
        .expect(200);
      const later = await book(await person(), listing);
      expect(
        await db
          .select({ ownerId: schema.bookingPayees.ownerId })
          .from(schema.bookingPayees)
          .where(eq(schema.bookingPayees.bookingId, later)),
      ).toEqual([{ ownerId: first?.id }]);
      expect(
        await db
          .select({ shareBps: schema.bookingPayees.shareBps })
          .from(schema.bookingPayees)
          .where(
            and(
              eq(schema.bookingPayees.bookingId, bookingId),
              eq(schema.bookingPayees.ownerId, second?.id ?? ''),
            ),
          ),
      ).toEqual([{ shareBps: 2500 }]);

      // The co-owner sees the listing's bookings, and may cancel one for the owners.
      const seen = await call(coOwner, 'get', `/owner/listings/${id}/bookings`).expect(200);
      expect(JSON.stringify(seen.body)).toContain(bookingId);
      await call(coOwner, 'post', `/owner/listings/${id}/bookings/${bookingId}/cancel`)
        .send({})
        .expect(204);
    });
  });
});
