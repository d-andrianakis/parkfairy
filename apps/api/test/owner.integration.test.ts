import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  addDays,
  DEFAULT_TIME_ZONE,
  OwnerListingProgressSchema,
  OwnerListingSchema,
  OwnerOnboardingSchema,
  OwnerPhotoSchema,
  OwnerProfileSchema,
  OwnerProofSchema,
  ParkingListingDetailSchema,
  ParkingSearchResponseSchema,
  PHOTO_LIMITS,
  PROOF_LIMITS,
  zonedParts,
  zonedTimeToUtc,
  type ListingStep,
} from '@parkfairy/contracts';
import {
  claimDueEmails,
  countOverdueEmails,
  enqueueListingStatusEmails,
  enqueueOnboardingReminders,
  markEmailFailed,
  markEmailSent,
  MAX_EMAIL_ATTEMPTS,
  purgeSentEmails,
  schema,
  type ClaimedEmail,
  type Database,
} from '@parkfairy/database';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/database/database.module.js';
import { OWNER_LISTINGS_MAX } from '../src/owner/owner-listings.service.js';
import { OBJECT_STORE, type ObjectStore } from '../src/storage/object-store.js';
import { createTestApp, signUpUser, type TestApp, type TestUser } from './test-app.js';

// Far from every demo area, so these listings never meet the seeded ones in a search.
const HERE = { latitude: 35.3387, longitude: 25.1442 };
type Parser = (res: request.Response, done: (error: Error | null, body: unknown) => void) => void;

const VALID_AFM = '094259216';
const OPENAPI = new URL('../../../packages/api-client/openapi.json', import.meta.url);
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;

const location = {
  name: `Γκαράζ δοκιμής ${randomUUID().slice(0, 6)}`,
  address: 'Οδός Δοκιμής 1, Ηράκλειο',
  areaId: 'syntagma',
  ...HERE,
  description: 'Για τις δοκιμές.',
  contentLocale: 'el',
};
const spaces = {
  spaces: [
    { label: 'A1', features: ['covered'], hourlyRateMinor: null },
    { label: 'A2', features: ['evCharging'], hourlyRateMinor: 400 },
  ],
};
const WEEK = [1, 2, 3, 4, 5, 6, 7];
const hours = { periods: WEEK.map((weekday) => ({ weekday, opens: '00:00', closes: '24:00' })) };
const prices = {
  hourlyRateMinor: 200,
  dailyMaxMinor: 2000,
  bookingGapMinutes: 30,
  cancellationPolicy: 'oneDay',
  weekendRateMinor: 300,
  night: { rateMinor: 100, from: '22:00', to: '06:00' },
  datedPrices: [
    { label: 'Δεκαπενταύγουστος', startsOn: '2099-08-14', endsOn: '2099-08-16', rateMinor: 500 },
  ],
  longStayDiscounts: [{ minDays: 7, percent: 10 }],
};
const profile = {
  kind: 'individual',
  firstName: 'Μαρία',
  lastName: 'Παπαδοπούλου',
  phone: '+30 210 123 4567',
  addressLine: 'Ερμού 1',
  city: 'Αθήνα',
  postalCode: '105 63',
  country: 'GR',
};
const tax = { taxCountry: 'GR', taxId: VALID_AFM, birthDate: '1980-02-03', vatId: 'EL094259216' };

const PDF = Buffer.from('%PDF-1.7\nnot much of a document');

/** Keeps a response as bytes; without it the test would only see what supertest could guess. */
const bytes: Parser = (response, done) => {
  const stream = response as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
};

function jpeg(width = 1200, height = 800, r = 120): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r, g: 90, b: 60 } } })
    .jpeg()
    .toBuffer();
}

