import { randomUUID } from 'node:crypto';

import {
  ADMIN_PAGE_SIZE,
  adminCursor,
  AdminListingReviewSchema,
  type AdminQueue,
  AdminQueueSchema,
  AUDIT_ACTIONS,
  type AuditLog,
  AuditLogSchema,
} from '@parkfairy/contracts';
import { type Database, schema } from '@parkfairy/database';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB } from '../src/database/database.module.js';
import { OBJECT_STORE, type ObjectStore } from '../src/storage/object-store.js';
import { createTestApp, signUpUser, type TestApp, type TestUser, updateUser } from './test-app.js';

// Staff review of listings (5.2, #66–#68). Kalamata's neighbour, far from the demo areas.
const HERE = { latitude: 36.7213, longitude: 22.4291 };
const PREFIX = 'it-admin-';
const tag = randomUUID().slice(0, 8);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
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

describe('staff review (5.2: #66–#68)', () => {
  let app: TestApp;
  let db: Database;
  let store: ObjectStore;
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
      address = `198.71.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
      visitors.set(user.id, address);
    }
    return req.set('Cookie', user.cookie).set('X-Forwarded-For', address);
  };

  async function person(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }
  /** Staff: the role, and the second factor admin routes require. */
  async function staff(): Promise<TestUser> {
    const user = await person();
    await updateUser(app, user.id, { role: 'admin', twoFactorEnabled: true });
    return user;
  }

  /** A listing sent in by its primary owner, who has filled in their details and tax. */
  async function inReview(name: string, status: 'in_review' | 'draft' = 'in_review') {
    const owner = await person();
    await call(owner, 'patch', '/owner/profile').send(DETAILS).expect(200);
    await call(owner, 'put', '/owner/profile/tax').send(TAX).expect(200);
    const [profile] = await db
      .select({ id: schema.ownerProfiles.id })
      .from(schema.ownerProfiles)
      .where(eq(schema.ownerProfiles.userId, owner.id));
    const ownerId = profile?.id ?? '';
    await db
      .update(schema.ownerProfiles)
      .set({ verification: 'pending' })
      .where(eq(schema.ownerProfiles.id, ownerId));
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
        status,
        submittedAt: status === 'draft' ? null : new Date(),
      })
      .returning({ id: schema.parkingLocations.id });
    const id = row?.id ?? '';
    await db
      .insert(schema.listingOwners)
      .values({ locationId: id, ownerId, role: 'primary', shareBps: 10_000 });
    await db.insert(schema.parkingSpaces).values({ locationId: id, label: 'A1' });
    return { owner, id, ownerId };
  }

  /** An owner profile with nothing in it, made by starting a listing; the draft is ours to clean up. */
  async function draftOf(user: TestUser) {
    const response = await call(user, 'post', '/owner/listings').expect(201);
    const id = (response.body as { id: string }).id;
    await db
      .update(schema.parkingLocations)
      .set({ slug: `${PREFIX}${tag}-draft-${id.slice(0, 8)}` })
      .where(eq(schema.parkingLocations.id, id));
  }

  async function addProof(locationId: string, withFile = true) {
    const storageKey = `proofs/${randomUUID().replaceAll('-', '')}.pdf`;
    if (withFile) await store.put(storageKey, Buffer.from('%PDF-1.4 a lease'), 'application/pdf');
    const [row] = await db
      .insert(schema.parkingProofDocuments)
      .values({
        locationId,
        kind: 'lease',
        storageKey,
        fileName: 'lease.pdf',
        contentType: 'application/pdf',
        sizeBytes: 16,
      })
      .returning({ id: schema.parkingProofDocuments.id });
    return { id: row?.id ?? '', storageKey };
  }

  const audited = (targetId: string) =>
    db
      .select({
        action: schema.auditLog.action,
        actorId: schema.auditLog.actorId,
        details: schema.auditLog.details,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, targetId))
      .orderBy(schema.auditLog.at);

  async function removeOurs() {
    const ours = await db
      .select({ id: schema.parkingLocations.id })
      .from(schema.parkingLocations)
      .where(like(schema.parkingLocations.slug, `${PREFIX}%`));
    const ids = ours.map((found) => found.id);
    if (ids.length === 0) return;
    const proofs = await db
      .select({ key: schema.parkingProofDocuments.storageKey })
      .from(schema.parkingProofDocuments)
      .where(inArray(schema.parkingProofDocuments.locationId, ids));
    await store.delete(proofs.map((file) => file.key));
    await db.delete(schema.listingOwners).where(inArray(schema.listingOwners.locationId, ids));
    await db.delete(schema.parkingLocations).where(inArray(schema.parkingLocations.id, ids));
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
    store = app.get<ObjectStore>(OBJECT_STORE);
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

  describe('who may', () => {
    const paths = [
      ['get', '/admin/listings'],
      ['get', `/admin/listings/${randomUUID()}`],
      ['get', `/admin/listings/${randomUUID()}/proofs/${randomUUID()}`],
      ['post', `/admin/listings/${randomUUID()}/approve`],
      ['post', `/admin/listings/${randomUUID()}/request-changes`],
      ['get', '/admin/audit'],
    ] as const;

    it.each(paths)('needs an account for %s %s', async (method, path) => {
      await call(null, method, path).send({}).expect(401);
    });

    it.each(paths)('is not for an ordinary account: %s %s', async (method, path) => {
      const user = await person();
      await call(user, method, path).send({ note: 'x' }).expect(403);
    });

    it.each(paths)('needs a second factor of an admin: %s %s', async (method, path) => {
      const user = await person();
      await updateUser(app, user.id, { role: 'admin' });
      const response = await call(user, method, path).send({ note: 'x' }).expect(403);
      expect(response.body).toMatchObject({ code: 'MFA_REQUIRED' });
    });
  });

  /** Every listing in the queue, page after page: whatever is in review from before comes first. */
  async function walk(admin: TestUser, status = 'in_review'): Promise<AdminQueue['listings']> {
    const all: AdminQueue['listings'] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 400; guard++) {
      const page: AdminQueue = AdminQueueSchema.parse(
        (
          await call(
            admin,
            'get',
            `/admin/listings?status=${status}${after ? `&after=${after}` : ''}`,
          ).expect(200)
        ).body,
      );
      expect(page.listings.length).toBeLessThanOrEqual(ADMIN_PAGE_SIZE);
      all.push(...page.listings);
      after = page.next;
      if (!after) break;
    }
    return all;
  }

  describe('the queue', () => {
    it('lists what is in review, oldest first, never a draft, with who sent it', async () => {
      const admin = await staff();
      const first = await inReview(`queue-a-${tag}`);
      const second = await inReview(`queue-b-${tag}`);
      const draft = await inReview(`queue-draft-${tag}`, 'draft');
      const seen = { listings: await walk(admin) };
      const ids = seen.listings.map((listing) => listing.id);
      expect(ids).toEqual(expect.arrayContaining([first.id, second.id]));
      expect(ids).not.toContain(draft.id);
      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
      expect(seen.listings.find((listing) => listing.id === first.id)).toMatchObject({
        status: 'in_review',
        owner: 'Test Driver',
        contentLocale: 'el',
      });
    });

    it('refuses a draft status, a made-up one and a place no page gave out', async () => {
      const admin = await staff();
      for (const query of ['?status=draft', '?status=gone', '?after=soon', '?after=']) {
        await call(admin, 'get', `/admin/listings${query}`).expect(400);
      }
    });

    it('pages by place, none repeated or missed, in the order of what was sent in', async () => {
      const admin = await staff();
      const made = [];
      for (let n = 0; n < 3; n++) made.push(await inReview(`page-${n}-${tag}`));
      // Whatever is in review from before comes first: walk the whole queue.
      const walked = await walk(admin);
      const ids = walked.map((listing) => listing.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const listing of made) expect(ids).toContain(listing.id);
      // Those sent in come in the order they were sent (the rest, with no date of sending, by creation).
      const sent = walked.flatMap((listing) => (listing.submittedAt ? [listing.submittedAt] : []));
      expect([...sent].sort()).toEqual(sent);
    });
  });

  describe('a listing as staff review it', () => {
    it('shows who is behind it with their tax as three characters, and what proves the right to rent', async () => {
      const admin = await staff();
      const { id, owner } = await inReview(`review-${tag}`);
      const lease = await addProof(id);
      const response = await call(admin, 'get', `/admin/listings/${id}`).expect(200);
      const review = AdminListingReviewSchema.parse(response.body);
      expect(review).toMatchObject({
        status: 'in_review',
        canDecide: true,
        own: false,
        photos: 0,
        spaces: ['A1'],
        landRegistrationNumber: 'KAEK-1234',
        hourlyRate: { amountMinor: 200, currency: 'EUR' },
      });
      expect(review.owners).toEqual([
        expect.objectContaining({
          role: 'primary',
          firstName: 'Ελένη',
          taxIdEnding: '216',
          vatIdEnding: null,
          verification: 'pending',
          sharePercent: 100,
          detailsComplete: true,
        }),
      ]);
      expect(review.proofs).toEqual([expect.objectContaining({ id: lease.id, kind: 'lease' })]);
      // The whole number, the birth date, the phone, the address and the owner's email: nowhere.
      const body = JSON.stringify(response.body);
      for (const secret of [
        TAX.taxId,
        TAX.birthDate,
        DETAILS.phone,
        DETAILS.addressLine,
        owner.email,
      ]) {
        expect(body).not.toContain(secret);
      }
      // Reading it is not a recorded action: only changes and the files themselves are.
      expect(await audited(id)).toEqual([]);
    });

    it('is not there for a draft, or one that does not exist', async () => {
      const admin = await staff();
      const draft = await inReview(`draft-${tag}`, 'draft');
      await call(admin, 'get', `/admin/listings/${draft.id}`).expect(404);
      await call(admin, 'get', `/admin/listings/${randomUUID()}`).expect(404);
      await call(admin, 'get', '/admin/listings/not-an-id').expect(404);
    });
  });

  describe('a proof of the right to rent', () => {
    it('downloads as a file, never shown in place, and opening it is a line in the log', async () => {
      const admin = await staff();
      const { id } = await inReview(`proof-${tag}`);
      const lease = await addProof(id);
      const response = await call(admin, 'get', `/admin/listings/${id}/proofs/${lease.id}`).expect(
        200,
      );
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-security-policy']).toContain('sandbox');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(await audited(id)).toEqual([
        {
          action: 'listing.proof_opened',
          actorId: admin.id,
          details: { proofId: lease.id, kind: 'lease' },
        },
      ]);
    });

    it('is not opened from a link on another site, and nothing is recorded', async () => {
      const admin = await staff();
      const { id } = await inReview(`proof-site-${tag}`);
      const lease = await addProof(id);
      await call(admin, 'get', `/admin/listings/${id}/proofs/${lease.id}`)
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);
      expect(await audited(id)).toEqual([]);
      await call(admin, 'get', `/admin/listings/${id}/proofs/${lease.id}`)
        .set('Sec-Fetch-Site', 'same-site')
        .expect(403);
      expect(await audited(id)).toEqual([]);
      for (const site of ['same-origin', 'none']) {
        await call(admin, 'get', `/admin/listings/${id}/proofs/${lease.id}`)
          .set('Sec-Fetch-Site', site)
          .expect(200);
      }
      expect(await audited(id)).toHaveLength(2);
    });

    it('is not recorded as opened when it can not be read, or is of another listing', async () => {
      const admin = await staff();
      const { id } = await inReview(`proof-gone-${tag}`);
      const other = await inReview(`proof-other-${tag}`);
      const lost = await addProof(id, false);
      const theirs = await addProof(other.id);
      await call(admin, 'get', `/admin/listings/${id}/proofs/${lost.id}`).expect(404);
      await call(admin, 'get', `/admin/listings/${id}/proofs/${theirs.id}`).expect(404);
      await call(admin, 'get', `/admin/listings/${id}/proofs/${randomUUID()}`).expect(404);
      await call(admin, 'get', `/admin/listings/${id}/proofs/nope`).expect(404);
      expect(await audited(id)).toEqual([]);
      expect(await audited(other.id)).toEqual([]);
    });

    it('is not a draft’s to open', async () => {
      const admin = await staff();
      const { id } = await inReview(`proof-draft-${tag}`, 'draft');
      const file = await addProof(id);
      await call(admin, 'get', `/admin/listings/${id}/proofs/${file.id}`).expect(404);
    });
  });

  describe('approving', () => {
    it('publishes it, verifies the owner, clears the note, and writes the line in the same go', async () => {
      const admin = await staff();
      const { id, ownerId } = await inReview(`approve-${tag}`);
      await db
        .update(schema.parkingLocations)
        .set({ reviewNote: 'An older note' })
        .where(eq(schema.parkingLocations.id, id));
      const done = AdminListingReviewSchema.parse(
        (await call(admin, 'post', `/admin/listings/${id}/approve`).expect(200)).body,
      );
      expect(done).toMatchObject({ status: 'published', canDecide: false, reviewNote: null });
      expect(done.owners[0]?.verification).toBe('verified');
      const [row] = await db
        .select({
          status: schema.parkingLocations.status,
          verified: schema.ownerProfiles.verification,
        })
        .from(schema.parkingLocations)
        .innerJoin(schema.ownerProfiles, eq(schema.ownerProfiles.id, ownerId))
        .where(eq(schema.parkingLocations.id, id));
      expect(row).toEqual({ status: 'published', verified: 'verified' });
      expect(await audited(id)).toEqual([
        {
          action: 'listing.approved',
          actorId: admin.id,
          details: { from: 'in_review', ownersVerified: 1 },
        },
      ]);
    });

    it('is refused when an owner’s details were emptied since it was sent in, changing nothing', async () => {
      const admin = await staff();
      const { id, ownerId } = await inReview(`emptied-${tag}`);
      await db
        .update(schema.ownerProfiles)
        .set({ phone: null, taxIdEncrypted: null })
        .where(eq(schema.ownerProfiles.id, ownerId));
      const refused = await call(admin, 'post', `/admin/listings/${id}/approve`).expect(409);
      expect(refused.body).toMatchObject({ code: 'OWNER_DETAILS_MISSING' });
      const [row] = await db
        .select({
          status: schema.parkingLocations.status,
          verified: schema.ownerProfiles.verification,
        })
        .from(schema.parkingLocations)
        .innerJoin(schema.ownerProfiles, eq(schema.ownerProfiles.id, ownerId))
        .where(eq(schema.parkingLocations.id, id));
      expect(row).toEqual({ status: 'in_review', verified: 'pending' });
      // Whole or not at all: the decision and its line stand or fall together.
      expect(await audited(id)).toEqual([]);
      // Sending it back is still theirs to do: nothing is verified by it.
      await call(admin, 'post', `/admin/listings/${id}/request-changes`)
        .send({ note: 'Complete your details' })
        .expect(200);
    });

    it('is decided once: a second press, or another admin’s, finds it decided', async () => {
      const [one, two] = [await staff(), await staff()];
      const { id } = await inReview(`twice-${tag}`);
      await call(one, 'post', `/admin/listings/${id}/approve`).expect(200);
      const again = await call(two, 'post', `/admin/listings/${id}/approve`).expect(409);
      expect(again.body).toMatchObject({ code: 'NOT_IN_REVIEW' });
      const sendBack = await call(two, 'post', `/admin/listings/${id}/request-changes`)
        .send({ note: 'Too late' })
        .expect(409);
      expect(sendBack.body).toMatchObject({ code: 'NOT_IN_REVIEW' });
      expect(await audited(id)).toHaveLength(1);
    });

    it('is decided once when two admins press at the same moment', async () => {
      const [one, two] = [await staff(), await staff()];
      const { id } = await inReview(`race-${tag}`);
      const answers = await Promise.all([
        call(one, 'post', `/admin/listings/${id}/approve`),
        call(two, 'post', `/admin/listings/${id}/request-changes`).send({ note: 'Racing' }),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      expect(await audited(id)).toHaveLength(1);
    });

    it('is refused for a listing that is a draft, and for one the admin owns or manages', async () => {
      const admin = await staff();
      const draft = await inReview(`approve-draft-${tag}`, 'draft');
      await call(admin, 'post', `/admin/listings/${draft.id}/approve`).expect(404);

      const mine = await inReview(`own-${tag}`);
      const [profile] = await db
        .insert(schema.ownerProfiles)
        .values({ userId: admin.id })
        .onConflictDoNothing()
        .returning({ id: schema.ownerProfiles.id });
      const adminProfile =
        profile?.id ??
        (
          await db
            .select({ id: schema.ownerProfiles.id })
            .from(schema.ownerProfiles)
            .where(eq(schema.ownerProfiles.userId, admin.id))
        )[0]?.id ??
        '';
      await db
        .insert(schema.listingOwners)
        .values({ locationId: mine.id, ownerId: adminProfile, role: 'co_owner', shareBps: 0 });
      const own = await call(admin, 'post', `/admin/listings/${mine.id}/approve`).expect(403);
      expect(own.body).toMatchObject({ code: 'OWN_LISTING' });
      await call(admin, 'post', `/admin/listings/${mine.id}/request-changes`)
        .send({ note: 'Mine' })
        .expect(403);
      expect(
        AdminListingReviewSchema.parse(
          (await call(admin, 'get', `/admin/listings/${mine.id}`).expect(200)).body,
        ).own,
      ).toBe(true);

      // The profile named as its owner, with no row among the owners: the same.
      const lone = await inReview(`lone-${tag}`);
      await db.delete(schema.listingOwners).where(eq(schema.listingOwners.locationId, lone.id));
      await db
        .update(schema.parkingLocations)
        .set({ ownerId: adminProfile })
        .where(eq(schema.parkingLocations.id, lone.id));
      const named = await call(admin, 'post', `/admin/listings/${lone.id}/approve`).expect(403);
      expect(named.body).toMatchObject({ code: 'OWN_LISTING' });
      expect(await audited(lone.id)).toEqual([]);

      // A manager of a listing is no more its reviewer than an owner is.
      const managed = await inReview(`managed-${tag}`);
      await db.insert(schema.listingManagers).values({ locationId: managed.id, userId: admin.id });
      await call(admin, 'post', `/admin/listings/${managed.id}/approve`).expect(403);
      expect(await audited(mine.id)).toEqual([]);
      expect(await audited(managed.id)).toEqual([]);
    });
  });

  describe('sending it back', () => {
    it('keeps the note for the owner and in the log, and queues nothing it was not asked', async () => {
      const admin = await staff();
      const { id, owner } = await inReview(`back-${tag}`);
      const note = 'Please add a clearer photo of the entrance.\nThe lease must show the space.';
      const done = AdminListingReviewSchema.parse(
        (
          await call(admin, 'post', `/admin/listings/${id}/request-changes`)
            .send({ note: `  ${note}  ` })
            .expect(200)
        ).body,
      );
      expect(done).toMatchObject({
        status: 'changes_requested',
        reviewNote: note,
        canDecide: false,
      });
      // The owner reads it with their listing's progress (and only while it is with them).
      const onboarding = (await call(owner, 'get', '/owner/onboarding').expect(200)).body as {
        listings: { id: string; status: string; reviewNote: string | null }[];
      };
      expect(onboarding.listings.find((listing) => listing.id === id)).toMatchObject({
        status: 'changes_requested',
        reviewNote: note,
      });
      expect(await audited(id)).toEqual([
        {
          action: 'listing.changes_requested',
          actorId: admin.id,
          details: { from: 'in_review', note },
        },
      ]);
      // The owner's verification is not touched by a sending back.
      expect(done.owners[0]?.verification).toBe('pending');
    });

    it('refuses an empty note, a note too long and a field that is not one, writing nothing', async () => {
      const admin = await staff();
      const { id } = await inReview(`bad-note-${tag}`);
      for (const body of [
        {},
        { note: '' },
        { note: '   ' },
        { note: 'x'.repeat(2001) },
        { note: 'ok', extra: 1 },
      ]) {
        await call(admin, 'post', `/admin/listings/${id}/request-changes`).send(body).expect(400);
      }
      expect(await audited(id)).toEqual([]);
      const [row] = await db
        .select({ status: schema.parkingLocations.status })
        .from(schema.parkingLocations)
        .where(eq(schema.parkingLocations.id, id));
      expect(row?.status).toBe('in_review');
    });
  });

  describe('the log', () => {
    /**
     * A fixed block of lines, three to every millisecond, in a year no real line is in: the same
     * on every run (kept for good, and added once), so a page's end falls inside a tie.
     */
    const FILL_AT = Date.UTC(2020, 5, 1);
    const FILL = Array.from({ length: 30 }, (_, n) => ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      at: new Date(FILL_AT + Math.floor(n / 3)),
    }));
    async function fill(admin: TestUser) {
      await db
        .insert(schema.auditLog)
        .values(
          FILL.map(({ id, at }) => ({
            id,
            at,
            actorId: admin.id,
            action: 'listing.proof_opened' as const,
            targetType: 'listing' as const,
            targetId: id,
            details: { fill: true },
          })),
        )
        .onConflictDoNothing();
    }

    it('lists what staff did, newest first, with who did it, and keeps what each did', async () => {
      const admin = await staff();
      const { id } = await inReview(`log-${tag}`);
      await call(admin, 'post', `/admin/listings/${id}/request-changes`)
        .send({ note: 'Fix it' })
        .expect(200);
      const log = AuditLogSchema.parse((await call(admin, 'get', '/admin/audit').expect(200)).body);
      expect(log.entries[0]).toMatchObject({
        action: 'listing.changes_requested',
        targetType: 'listing',
        targetId: id,
        actor: { id: admin.id, email: admin.email.toLowerCase() },
        details: { from: 'in_review', note: 'Fix it' },
      });
      const times = log.entries.map((entry) => entry.at);
      expect([...times].sort().reverse()).toEqual(times);
    });

    it('pages by place across a tie of the same millisecond, none repeated and none missed', async () => {
      const admin = await staff();
      await fill(admin);
      // From just after the block: only its lines (and older ones, which come after), in order.
      const start = adminCursor(
        new Date(Date.UTC(2020, 6, 1)),
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
      );
      const first: AuditLog = AuditLogSchema.parse(
        (await call(admin, 'get', `/admin/audit?after=${start}`).expect(200)).body,
      );
      expect(first.entries).toHaveLength(ADMIN_PAGE_SIZE);
      expect(first.next).not.toBeNull();
      const second: AuditLog = AuditLogSchema.parse(
        (await call(admin, 'get', `/admin/audit?after=${first.next}`).expect(200)).body,
      );
      expect(second.entries.length).toBeGreaterThan(0);
      // The page ends inside a tie (lines 24, 25 and 26 share a millisecond); each is on one page.
      const expected = [...FILL]
        .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1))
        .map((line) => line.id);
      const walked = [...first.entries, ...second.entries].map((entry) => entry.id).slice(0, 30);
      expect(walked).toEqual(expected);
    });

    it('filters by each action, and a filter shows what was just done', async () => {
      const admin = await staff();
      const { id } = await inReview(`filter-${tag}`);
      await call(admin, 'post', `/admin/listings/${id}/approve`).expect(200);
      for (const action of AUDIT_ACTIONS) {
        const only = AuditLogSchema.parse(
          (await call(admin, 'get', `/admin/audit?action=${action}`).expect(200)).body,
        );
        // Only what this file did is certain to be there: other actions have their own specs, and
        // a fresh database has none of theirs when this one runs first.
        if (action === 'listing.approved') expect(only.entries.length).toBeGreaterThan(0);
        expect(only.entries.every((entry) => entry.action === action)).toBe(true);
      }
      const approved = AuditLogSchema.parse(
        (await call(admin, 'get', '/admin/audit?action=listing.approved').expect(200)).body,
      );
      expect(approved.entries.map((entry) => entry.targetId)).toContain(id);
      await call(admin, 'get', '/admin/audit?action=user.deleted').expect(400);
      await call(admin, 'get', '/admin/audit?after=soon').expect(400);
    });

    it('is the database’s to keep: a line can’t be changed or deleted, nor the log emptied', async () => {
      const admin = await staff();
      const { id } = await inReview(`immutable-${tag}`);
      await call(admin, 'post', `/admin/listings/${id}/request-changes`)
        .send({ note: 'Keep' })
        .expect(200);
      const [line] = await audited(id);
      expect(line).toBeDefined();
      const where = eq(schema.auditLog.targetId, id);
      const appendOnly = { cause: { message: expect.stringMatching(/append-only/) as unknown } };
      await expect(
        db.update(schema.auditLog).set({ action: 'listing.approved' }).where(where),
      ).rejects.toMatchObject(appendOnly);
      await expect(db.delete(schema.auditLog).where(where)).rejects.toMatchObject(appendOnly);
      await expect(db.execute(sql`truncate table audit_log`)).rejects.toMatchObject(appendOnly);
      // Not through a cascade from the accounts that wrote it either.
      await expect(db.execute(sql`truncate table users cascade`)).rejects.toThrow();
      // An account that acted is kept with its record.
      await expect(db.delete(schema.users).where(eq(schema.users.id, admin.id))).rejects.toThrow();
      expect(await audited(id)).toHaveLength(1);
      // Reading and adding go on as before.
      await db
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(and(where, eq(schema.auditLog.actorId, admin.id)));
    });
  });

  describe('a queue that pages across a tie', () => {
    it('keeps every listing of a same-millisecond tie on one page or the next, in order', async () => {
      const admin = await staff();
      const base = Date.UTC(2021, 0, 1);
      const made: { id: string; at: number }[] = [];
      for (let n = 0; n < 27; n++) {
        const [row] = await db
          .insert(schema.parkingLocations)
          .values({
            slug: `${PREFIX}${tag}-tie-${n}`,
            name: `Ισοβαθμία ${n}`,
            address: 'Οδός Δοκιμής 1, Καλαμάτα',
            areaId: 'syntagma',
            location: HERE,
            hourlyRateMinor: 200,
            status: 'suspended',
            submittedAt: new Date(base + Math.floor(n / 3)),
          })
          .returning({ id: schema.parkingLocations.id });
        made.push({ id: row?.id ?? '', at: base + Math.floor(n / 3) });
      }
      const ours = new Set(made.map((listing) => listing.id));
      const walked = (await walk(admin, 'suspended'))
        .map((listing) => listing.id)
        .filter((id) => ours.has(id));
      const expected = [...made]
        .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
        .map((listing) => listing.id);
      expect(walked).toEqual(expected);
    });
  });

  describe('a decision and its line stand or fall together', () => {
    /** Makes writing a line for this target fail, as a full disk or a lost connection would. */
    async function failingAuditFor<T>(targetId: string, run: () => Promise<T>): Promise<T> {
      const name = `it_audit_fail_${tag.replaceAll('-', '')}`;
      await db.execute(
        sql.raw(`create function ${name}() returns trigger language plpgsql as $$
          begin
            if new.target_id = '${targetId}' then raise exception 'audit refused'; end if;
            return new;
          end $$`),
      );
      await db.execute(
        sql.raw(
          `create trigger ${name} before insert on audit_log for each row execute function ${name}()`,
        ),
      );
      try {
        return await run();
      } finally {
        await db.execute(sql.raw(`drop trigger ${name} on audit_log`));
        await db.execute(sql.raw(`drop function ${name}()`));
      }
    }
    const state = async (id: string, ownerId: string) =>
      (
        await db
          .select({
            status: schema.parkingLocations.status,
            note: schema.parkingLocations.reviewNote,
            verified: schema.ownerProfiles.verification,
          })
          .from(schema.parkingLocations)
          .innerJoin(schema.ownerProfiles, eq(schema.ownerProfiles.id, ownerId))
          .where(eq(schema.parkingLocations.id, id))
      )[0];

    it('leaves an approval wholly undone when its line can not be written', async () => {
      const admin = await staff();
      const { id, ownerId } = await inReview(`atomic-approve-${tag}`);
      await failingAuditFor(id, async () => {
        await call(admin, 'post', `/admin/listings/${id}/approve`).expect(500);
      });
      expect(await state(id, ownerId)).toEqual({
        status: 'in_review',
        note: null,
        verified: 'pending',
      });
      expect(await audited(id)).toEqual([]);
      // Nothing was left half done: pressed again, it goes through.
      await call(admin, 'post', `/admin/listings/${id}/approve`).expect(200);
      expect(await audited(id)).toHaveLength(1);
    });

    it('leaves sending it back wholly undone when its line can not be written', async () => {
      const admin = await staff();
      const { id, ownerId } = await inReview(`atomic-back-${tag}`);
      await failingAuditFor(id, async () => {
        await call(admin, 'post', `/admin/listings/${id}/request-changes`)
          .send({ note: 'Fix the photos' })
          .expect(500);
      });
      expect(await state(id, ownerId)).toEqual({
        status: 'in_review',
        note: null,
        verified: 'pending',
      });
      expect(await audited(id)).toEqual([]);
    });

    it('hands over no proof when its line can not be written', async () => {
      const admin = await staff();
      const { id } = await inReview(`atomic-proof-${tag}`);
      const lease = await addProof(id);
      await failingAuditFor(id, async () => {
        const response = await call(
          admin,
          'get',
          `/admin/listings/${id}/proofs/${lease.id}`,
        ).expect(500);
        expect(JSON.stringify(response.body)).not.toContain('lease');
        expect(response.headers['content-disposition']).toBeUndefined();
      });
      expect(await audited(id)).toEqual([]);
    });
  });

  describe('deciding together', () => {
    it('lets exactly one of five simultaneous approvals through, with one line and one verification', async () => {
      const admins = await Promise.all([staff(), staff(), staff(), staff(), staff()]);
      const { id, ownerId } = await inReview(`five-${tag}`);
      const answers = await Promise.all(
        admins.map((admin) => call(admin, 'post', `/admin/listings/${id}/approve`)),
      );
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409, 409, 409, 409]);
      for (const answer of answers.filter((one) => one.status === 409)) {
        expect(answer.body).toMatchObject({ code: 'NOT_IN_REVIEW' });
      }
      const lines = await audited(id);
      expect(lines).toEqual([
        expect.objectContaining({
          action: 'listing.approved',
          details: { from: 'in_review', ownersVerified: 1 },
        }),
      ]);
      const [row] = await db
        .select({
          status: schema.parkingLocations.status,
          verified: schema.ownerProfiles.verification,
        })
        .from(schema.parkingLocations)
        .innerJoin(schema.ownerProfiles, eq(schema.ownerProfiles.id, ownerId))
        .where(eq(schema.parkingLocations.id, id));
      expect(row).toEqual({ status: 'published', verified: 'verified' });
    });
  });

  describe('approving a listing with several owners', () => {
    /** An account with its details and tax in, as an owner who has finished onboarding. */
    async function reported(): Promise<{ user: TestUser; profileId: string }> {
      const user = await person();
      await call(user, 'patch', '/owner/profile').send(DETAILS).expect(200);
      await call(user, 'put', '/owner/profile/tax').send(TAX).expect(200);
      const [profile] = await db
        .select({ id: schema.ownerProfiles.id })
        .from(schema.ownerProfiles)
        .where(eq(schema.ownerProfiles.userId, user.id));
      return { user, profileId: profile?.id ?? '' };
    }
    const verification = async (profileId: string) =>
      (
        await db
          .select({ verification: schema.ownerProfiles.verification })
          .from(schema.ownerProfiles)
          .where(eq(schema.ownerProfiles.id, profileId))
      )[0]?.verification;

    it('verifies the primary and each owner with a share, and leaves the rest as they were', async () => {
      const admin = await staff();
      const { id, ownerId } = await inReview(`many-${tag}`);
      const paid = await reported();
      const already = await reported();
      const unpaid = await person();
      await draftOf(unpaid); // an owner profile with nothing in it
      const [unpaidProfile] = await db
        .select({ id: schema.ownerProfiles.id })
        .from(schema.ownerProfiles)
        .where(eq(schema.ownerProfiles.userId, unpaid.id));
      const helper = await person();
      await db
        .update(schema.listingOwners)
        .set({ shareBps: 4000 })
        .where(eq(schema.listingOwners.locationId, id));
      await db.insert(schema.listingOwners).values([
        { locationId: id, ownerId: paid.profileId, role: 'co_owner', shareBps: 3000 },
        { locationId: id, ownerId: already.profileId, role: 'co_owner', shareBps: 3000 },
        { locationId: id, ownerId: unpaidProfile?.id ?? '', role: 'co_owner', shareBps: 0 },
      ]);
      await db.insert(schema.listingManagers).values({ locationId: id, userId: helper.id });
      await db
        .update(schema.ownerProfiles)
        .set({ verification: 'pending' })
        .where(inArray(schema.ownerProfiles.id, [paid.profileId, unpaidProfile?.id ?? '']));
      await db
        .update(schema.ownerProfiles)
        .set({ verification: 'rejected' })
        .where(eq(schema.ownerProfiles.id, already.profileId));

      const done = AdminListingReviewSchema.parse(
        (await call(admin, 'post', `/admin/listings/${id}/approve`).expect(200)).body,
      );
      expect(done.status).toBe('published');
      expect(await verification(ownerId)).toBe('verified');
      expect(await verification(paid.profileId)).toBe('verified');
      // Someone already turned down is not made verified by a listing: it is theirs to review.
      expect(await verification(already.profileId)).toBe('rejected');
      // At 0% with nothing filled in: not accountable, not blocking, not verified.
      expect(await verification(unpaidProfile?.id ?? '')).toBe('pending');
      expect((await audited(id))[0]?.details).toEqual({ from: 'in_review', ownersVerified: 2 });
    });

    it('is blocked by an owner with a share whose details are not in, and not by one without a share', async () => {
      const admin = await staff();
      const { id } = await inReview(`blocked-${tag}`);
      const paid = await reported();
      const quiet = await person();
      await draftOf(quiet);
      const [quietProfile] = await db
        .select({ id: schema.ownerProfiles.id })
        .from(schema.ownerProfiles)
        .where(eq(schema.ownerProfiles.userId, quiet.id));
      await db
        .update(schema.listingOwners)
        .set({ shareBps: 5000 })
        .where(eq(schema.listingOwners.locationId, id));
      await db.insert(schema.listingOwners).values([
        { locationId: id, ownerId: paid.profileId, role: 'co_owner', shareBps: 5000 },
        { locationId: id, ownerId: quietProfile?.id ?? '', role: 'co_owner', shareBps: 0 },
      ]);
      // The 0% owner has nothing in: no matter. The one paid half, with their kind emptied: it blocks.
      await db
        .update(schema.ownerProfiles)
        .set({ kind: null })
        .where(eq(schema.ownerProfiles.id, paid.profileId));
      const refused = await call(admin, 'post', `/admin/listings/${id}/approve`).expect(409);
      expect(refused.body).toMatchObject({ code: 'OWNER_DETAILS_MISSING' });
      expect(await audited(id)).toEqual([]);
      await db
        .update(schema.ownerProfiles)
        .set({ kind: 'individual' })
        .where(eq(schema.ownerProfiles.id, paid.profileId));
      await call(admin, 'post', `/admin/listings/${id}/approve`).expect(200);
    });
  });

  describe('never one’s own listing', () => {
    async function mine(admin: TestUser, shareBps: number, role: 'primary' | 'co_owner') {
      const target = await inReview(
        `o${role === 'primary' ? 'p' : 'c'}${shareBps}-${randomUUID().slice(0, 6)}`,
      );
      const [existing] = await db
        .select({ id: schema.ownerProfiles.id })
        .from(schema.ownerProfiles)
        .where(eq(schema.ownerProfiles.userId, admin.id));
      const profileId =
        existing?.id ??
        (
          await db
            .insert(schema.ownerProfiles)
            .values({ userId: admin.id })
            .returning({ id: schema.ownerProfiles.id })
        )[0]?.id ??
        '';
      if (role === 'primary') {
        await db
          .update(schema.listingOwners)
          .set({ ownerId: profileId })
          .where(eq(schema.listingOwners.locationId, target.id));
        await db
          .update(schema.parkingLocations)
          .set({ ownerId: profileId })
          .where(eq(schema.parkingLocations.id, target.id));
      } else {
        await db
          .update(schema.listingOwners)
          .set({ shareBps: 10_000 - shareBps })
          .where(eq(schema.listingOwners.locationId, target.id));
        await db
          .insert(schema.listingOwners)
          .values({ locationId: target.id, ownerId: profileId, role, shareBps });
      }
      return target.id;
    }
    const status = async (id: string) =>
      (
        await db
          .select({ status: schema.parkingLocations.status })
          .from(schema.parkingLocations)
          .where(eq(schema.parkingLocations.id, id))
      )[0]?.status;

    it('refuses the primary owner, either way, leaving it as it was', async () => {
      const admin = await staff();
      const id = await mine(admin, 10_000, 'primary');
      for (const [path, body] of [
        ['approve', undefined],
        ['request-changes', { note: 'Mine' }],
      ] as const) {
        const answer = await call(admin, 'post', `/admin/listings/${id}/${path}`)
          .send(body)
          .expect(403);
        expect(answer.body).toMatchObject({ code: 'OWN_LISTING' });
      }
      expect(await status(id)).toBe('in_review');
      expect(await audited(id)).toEqual([]);
      const review = await call(admin, 'get', `/admin/listings/${id}`).expect(200);
      expect(review.body).toMatchObject({ own: true });
    });

    it('refuses a co-owner paid half, and answers an own listing already published with the same 403', async () => {
      const admin = await staff();
      const id = await mine(admin, 5000, 'co_owner');
      await call(admin, 'post', `/admin/listings/${id}/approve`).expect(403);
      await db
        .update(schema.parkingLocations)
        .set({ status: 'published' })
        .where(eq(schema.parkingLocations.id, id));
      // Whose it is is told before what state it is in.
      const answer = await call(admin, 'post', `/admin/listings/${id}/approve`).expect(403);
      expect(answer.body).toMatchObject({ code: 'OWN_LISTING' });
    });

    it('refuses a manager sending it back as it refuses them approving', async () => {
      const admin = await staff();
      const { id } = await inReview(`mgr-back-${tag}`);
      await db.insert(schema.listingManagers).values({ locationId: id, userId: admin.id });
      await call(admin, 'post', `/admin/listings/${id}/request-changes`)
        .send({ note: 'Mine' })
        .expect(403);
      expect(await status(id)).toBe('in_review');
    });
  });

  describe('what reaches an admin route', () => {
    it('is refused from another origin, changing nothing', async () => {
      const admin = await staff();
      const { id } = await inReview(`csrf-${tag}`);
      for (const [path, body] of [
        ['approve', {}],
        ['request-changes', { note: 'Evil' }],
      ] as const) {
        await call(admin, 'post', `/admin/listings/${id}/${path}`)
          .set('Origin', 'https://evil.example')
          .send(body)
          .expect(403);
      }
      const [row] = await db
        .select({ status: schema.parkingLocations.status })
        .from(schema.parkingLocations)
        .where(eq(schema.parkingLocations.id, id));
      expect(row?.status).toBe('in_review');
      expect(await audited(id)).toEqual([]);
    });

    it('follows a live account: demoted, or without its second factor, the next call is refused', async () => {
      const admin = await staff();
      await call(admin, 'get', '/admin/audit').expect(200);
      await updateUser(app, admin.id, { twoFactorEnabled: false });
      const noFactor = await call(admin, 'get', '/admin/audit').expect(403);
      expect(noFactor.body).toMatchObject({ code: 'MFA_REQUIRED' });
      await updateUser(app, admin.id, { twoFactorEnabled: true });
      await call(admin, 'get', '/admin/audit').expect(200);
      await updateUser(app, admin.id, { role: 'user' });
      await call(admin, 'get', '/admin/audit').expect(403);
    });
  });

  describe('the proof itself', () => {
    const binary: Parameters<ReturnType<typeof call>['parse']>[0] = (res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    };

    it('is the stored file, byte for byte, under its own name', async () => {
      const admin = await staff();
      const { id } = await inReview(`bytes-${tag}`);
      const lease = await addProof(id);
      const response = await call(admin, 'get', `/admin/listings/${id}/proofs/${lease.id}`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect((response.body as Buffer).toString()).toBe('%PDF-1.4 a lease');
      expect(response.headers['content-disposition']).toContain('lease.pdf');
    });

    it('is still the staff’s to open once the listing has been decided', async () => {
      const admin = await staff();
      const { id } = await inReview(`after-${tag}`);
      const lease = await addProof(id);
      await call(admin, 'post', `/admin/listings/${id}/approve`).expect(200);
      await call(admin, 'get', `/admin/listings/${id}/proofs/${lease.id}`).expect(200);
      expect((await audited(id)).map((line) => line.action)).toEqual([
        'listing.approved',
        'listing.proof_opened',
      ]);
    });

    it('answers a store that is down with an error of ours, and no line', async () => {
      const admin = await staff();
      const { id } = await inReview(`down-${tag}`);
      const lease = await addProof(id);
      const spy = vi.spyOn(store, 'get').mockRejectedValueOnce(new Error('S3 is down at bucket-x'));
      try {
        const response = await call(
          admin,
          'get',
          `/admin/listings/${id}/proofs/${lease.id}`,
        ).expect(500);
        expect(JSON.stringify(response.body)).not.toContain('bucket-x');
      } finally {
        spy.mockRestore();
      }
      expect(await audited(id)).toEqual([]);
    });
  });
});
