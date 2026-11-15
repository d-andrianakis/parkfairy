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