const visitors = new Map<string, string>();
function visitorOf({ id }: TestUser): string {
  const known = visitors.get(id);
  if (known) return known;
  const address = `198.18.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
  visitors.set(id, address);
  return address;
}

/**
 * Files are named by content, so two equal pictures share one: these never do, in this run or
 * against what an earlier run left behind.
 */
function uniqueJpeg(): Promise<Buffer> {
  const background = { r: 1, g: 2, b: 3 };
  return sharp({ create: { width: 1200, height: 800, channels: 3, background } })
    .withExif({ IFD0: { ImageDescription: randomUUID() } })
    .jpeg()
    .toBuffer();
}

describe('owner onboarding', () => {
  let app: TestApp;
  let db: Database;
  let store: ObjectStore;
  let owner: TestUser;
  let stranger: TestUser;

  const api = (
    user: TestUser | null,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
  ) => {
    const call = request(app.getHttpServer())[method](`/v1/owner${path}`);
    if (method !== 'get') call.set('Origin', ORIGIN); // as a browser does; the guard needs it
    // Each user is a visitor of their own, as in life: rate limits count per client.
    return user ? call.set('Cookie', user.cookie).set('X-Forwarded-For', visitorOf(user)) : call;
  };

  const upload = (user: TestUser, id: string, file: Buffer, type = 'image/jpeg') =>
    api(user, 'post', `/listings/${id}/photos`).set('Content-Type', type).send(file);

  const uploadProof = (user: TestUser, id: string, file: Buffer, type = 'application/pdf') =>
    api(user, 'post', `/listings/${id}/proofs`)
      .query({ kind: 'lease' })
      .set('X-File-Name', encodeURIComponent('μισθωτήριο.pdf'))
      .set('Content-Type', type)
      .send(file);

  async function ownerRow({ id }: TestUser) {
    const [row] = await db
      .select()
      .from(schema.ownerProfiles)
      .where(eq(schema.ownerProfiles.userId, id));
    if (!row) throw new Error('No owner profile');
    return row;
  }

  async function newListing(user: TestUser): Promise<string> {
    const response = await api(user, 'post', '/listings').expect(201);
    return (response.body as { id: string }).id;
  }

  async function progress(user: TestUser, id: string) {
    const response = await api(user, 'get', `/listings/${id}`).expect(200);
    return OwnerListingSchema.parse(response.body).progress;
  }

  /** A listing with every step done, ready for review. */
  async function readyListing(user: TestUser): Promise<string> {
    const id = await newListing(user);
    await api(user, 'patch', `/listings/${id}/location`).send(location).expect(200);
    await api(user, 'put', `/listings/${id}/spaces`).send(spaces).expect(200);
    await api(user, 'put', `/listings/${id}/hours`).send(hours).expect(200);
    await api(user, 'put', `/listings/${id}/prices`).send(prices).expect(200);
    await upload(user, id, await uniqueJpeg()).expect(201);
    await uploadProof(user, id, PDF).expect(201);
    return id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
    store = app.get<ObjectStore>(OBJECT_STORE);
    owner = await signUpUser(app);
    stranger = await signUpUser(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('who can reach what', () => {
    it.each([
      ['get', '/onboarding'],
      ['get', '/profile'],
      ['patch', '/profile'],
      ['put', '/profile/tax'],
      ['post', '/listings'],
      ['get', `/listings/${randomUUID()}`],
    ] as const)('refuses %s %s without a session', async (method, path) => {
      await api(null, method, path).expect(401);
    });

    it('answers another owner’s listing like one that does not exist', async () => {
      const id = await newListing(owner);
      const missing = await api(stranger, 'get', `/listings/${randomUUID()}`).expect(404);
      const theirs = await api(stranger, 'get', `/listings/${id}`).expect(404);
      expect(theirs.body).toEqual(missing.body);
      expect((theirs.body as { code: string }).code).toBe('LISTING_NOT_FOUND');
    });

    it('lets nobody else write to, upload to or delete a listing', async () => {
      const id = await newListing(owner);
      await api(stranger, 'patch', `/listings/${id}/location`)
        .send({ name: 'Δικό μου' })
        .expect(404);
      await api(stranger, 'put', `/listings/${id}/spaces`).send(spaces).expect(404);
      await api(stranger, 'put', `/listings/${id}/hours`).send(hours).expect(404);
      await api(stranger, 'put', `/listings/${id}/prices`).send(prices).expect(404);
      await upload(stranger, id, await jpeg()).expect(404);
      await uploadProof(stranger, id, PDF).expect(404);
      await api(stranger, 'post', `/listings/${id}/submit`).send({ confirmed: true }).expect(404);
      await api(stranger, 'delete', `/listings/${id}`).expect(404);

      const unchanged = await api(owner, 'get', `/listings/${id}`).expect(200);
      expect(OwnerListingSchema.parse(unchanged.body).location.name).toBeNull();
    });

    it('keeps photos and proofs of one listing out of reach through another', async () => {
      const mine = await newListing(owner);
      const theirs = await newListing(stranger);
      const photo = OwnerPhotoSchema.parse(
        (await upload(owner, mine, await jpeg()).expect(201)).body,
      );
      const proof = OwnerProofSchema.parse((await uploadProof(owner, mine, PDF).expect(201)).body);

      await api(stranger, 'patch', `/listings/${theirs}/photos/${photo.id}`)
        .send({ alt: 'x' })
        .expect(404);
      await api(stranger, 'delete', `/listings/${theirs}/photos/${photo.id}`).expect(404);
      await api(stranger, 'get', `/listings/${theirs}/proofs/${proof.id}`).expect(404);
      await api(stranger, 'get', `/listings/${mine}/proofs/${proof.id}`).expect(404);
      await api(stranger, 'delete', `/listings/${theirs}/proofs/${proof.id}`).expect(404);
    });

    it('answers a malformed id with the same 404, not a database error', async () => {
      await api(owner, 'get', '/listings/not-a-uuid').expect(404);
    });

    it('refuses a write from another site', async () => {
      await request(app.getHttpServer())
        .post('/v1/owner/listings')
        .set('Cookie', owner.cookie)
        .set('Origin', 'https://evil.example')
        .expect(403);
    });
  });

  describe('every route', () => {
    it('refuses a visitor with no session, on every owner path in the API document', async () => {
      const paths = Object.entries(
        (JSON.parse(readFileSync(OPENAPI, 'utf8')) as { paths: Record<string, object> }).paths,
      ).filter(([path]) => path.startsWith('/v1/owner'));
      expect(paths.length).toBeGreaterThan(15);
      const id = randomUUID();
      for (const [path, operations] of paths) {
        const url = path.replace(/\{[^}]+\}/g, id);
        for (const method of Object.keys(operations) as (
          'get' | 'post' | 'put' | 'patch' | 'delete'
        )[]) {
          const call = request(app.getHttpServer())[method](url);
          if (method !== 'get') call.set('Origin', ORIGIN);
          await call.expect(401);
        }
      }
    });

    it('shows an owner only their own listings, last touched first', async () => {
      const mine = await signUpUser(app);
      const theirs = await signUpUser(app);
      const older = await newListing(mine);
      const newer = await newListing(mine);
      await newListing(theirs);
      await api(mine, 'patch', `/listings/${newer}/location`).send({ name: 'Νέο' }).expect(200);

      const overview = OwnerOnboardingSchema.parse(
        (await api(mine, 'get', '/onboarding').expect(200)).body,
      );
      expect(overview.listings.map((listing) => listing.id)).toEqual([newer, older]);
    });

    it('lets nobody else change a photo, a document or their order', async () => {
      const id = await newListing(owner);
      const photo = OwnerPhotoSchema.parse(
        (await upload(owner, id, await uniqueJpeg()).expect(201)).body,
      );
      const proof = OwnerProofSchema.parse((await uploadProof(owner, id, PDF).expect(201)).body);
      await api(stranger, 'patch', `/listings/${id}/photos/${photo.id}`)
        .send({ alt: 'x' })
        .expect(404);
      await api(stranger, 'delete', `/listings/${id}/photos/${photo.id}`).expect(404);
      await api(stranger, 'put', `/listings/${id}/photos/order`)
        .send({ ids: [photo.id] })
        .expect(404);
      await api(stranger, 'delete', `/listings/${id}/proofs/${proof.id}`).expect(404);
      await api(stranger, 'patch', `/listings/${id}/proof-details`)
        .send({ landRegistrationNumber: '1' })
        .expect(404);
    });

    it('caps an owner’s listings', async () => {
      const user = await signUpUser(app);
      await newListing(user);
      const { id: ownerId } = await ownerRow(user);
      const fill = Array.from({ length: OWNER_LISTINGS_MAX - 1 }, () => {
        const listingId = randomUUID();
        return { id: listingId, ownerId, slug: `draft-${listingId}` };
      });
      await db.insert(schema.parkingLocations).values(fill);
      const response = await api(user, 'post', '/listings').expect(409);
      expect((response.body as { code: string }).code).toBe('TOO_MANY_LISTINGS');
    });
  });

  describe('the profile', () => {
    it('reports nothing started for an account that never began', async () => {
      const fresh = await signUpUser(app);
      const body = OwnerOnboardingSchema.parse(
        (await api(fresh, 'get', '/onboarding').expect(200)).body,
      );
      expect(body).toEqual({ started: false, doneAccountSteps: [], listings: [] });
    });

    it('saves a few valid fields at a time, so a half-done step survives', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile')
        .send({ kind: 'individual', firstName: 'Νίκος' })
        .expect(200);
      await api(user, 'patch', '/profile').send({ phone: '+30 210 000 0000' }).expect(200);
      const saved = OwnerProfileSchema.parse((await api(user, 'get', '/profile').expect(200)).body);
      expect(saved).toMatchObject({
        firstName: 'Νίκος',
        phone: '+30 210 000 0000',
        lastName: null,
      });
      const overview = OwnerOnboardingSchema.parse(
        (await api(user, 'get', '/onboarding').expect(200)).body,
      );
      expect(overview.started).toBe(true);
      expect(overview.doneAccountSteps).toEqual([]);
    });

    it('finishes the step once everything is there, and an empty field reopens it', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      const done = OwnerOnboardingSchema.parse(
        (await api(user, 'get', '/onboarding').expect(200)).body,
      );
      expect(done.doneAccountSteps).toEqual(['profile']);

      await api(user, 'patch', '/profile').send({ phone: '' }).expect(200);
      const reopened = OwnerOnboardingSchema.parse(
        (await api(user, 'get', '/onboarding').expect(200)).body,
      );
      expect(reopened.doneAccountSteps).toEqual([]);
    });

    it('refuses a control character, rather than failing on it in the database', async () => {
      const response = await api(owner, 'patch', '/profile')
        .send({ firstName: 'Μα\u0000ρία' })
        .expect(400);
      expect((response.body as { message: string[] }).message).toEqual(['invalid']);
    });

    it('sends a verified owner back to pending when who they are changes', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      await db
        .update(schema.ownerProfiles)
        .set({ verification: 'verified' })
        .where(eq(schema.ownerProfiles.userId, user.id));
      await api(user, 'patch', '/profile').send({ phone: '+30 210 000 0000' }).expect(200);
      expect((await ownerRow(user)).verification).toBe('verified');
      await api(user, 'patch', '/profile').send({ lastName: 'Άλλη' }).expect(200);
      expect((await ownerRow(user)).verification).toBe('pending');
    });

    it('drops what no longer applies when an owner changes kind', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      await api(user, 'put', '/profile/tax').send(tax).expect(200);
      expect((await ownerRow(user)).birthDateEncrypted).not.toBeNull();
      await api(user, 'patch', '/profile').send({ kind: 'business' }).expect(200);
      expect((await ownerRow(user)).birthDateEncrypted).toBeNull();
    });

    it('refuses invalid values with translation keys, and unknown fields outright', async () => {
      const bad = await api(owner, 'patch', '/profile').send({ phone: 'abc' }).expect(400);
      expect((bad.body as { message: string[] }).message).toEqual(['phoneInvalid']);
      await api(owner, 'patch', '/profile').send({ verification: 'verified' }).expect(400);
      await api(owner, 'patch', '/profile').send({ userId: stranger.id }).expect(400);
    });
  });

  describe('tax details', () => {
    it('needs the kind of owner first', async () => {
      const user = await signUpUser(app);
      const response = await api(user, 'put', '/profile/tax').send(tax).expect(409);
      expect((response.body as { code: string }).code).toBe('PROFILE_INCOMPLETE');
    });

    it('keeps them encrypted in the database and never returns them', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      const response = await api(user, 'put', '/profile/tax').send(tax).expect(200);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain(VALID_AFM);
      expect(body).not.toContain('1980');
      const { tax: summary } = OwnerProfileSchema.parse(response.body);
      expect(summary).toMatchObject({ taxIdEnding: '216', birthDateSaved: true });

      const [row] = await db
        .select()
        .from(schema.ownerProfiles)
        .where(eq(schema.ownerProfiles.userId, user.id));
      expect(row?.taxIdEncrypted).toMatch(/^v1\./);
      expect(JSON.stringify(row)).not.toContain(VALID_AFM);
      expect(JSON.stringify(row)).not.toContain('1980-02-03');
    });

    it('refuses a tax number that fails the Greek check digit', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      const response = await api(user, 'put', '/profile/tax')
        .send({ ...tax, taxId: '123456789' })
        .expect(400);
      expect((response.body as { message: string[] }).message).toEqual(['afmInvalid']);
    });

    it('needs a number the first time', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      const response = await api(user, 'put', '/profile/tax')
        .send({ taxCountry: 'GR' })
        .expect(400);
      expect((response.body as { message: string[] }).message).toEqual(['taxIdRequired']);
    });

    it('stores a Greek number as digits, and refuses letters around it', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      await api(user, 'put', '/profile/tax')
        .send({ taxCountry: 'GR', taxId: 'ABC094259216' })
        .expect(400);
      const saved = await api(user, 'put', '/profile/tax')
        .send({ ...tax, taxId: '094 259 216' })
        .expect(200);
      expect(OwnerProfileSchema.parse(saved.body).tax.taxIdEnding).toBe('216');
    });

    it('keeps saved values when a later save leaves them out', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      await api(user, 'put', '/profile/tax').send(tax).expect(200);
      const response = await api(user, 'put', '/profile/tax')
        .send({ taxCountry: 'GR' })
        .expect(200);
      expect(OwnerProfileSchema.parse(response.body).tax.taxIdEnding).toBe('216');
    });

    it('needs a new number when the country changes', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      await api(user, 'put', '/profile/tax').send(tax).expect(200);
      await api(user, 'put', '/profile/tax').send({ taxCountry: 'CY' }).expect(400);
      await api(user, 'put', '/profile/tax')
        .send({ taxCountry: 'CY', taxId: 'CY12345678L' })
        .expect(200);
    });

    it('asks a business for its registration number, not a birth date', async () => {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile')
        .send({
          ...profile,
          kind: 'business',
          firstName: '',
          lastName: '',
          legalName: 'Πάρκινγκ ΑΕ',
        })
        .expect(200);
      await api(user, 'put', '/profile/tax')
        .send({ taxCountry: 'GR', taxId: VALID_AFM })
        .expect(200);
      const before = OwnerOnboardingSchema.parse(
        (await api(user, 'get', '/onboarding').expect(200)).body,
      );
      expect(before.doneAccountSteps).toEqual(['profile']);
      await api(user, 'put', '/profile/tax')
        .send({ taxCountry: 'GR', registrationNumber: '123456701000' })
        .expect(200);
      const after = OwnerOnboardingSchema.parse(
        (await api(user, 'get', '/onboarding').expect(200)).body,
      );
      expect(after.doneAccountSteps).toEqual(['profile', 'tax']);
    });
  });

  describe('a listing’s steps', () => {
    it('starts empty, and Continue points at the first step', async () => {
      const id = await newListing(owner);
      const listing = await progress(owner, id);
      expect(listing).toMatchObject({ status: 'draft', doneSteps: [], nextStep: 'location' });
    });

    it('stays out of public search, however complete a draft gets', async () => {
      const id = await readyListing(owner);
      const tomorrow = addDays(zonedParts(new Date(), DEFAULT_TIME_ZONE).date, 1);
      const response = await request(app.getHttpServer())
        .get('/v1/parking/search')
        .query({
          ...HERE,
          start: zonedTimeToUtc(tomorrow, '10:00', DEFAULT_TIME_ZONE)?.toISOString(),
          end: zonedTimeToUtc(tomorrow, '12:00', DEFAULT_TIME_ZONE)?.toISOString(),
        })
        .expect(200);
      const { results } = ParkingSearchResponseSchema.parse(response.body);
      expect(results.map((r) => r.name)).not.toContain(location.name);
      expect((await progress(owner, id)).slug).toBeNull();
    });

    it('moves Continue along as each step is saved, in any order', async () => {
      const id = await newListing(owner);
      const after = async (expected: ListingStep | null, done: ListingStep[]) => {
        const state = await progress(owner, id);
        expect(state.nextStep).toBe(expected);
        expect(state.doneSteps).toEqual(done);
      };
      await api(owner, 'put', `/listings/${id}/hours`).send(hours).expect(200);
      await after('location', ['hours']);
      await api(owner, 'patch', `/listings/${id}/location`).send(location).expect(200);
      await after('spaces', ['location', 'hours']);
      await api(owner, 'put', `/listings/${id}/spaces`).send(spaces).expect(200);
      await after('prices', ['location', 'spaces', 'hours']);
    });

    it('saves half a location and finishes the step when the rest arrives', async () => {
      const id = await newListing(owner);
      await api(owner, 'patch', `/listings/${id}/location`).send({ name: 'Μισό' }).expect(200);
      expect((await progress(owner, id)).doneSteps).toEqual([]);
      await api(owner, 'patch', `/listings/${id}/location`)
        .send({ address: 'Οδός 1', areaId: 'syntagma', ...HERE })
        .expect(200);
      expect((await progress(owner, id)).doneSteps).toEqual(['location']);
    });

    it('can clear a pin', async () => {
      const id = await newListing(owner);
      await api(owner, 'patch', `/listings/${id}/location`).send(location).expect(200);
      await api(owner, 'patch', `/listings/${id}/location`)
        .send({ latitude: null, longitude: null })
        .expect(200);
      const saved = await api(owner, 'get', `/listings/${id}`).expect(200);
      expect(OwnerListingSchema.parse(saved.body).location.latitude).toBeNull();
    });

    it('refuses a pin outside Greece, and half a pin', async () => {
      const id = await newListing(owner);
      const abroad = await api(owner, 'patch', `/listings/${id}/location`)
        .send({ latitude: 52.5, longitude: 13.4 })
        .expect(400);
      expect((abroad.body as { message: string[] }).message).toEqual(['outsideGreece']);
      await api(owner, 'patch', `/listings/${id}/location`).send({ latitude: 37.9 }).expect(400);
    });

    it('refuses duplicate space labels, whatever their case', async () => {
      const id = await newListing(owner);
      const response = await api(owner, 'put', `/listings/${id}/spaces`)
        .send({
          spaces: [
            { label: 'a1', features: [], hourlyRateMinor: null },
            { label: 'A1', features: [], hourlyRateMinor: null },
          ],
        })
        .expect(400);
      expect((response.body as { message: string[] }).message).toEqual(['spaceLabelDuplicate']);
    });

    it('stores split opening hours, and refuses overlaps before the database does', async () => {
      const id = await newListing(owner);
      await api(owner, 'put', `/listings/${id}/hours`)
        .send({
          periods: [
            { weekday: 1, opens: '00:00', closes: '02:00' },
            { weekday: 1, opens: '08:00', closes: '24:00' },
          ],
        })
        .expect(200);
      const overlap = await api(owner, 'put', `/listings/${id}/hours`)
        .send({
          periods: [
            { weekday: 1, opens: '08:00', closes: '12:00' },
            { weekday: 1, opens: '11:00', closes: '14:00' },
          ],
        })
        .expect(400);
      expect((overlap.body as { message: string[] }).message).toEqual(['hoursOverlap']);
    });

    it('stores every kind of price and gives them back as saved', async () => {
      const id = await newListing(owner);
      await api(owner, 'put', `/listings/${id}/prices`).send(prices).expect(200);
      const saved = await api(owner, 'get', `/listings/${id}`).expect(200);
      expect(OwnerListingSchema.parse(saved.body).prices).toEqual(prices);
    });

    it('replaces prices on a second save, leaving nothing behind', async () => {
      const id = await newListing(owner);
      await api(owner, 'put', `/listings/${id}/prices`).send(prices).expect(200);
      await api(owner, 'put', `/listings/${id}/prices`)
        .send({
          ...prices,
          weekendRateMinor: null,
          night: null,
          datedPrices: [],
          longStayDiscounts: [],
        })
        .expect(200);
      const saved = await api(owner, 'get', `/listings/${id}`).expect(200);
      expect(OwnerListingSchema.parse(saved.body).prices).toMatchObject({
        weekendRateMinor: null,
        night: null,
        datedPrices: [],
        longStayDiscounts: [],
      });
    });

    it('refuses overlapping dated prices and a cap below the hourly rate', async () => {
      const id = await newListing(owner);
      const overlap = await api(owner, 'put', `/listings/${id}/prices`)
        .send({
          ...prices,
          datedPrices: [
            { label: null, startsOn: '2099-08-14', endsOn: '2099-08-16', rateMinor: 500 },
            { label: null, startsOn: '2099-08-16', endsOn: '2099-08-18', rateMinor: 600 },
          ],
        })
        .expect(400);
      expect((overlap.body as { message: string[] }).message).toEqual(['datedOverlap']);
      await api(owner, 'put', `/listings/${id}/prices`)
        .send({ ...prices, dailyMaxMinor: 100 })
        .expect(400);
    });
  });

  describe('photos', () => {
    it('stores a real photo and serves it publicly, cacheable for good', async () => {
      const id = await newListing(owner);
      const response = await upload(owner, id, await jpeg()).expect(201);
      const photo = OwnerPhotoSchema.parse(response.body);
      expect(photo).toMatchObject({ width: 1200, height: 800 });

      const served = await request(app.getHttpServer())
        .get(`/v1/media/photos/${photo.key}/480.webp`)
        .parse(bytes)
        .expect(200);
      expect(served.headers['content-type']).toContain('image/webp');
      expect(served.headers['cache-control']).toContain('immutable');
      expect((await sharp(served.body as Buffer).metadata()).width).toBe(480);
    });

    it('decides by the bytes, not what the request claims', async () => {
      const id = await newListing(owner);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
      const fake = await upload(owner, id, svg, 'image/jpeg').expect(400);
      expect((fake.body as { code: string }).code).toBe('PHOTO_UNREADABLE');
    });

    it('refuses a small photo, a duplicate and an oversized file', async () => {
      const id = await newListing(owner);
      const small = await upload(owner, id, await jpeg(400, 300)).expect(400);
      expect((small.body as { code: string }).code).toBe('PHOTO_TOO_SMALL');

      const file = await jpeg(1200, 800, 10);
      await upload(owner, id, file).expect(201);
      const twice = await upload(owner, id, file).expect(409);
      expect((twice.body as { code: string }).code).toBe('PHOTO_DUPLICATE');

      const huge = Buffer.alloc(PHOTO_LIMITS.maxBytes + 1);
      const tooBig = await upload(owner, id, huge).expect(413);
      expect((tooBig.body as { code: string }).code).toBe('FILE_TOO_LARGE');
    });

    it('caps a listing’s photos', async () => {
      const id = await newListing(owner);
      for (let r = 0; r < PHOTO_LIMITS.maxPerListing; r++) {
        await upload(owner, id, await jpeg(1000, 700, r * 20)).expect(201);
      }
      const response = await upload(owner, id, await jpeg(1000, 700, 250)).expect(409);
      expect((response.body as { code: string }).code).toBe('TOO_MANY_PHOTOS');
    });

    it('orders photos, keeps descriptions, and the first is the cover', async () => {
      const id = await newListing(owner);
      const first = OwnerPhotoSchema.parse(
        (await upload(owner, id, await jpeg(1000, 700, 30)).expect(201)).body,
      );
      const second = OwnerPhotoSchema.parse(
        (await upload(owner, id, await jpeg(1000, 700, 60)).expect(201)).body,
      );

      await api(owner, 'put', `/listings/${id}/photos/order`)
        .send({ ids: [second.id, first.id] })
        .expect(204);
      await api(owner, 'patch', `/listings/${id}/photos/${second.id}`)
        .send({ alt: 'Η είσοδος' })
        .expect(204);

      const saved = OwnerListingSchema.parse(
        (await api(owner, 'get', `/listings/${id}`).expect(200)).body,
      );
      expect(saved.photos.map((p) => p.id)).toEqual([second.id, first.id]);
      expect(saved.photos[0]?.alt).toBe('Η είσοδος');
      expect(saved.progress.coverPhoto?.key).toBe(second.key);
    });

    it('refuses an order that does not match what is there', async () => {
      const id = await newListing(owner);
      const photo = OwnerPhotoSchema.parse(
        (await upload(owner, id, await jpeg(1000, 700, 90)).expect(201)).body,
      );
      await api(owner, 'put', `/listings/${id}/photos/order`)
        .send({ ids: [photo.id, randomUUID()] })
        .expect(409);
      await api(owner, 'put', `/listings/${id}/photos/order`)
        .send({ ids: [randomUUID()] })
        .expect(409);
    });

    it('removes a photo and reopens the step', async () => {
      const id = await newListing(owner);
      const photo = OwnerPhotoSchema.parse(
        (await upload(owner, id, await jpeg(1000, 700, 111)).expect(201)).body,
      );
      expect((await progress(owner, id)).doneSteps).toContain('photos');
      await api(owner, 'delete', `/listings/${id}/photos/${photo.id}`).expect(204);
      expect((await progress(owner, id)).doneSteps).not.toContain('photos');
      await request(app.getHttpServer()).get(`/v1/media/photos/${photo.key}/480.webp`).expect(404);
    });

    it('caps a listing’s documents', async () => {
      const user = await signUpUser(app);
      const id = await newListing(user);
      for (let i = 0; i < PROOF_LIMITS.maxPerListing; i++) {
        await uploadProof(user, id, PDF).expect(201);
      }
      const response = await uploadProof(user, id, PDF).expect(409);
      expect((response.body as { code: string }).code).toBe('TOO_MANY_PROOFS');
    });

    it('limits how fast an owner can upload', async () => {
      const user = await signUpUser(app);
      const id = await newListing(user);
      const answers: number[] = [];
      for (let i = 0; i <= 30; i++) {
        answers.push((await upload(user, id, Buffer.from('not an image'))).status);
      }
      expect(answers.slice(0, 30).every((status) => status === 400)).toBe(true);
      expect(answers.at(-1)).toBe(429);
    });

    it('finds nothing with a malformed photo or proof id', async () => {
      const id = await newListing(owner);
      await api(owner, 'patch', `/listings/${id}/photos/not-a-uuid`).send({ alt: 'x' }).expect(404);
      await api(owner, 'delete', `/listings/${id}/photos/not-a-uuid`).expect(404);
      await api(owner, 'get', `/listings/${id}/proofs/not-a-uuid`).expect(404);
    });

    it('works with an id in capitals, the same as any other', async () => {
      const id = await newListing(owner);
      await uploadProof(owner, id.toUpperCase(), PDF).expect(201);
    });

    it('keeps a file that another listing still shows', async () => {
      const file = await jpeg(1000, 700, 133);
      const one = await newListing(owner);
      const two = await newListing(owner);
      const first = OwnerPhotoSchema.parse((await upload(owner, one, file).expect(201)).body);
      await upload(owner, two, file).expect(201);
      await api(owner, 'delete', `/listings/${one}/photos/${first.id}`).expect(204);
      await request(app.getHttpServer()).get(`/v1/media/photos/${first.key}/480.webp`).expect(200);
    });

    it('never reaches outside photos, even with an encoded path', async () => {
      await request(app.getHttpServer())
        .get('/v1/media/photos/..%2F..%2Fproofs%2Fx/480.webp')
        .expect(404);
    });

    it('caches a missing photo briefly, never for a year', async () => {
      const missing = await request(app.getHttpServer())
        .get(`/v1/media/photos/${'a'.repeat(32)}/480.webp`)
        .expect(404);
      expect(missing.headers['cache-control']).toBe('public, max-age=60');
      const refused = await request(app.getHttpServer())
        .get('/v1/media/photos/nonsense/480.webp')
        .expect(404);
      expect(refused.headers['cache-control'] ?? '').not.toContain('immutable');
    });
  });

  describe('proof of the right to rent', () => {
    it('stores a PDF that only its owner can download, as an attachment', async () => {
      const id = await newListing(owner);
      const proof = OwnerProofSchema.parse((await uploadProof(owner, id, PDF).expect(201)).body);
      expect(proof).toMatchObject({ kind: 'lease', contentType: 'application/pdf' });

      const download = await api(owner, 'get', `/listings/${id}/proofs/${proof.id}`)
        .parse(bytes)
        .expect(200);
      expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);
      expect(download.headers['content-type']).toContain('application/pdf');
      expect(download.headers['content-disposition']).toMatch(/^attachment/);
      expect(download.headers['cache-control']).toContain('no-store');
      expect(download.headers['x-content-type-options']).toBe('nosniff');
      expect(download.headers['content-security-policy']).toContain('sandbox');
    });

    it('sets the type from the file, not from its name', async () => {
      const id = await newListing(owner);
      const scan = await api(owner, 'post', `/listings/${id}/proofs`)
        .query({ kind: 'lease' })
        .set('X-File-Name', 'scan.html')
        .set('Content-Type', 'text/html')
        .send(await jpeg())
        .expect(201);
      const proof = OwnerProofSchema.parse(scan.body);
      expect(proof.fileName).toBe('scan.jpg');
      const download = await api(owner, 'get', `/listings/${id}/proofs/${proof.id}`).parse(bytes);
      expect(download.headers['content-type']).toContain('image/jpeg');
    });

    it('removes the stored file with the document', async () => {
      const id = await newListing(owner);
      const proof = OwnerProofSchema.parse((await uploadProof(owner, id, PDF).expect(201)).body);
      const key = `proofs/${id}/${proof.id}`;
      expect(await store.get(key)).not.toBeNull();
      await api(owner, 'delete', `/listings/${id}/proofs/${proof.id}`).expect(204);
      expect(await store.get(key)).toBeNull();
    });

    it('takes location data out of a scanned document', async () => {
      const id = await newListing(owner);
      const scan = await sharp({
        create: { width: 800, height: 1100, channels: 3, background: '#eee' },
      })
        .withExif({ IFD3: { GPSLatitude: '37/1' } })
        .jpeg()
        .toBuffer();
      expect((await sharp(scan).metadata()).exif).toBeDefined();
      const proof = OwnerProofSchema.parse((await uploadProof(owner, id, scan).expect(201)).body);
      const download = await api(owner, 'get', `/listings/${id}/proofs/${proof.id}`).parse(bytes);
      expect((await sharp(download.body as Buffer).metadata()).exif).toBeUndefined();
    });

    it('refuses a corrupt file with a JPEG header', async () => {
      const id = await newListing(owner);
      const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500)]);
      const response = await uploadProof(owner, id, corrupt).expect(400);
      expect((response.body as { code: string }).code).toBe('FILE_TYPE_NOT_ALLOWED');
    });

    it('needs a session to download', async () => {
      const id = await newListing(owner);
      const proof = OwnerProofSchema.parse((await uploadProof(owner, id, PDF).expect(201)).body);
      await api(null, 'get', `/listings/${id}/proofs/${proof.id}`).expect(401);
    });

    it('decides the type by the bytes, and refuses anything else', async () => {
      const id = await newListing(owner);
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      const refused = await uploadProof(owner, id, html).expect(400);
      expect((refused.body as { code: string }).code).toBe('FILE_TYPE_NOT_ALLOWED');
      const scan = await uploadProof(owner, id, await jpeg(), 'application/pdf').expect(201);
      expect(OwnerProofSchema.parse(scan.body).contentType).toBe('image/jpeg');
    });

    it('cleans the name it was given', async () => {
      const id = await newListing(owner);
      const response = await api(owner, 'post', `/listings/${id}/proofs`)
        .query({ kind: 'titleDeed' })
        .set('X-File-Name', encodeURIComponent('..\\..\\evil"\r\nX-Injected: 1\u202e.exe'))
        .set('Content-Type', 'application/pdf')
        .send(PDF)
        .expect(201);
      const { fileName } = OwnerProofSchema.parse(response.body);
      expect(fileName).not.toMatch(/[\\/"\r\n\u202e]/);
      expect(fileName).toMatch(/\.pdf$/); // what it really is, whatever it was called
    });

    it('removes a proof and reopens the step', async () => {
      const id = await newListing(owner);
      const proof = OwnerProofSchema.parse((await uploadProof(owner, id, PDF).expect(201)).body);
      await api(owner, 'delete', `/listings/${id}/proofs/${proof.id}`).expect(204);
      expect((await progress(owner, id)).doneSteps).not.toContain('proof');
      await api(owner, 'get', `/listings/${id}/proofs/${proof.id}`).expect(404);
    });

    it('stores the land registration number', async () => {
      const id = await newListing(owner);
      await api(owner, 'patch', `/listings/${id}/proof-details`)
        .send({ landRegistrationNumber: '050681726008' })
        .expect(200);
      const saved = OwnerListingSchema.parse(
        (await api(owner, 'get', `/listings/${id}`).expect(200)).body,
      );
      expect(saved.landRegistrationNumber).toBe('050681726008');
    });
  });

  describe('the database’s own rules', () => {
    it('refuses to take an incomplete listing past draft, whoever asks', async () => {
      const id = await newListing(owner);
      await expect(
        db
          .update(schema.parkingLocations)
          .set({ status: 'published' })
          .where(eq(schema.parkingLocations.id, id)),
      ).rejects.toThrow();
    });

    it('refuses overlapping dated prices, whatever the API lets through', async () => {
      const id = await newListing(owner);
      const row = (startsOn: string, endsOn: string) => ({
        locationId: id,
        kind: 'dated' as const,
        hourlyRateMinor: 500,
        startsOn,
        endsOn,
      });
      await db.insert(schema.parkingPriceRules).values(row('2099-01-01', '2099-01-03'));
      await expect(
        db.insert(schema.parkingPriceRules).values(row('2099-01-03', '2099-01-05')),
      ).rejects.toThrow();
    });

    it('refuses a second weekend price on one listing', async () => {
      const id = await newListing(owner);
      const row = { locationId: id, kind: 'weekend' as const, hourlyRateMinor: 500 };
      await db.insert(schema.parkingPriceRules).values(row);
      await expect(db.insert(schema.parkingPriceRules).values(row)).rejects.toThrow();
    });
  });

  describe('sending for review', () => {
    let submitter: TestUser;

    beforeAll(async () => {
      submitter = await signUpUser(app);
      await api(submitter, 'patch', '/profile').send(profile).expect(200);
      await api(submitter, 'put', '/profile/tax').send(tax).expect(200);
    });

    it('needs the confirmation ticked', async () => {
      const id = await readyListing(submitter);
      await api(submitter, 'post', `/listings/${id}/submit`).send({}).expect(400);
      await api(submitter, 'post', `/listings/${id}/submit`).send({ confirmed: false }).expect(400);
    });

    it('names what is missing', async () => {
      const id = await newListing(submitter);
      await api(submitter, 'patch', `/listings/${id}/location`).send(location).expect(200);
      const response = await api(submitter, 'post', `/listings/${id}/submit`)
        .send({ confirmed: true })
        .expect(409);
      expect(response.body).toMatchObject({
        code: 'LISTING_INCOMPLETE',
        missing: ['spaces', 'hours', 'prices', 'photos', 'proof'],
      });
    });

    it('needs the account steps too', async () => {
      const id = await readyListing(owner); // this owner never finished the account steps
      const response = await api(owner, 'post', `/listings/${id}/submit`)
        .send({ confirmed: true })
        .expect(409);
      expect((response.body as { missing: string[] }).missing).toContain('profile');
    });

    it('locks the listing, gives it a real URL and marks the owner as pending', async () => {
      const id = await readyListing(submitter);
      const response = await api(submitter, 'post', `/listings/${id}/submit`)
        .send({ confirmed: true })
        .expect(200);
      const state = OwnerListingProgressSchema.parse(response.body);
      expect(state).toMatchObject({ status: 'in_review', nextStep: null });
      expect(state.slug).toMatch(/^gkaraz|^garaz/);
      expect(state.submittedAt).not.toBeNull();

      const editing = await api(submitter, 'patch', `/listings/${id}/location`)
        .send({ name: 'Άλλο' })
        .expect(409);
      expect((editing.body as { code: string }).code).toBe('LISTING_LOCKED');
      await upload(submitter, id, await jpeg(1000, 700, 200)).expect(409);
      await api(submitter, 'delete', `/listings/${id}`).expect(409);

      const profileNow = OwnerProfileSchema.parse(
        (await api(submitter, 'get', '/profile').expect(200)).body,
      );
      expect(profileNow.verification).toBe('pending');
    });

    it('takes one of two submissions at once, without an error for the other’s data', async () => {
      const id = await readyListing(submitter);
      const answers = await Promise.all([
        api(submitter, 'post', `/listings/${id}/submit`).send({ confirmed: true }),
        api(submitter, 'post', `/listings/${id}/submit`).send({ confirmed: true }),
      ]);
      expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    });

    it('gets both of two listings with one name through at once', async () => {
      const one = await readyListing(submitter);
      const two = await readyListing(submitter);
      const answers = await Promise.all([
        api(submitter, 'post', `/listings/${one}/submit`).send({ confirmed: true }),
        api(submitter, 'post', `/listings/${two}/submit`).send({ confirmed: true }),
      ]);
      expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    });

    it('never leaves a listing with staff without what it was checked for', async () => {
      for (let round = 0; round < 5; round++) {
        const id = await readyListing(submitter);
        const { photos } = OwnerListingSchema.parse(
          (await api(submitter, 'get', `/listings/${id}`).expect(200)).body,
        );
        await Promise.all([
          api(submitter, 'post', `/listings/${id}/submit`).send({ confirmed: true }),
          api(submitter, 'delete', `/listings/${id}/photos/${photos[0]?.id ?? ''}`),
        ]);
        const after = OwnerListingSchema.parse(
          (await api(submitter, 'get', `/listings/${id}`).expect(200)).body,
        );
        if (after.status === 'in_review') expect(after.photos).toHaveLength(1);
        else expect(after.status).toBe('draft');
      }
    });

    it('gives two listings with one name different URLs', async () => {
      const one = await readyListing(submitter);
      const two = await readyListing(submitter);
      const first = await api(submitter, 'post', `/listings/${one}/submit`)
        .send({ confirmed: true })
        .expect(200);
      const second = await api(submitter, 'post', `/listings/${two}/submit`)
        .send({ confirmed: true })
        .expect(200);
      expect(OwnerListingProgressSchema.parse(first.body).slug).not.toBe(
        OwnerListingProgressSchema.parse(second.body).slug,
      );
    });

    it('takes a listing sent back through a fix and a second submission', async () => {
      const id = await readyListing(submitter);
      await api(submitter, 'post', `/listings/${id}/submit`).send({ confirmed: true }).expect(200);
      // Staff, by hand, until the admin screen exists.
      await db
        .update(schema.parkingLocations)
        .set({ status: 'changes_requested', reviewNote: 'Χρειάζεται καλύτερη φωτογραφία.' })
        .where(eq(schema.parkingLocations.id, id));

      const sentBack = await progress(submitter, id);
      expect(sentBack).toMatchObject({
        status: 'changes_requested',
        nextStep: 'review',
        reviewNote: 'Χρειάζεται καλύτερη φωτογραφία.',
      });
      await upload(submitter, id, await jpeg(1000, 700, 222)).expect(201);
      await api(submitter, 'post', `/listings/${id}/submit`).send({ confirmed: true }).expect(200);
      expect((await progress(submitter, id)).reviewNote).toBeNull();
    });

    it('can delete a draft, with its files, but not one past that', async () => {
      const id = await readyListing(submitter);
      const { photos } = OwnerListingSchema.parse(
        (await api(submitter, 'get', `/listings/${id}`).expect(200)).body,
      );
      await api(submitter, 'delete', `/listings/${id}`).expect(204);
      await api(submitter, 'get', `/listings/${id}`).expect(404);
      await request(app.getHttpServer())
        .get(`/v1/media/photos/${photos[0]?.key ?? ''}/480.webp`)
        .expect(404);
    });

    it('prices a stay with the listing’s rules, in search and on its page', async () => {
      const id = await readyListing(submitter);
      const done = await api(submitter, 'post', `/listings/${id}/submit`)
        .send({ confirmed: true })
        .expect(200);
      const { slug } = OwnerListingProgressSchema.parse(done.body);
      await db
        .update(schema.parkingLocations)
        .set({ status: 'published' })
        .where(eq(schema.parkingLocations.id, id));

      // The next Saturday, 10:00 to 12:00 in Athens: the weekend price, 3.00 an hour.
      const today = zonedParts(new Date(), DEFAULT_TIME_ZONE);
      const saturday = addDays(today.date, ((6 - today.isoWeekday + 7) % 7 || 7) + 7);
      const window = {
        start: zonedTimeToUtc(saturday, '10:00', DEFAULT_TIME_ZONE)?.toISOString(),
        end: zonedTimeToUtc(saturday, '12:00', DEFAULT_TIME_ZONE)?.toISOString(),
      };
      const page = await request(app.getHttpServer())
        .get(`/v1/parking/${slug ?? ''}`)
        .query(window)
        .expect(200);
      const listing = ParkingListingDetailSchema.parse(page.body);
      expect(listing.availability?.total.amountMinor).toBe(600);
      // A2's own rate is twice the listing's, so its weekend price is too.
      expect(listing.spaces.map((space) => space.total?.amountMinor)).toEqual([600, 1200]);

      const found = await request(app.getHttpServer())
        .get('/v1/parking/search')
        .query({ ...HERE, ...window })
        .expect(200);
      const result = ParkingSearchResponseSchema.parse(found.body).results.find(
        (item) => item.slug === slug,
      );
      expect(result?.total.amountMinor).toBe(600);
      expect(result?.spacePricesVary).toBe(true);

      await db
        .update(schema.parkingLocations)
        .set({ status: 'draft', slug: `draft-${id}` })
        .where(eq(schema.parkingLocations.id, id));
    });

    it('shows a published listing’s photos, rules and per-space prices to anyone', async () => {
      const id = await readyListing(submitter);
      const done = await api(submitter, 'post', `/listings/${id}/submit`)
        .send({ confirmed: true })
        .expect(200);
      const { slug } = OwnerListingProgressSchema.parse(done.body);
      await db
        .update(schema.parkingLocations)
        .set({ status: 'published' })
        .where(eq(schema.parkingLocations.id, id));

      const response = await request(app.getHttpServer())
        .get(`/v1/parking/${slug ?? ''}`)
        .expect(200);
      const listing = ParkingListingDetailSchema.parse(response.body);
      expect(listing.photos).toHaveLength(1);
      expect(listing.coverPhoto?.key).toBe(listing.photos[0]?.key);
      expect(listing.spacePricesVary).toBe(true);
      expect(listing.hourlyRate.amountMinor).toBe(200);
      expect(listing.spaces.map((s) => s.hourlyRate.amountMinor)).toEqual([200, 400]);
      expect(listing.priceRules).toMatchObject({
        weekendRate: { amountMinor: 300 },
        night: { from: '22:00', to: '06:00' },
        longStay: [{ minDays: 7, percent: 10 }],
      });
      expect(listing.cancellationPolicy).toBe('oneDay');
      // Nothing about the owner reaches the public.
      expect(JSON.stringify(response.body)).not.toContain('Παπαδοπούλου');
      expect(JSON.stringify(response.body)).not.toContain('μισθωτήριο');
    });
  });

  describe('emails', () => {
    const drain = async () => {
      const due = await claimDueEmails(db, 500);
      await Promise.all(due.map((email) => markEmailSent(db, email.id)));
      return due;
    };

    async function submitted(): Promise<{ user: TestUser; id: string }> {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      await api(user, 'put', '/profile/tax').send(tax).expect(200);
      const id = await readyListing(user);
      await api(user, 'post', `/listings/${id}/submit`).send({ confirmed: true }).expect(200);
      return { user, id };
    }
    const toUser = (emails: Awaited<ReturnType<typeof drain>>, user: TestUser) =>
      emails.filter((email) => email.to === user.email).map((email) => email.kind);

    it('tells the owner once when a listing is received', async () => {
      const { user } = await submitted();
      await enqueueListingStatusEmails(db);
      await enqueueListingStatusEmails(db); // a second sweep finds nothing new
      expect(toUser(await drain(), user)).toEqual(['listing-submitted']);
    });

    it('tells the owner when staff change the status by hand', async () => {
      const { user, id } = await submitted();
      await enqueueListingStatusEmails(db);
      await drain();
      await db
        .update(schema.parkingLocations)
        .set({ status: 'changes_requested', reviewNote: 'Μια αλλαγή.' })
        .where(eq(schema.parkingLocations.id, id));
      await enqueueListingStatusEmails(db);
      expect(toUser(await drain(), user)).toEqual(['listing-changes-requested']);

      await db
        .update(schema.parkingLocations)
        .set({ status: 'published' })
        .where(eq(schema.parkingLocations.id, id));
      await enqueueListingStatusEmails(db);
      expect(toUser(await drain(), user)).toEqual(['listing-approved']);
    });

    it('emails again for a second round of review', async () => {
      const { user, id } = await submitted();
      // The key has second precision: an earlier first submission stands in for waiting one out.
      await db
        .update(schema.parkingLocations)
        .set({ submittedAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.parkingLocations.id, id));
      await enqueueListingStatusEmails(db);
      await drain();
      await db
        .update(schema.parkingLocations)
        .set({ status: 'changes_requested' })
        .where(eq(schema.parkingLocations.id, id));
      await enqueueListingStatusEmails(db);
      await drain();
      await api(user, 'post', `/listings/${id}/submit`).send({ confirmed: true }).expect(200);
      await enqueueListingStatusEmails(db);
      expect(toUser(await drain(), user)).toEqual(['listing-submitted']);
    });

    it('puts the listing’s name in the email', async () => {
      const { user } = await submitted();
      await enqueueListingStatusEmails(db);
      const mine = (await drain()).find((email) => email.to === user.email);
      expect(mine?.payload.listingName).toBe(location.name);
    });

    it('reminds an owner who went quiet, once, and nobody else', async () => {
      const quiet = await signUpUser(app);
      await api(quiet, 'patch', '/profile').send({ firstName: 'Ήσυχος' }).expect(200);
      const active = await signUpUser(app);
      await api(active, 'patch', '/profile').send({ firstName: 'Ενεργός' }).expect(200);
      const reviewing = await submitted();

      const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const stale = [quiet.id, reviewing.user.id];
      for (const userId of stale) {
        await db
          .update(schema.ownerProfiles)
          .set({ updatedAt: past })
          .where(eq(schema.ownerProfiles.userId, userId));
      }
      const before = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await enqueueOnboardingReminders(db, before);
      await enqueueOnboardingReminders(db, before);

      const due = await drain();
      expect(toUser(due, quiet)).toEqual(['onboarding-reminder']);
      expect(toUser(due, active)).toEqual([]);
      expect(toUser(due, reviewing.user)).not.toContain('onboarding-reminder');
    });

    it('leaves out an owner still working on a listing', async () => {
      const user = await signUpUser(app);
      await newListing(user); // touched just now
      await db
        .update(schema.ownerProfiles)
        .set({ updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) })
        .where(eq(schema.ownerProfiles.userId, user.id));
      await enqueueOnboardingReminders(db, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
      expect(toUser(await drain(), user)).toEqual([]);
    });

    describe('when sending fails', () => {
      async function queued(): Promise<ClaimedEmail> {
        await drain();
        const { user } = await submitted();
        await enqueueListingStatusEmails(db);
        const [email] = (await claimDueEmails(db, 500)).filter((row) => row.to === user.email);
        if (!email) throw new Error('Nothing queued');
        return email;
      }
      const stored = async (id: string) => {
        const [row] = await db
          .select()
          .from(schema.emailOutbox)
          .where(eq(schema.emailOutbox.id, id));
        if (!row) throw new Error('No such email');
        return row;
      };

      it('tries again after a wait, not before', async () => {
        const email = await queued();
        expect(await markEmailFailed(db, email, 'Resend answered 500')).toBe(false);
        const row = await stored(email.id);
        expect(row.status).toBe('pending');
        expect(row.lastError).toBe('Resend answered 500');
        expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
        expect((await claimDueEmails(db, 500)).map((due) => due.id)).not.toContain(email.id);

        await db
          .update(schema.emailOutbox)
          .set({ nextAttemptAt: new Date(Date.now() - 1000) })
          .where(eq(schema.emailOutbox.id, email.id));
        const again = (await claimDueEmails(db, 500)).find((due) => due.id === email.id);
        expect(again?.attempts).toBe(2);
        if (again) await markEmailSent(db, again.id);
      });

      it('gives up after the last attempt, and never claims it again', async () => {
        const email = await queued();
        const last = { ...email, attempts: MAX_EMAIL_ATTEMPTS };
        expect(await markEmailFailed(db, last, 'x'.repeat(500))).toBe(true);
        const row = await stored(email.id);
        expect(row.status).toBe('failed');
        expect(row.lastError).toHaveLength(200);
        await db
          .update(schema.emailOutbox)
          .set({ nextAttemptAt: new Date(Date.now() - 1000) })
          .where(eq(schema.emailOutbox.id, email.id));
        expect((await claimDueEmails(db, 500)).map((due) => due.id)).not.toContain(email.id);
      });

      it('keeps trying for about a day, so an outage doesn’t lose emails', () => {
        const minutes = Array.from({ length: MAX_EMAIL_ATTEMPTS - 1 }, (_, i) => 2 ** (i + 1));
        expect(minutes.reduce((sum, wait) => sum + wait, 0)).toBeGreaterThan(24 * 60);
      });

      it('takes back an email whose worker died', async () => {
        const email = await queued();
        await db
          .update(schema.emailOutbox)
          .set({ nextAttemptAt: new Date(Date.now() - 1000) })
          .where(eq(schema.emailOutbox.id, email.id));
        const reclaimed = (await claimDueEmails(db, 500)).map((due) => due.id);
        expect(reclaimed).toContain(email.id);
        await markEmailSent(db, email.id);
      });

      it('counts only what is still waiting, and purges what was sent long ago', async () => {
        const email = await queued();
        const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
        const future = new Date(Date.now() + 60_000);
        await db
          .update(schema.emailOutbox)
          .set({ createdAt: old })
          .where(eq(schema.emailOutbox.id, email.id));
        expect(await countOverdueEmails(db, future)).toBeGreaterThan(0);
        await db
          .update(schema.emailOutbox)
          .set({ status: 'sent', sentAt: old })
          .where(eq(schema.emailOutbox.id, email.id));
        await purgeSentEmails(db, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
        expect(
          await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.id, email.id)),
        ).toEqual([]);
      });
    });

    it('never gives two workers the same email', async () => {
      const { user } = await submitted();
      await enqueueListingStatusEmails(db);
      const [first, second] = await Promise.all([claimDueEmails(db, 500), claimDueEmails(db, 500)]);
      const ids = [...first, ...second].map((email) => email.id);
      expect(new Set(ids).size).toBe(ids.length);
      await Promise.all([...first, ...second].map((email) => markEmailSent(db, email.id)));
      expect(toUser([...first, ...second], user)).toEqual(['listing-submitted']);
    });
  });
});
