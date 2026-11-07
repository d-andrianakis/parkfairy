import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  addDays,
  DEFAULT_TIME_ZONE,
  HOURS_EXCEPTIONS_MAX,
  OwnerHoursCopySchema,
  OwnerHoursExceptionsCopySchema,
  OwnerHoursExceptionsSchema,
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
  deleteEndedHoursExceptions,
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
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

  describe('closures and special hours', () => {
    let keeper: TestUser;
    const today = () => zonedParts(new Date(), DEFAULT_TIME_ZONE).date;
    const inDays = (days: number) => addDays(today(), days);
    const closed = (startsOn: string, endsOn = startsOn, label: string | null = null) => ({
      label,
      startsOn,
      endsOn,
      hours: null,
      closedHours: null,
    });
    const save = (user: TestUser, id: string, exceptions: object[]) =>
      api(user, 'put', `/listings/${id}/hours-exceptions`).send({ exceptions });
    const at = (day: string, from: string, to: string) => ({
      start: zonedTimeToUtc(day, from, DEFAULT_TIME_ZONE)?.toISOString(),
      end: zonedTimeToUtc(day, to, DEFAULT_TIME_ZONE)?.toISOString(),
    });

    const live: string[] = [];

    /** Sent in, then put live by hand, as staff do until the admin screen exists. */
    async function liveListing(): Promise<{ id: string; slug: string }> {
      const id = await readyListing(keeper);
      live.push(id);
      const done = await api(keeper, 'post', `/listings/${id}/submit`)
        .send({ confirmed: true })
        .expect(200);
      await db
        .update(schema.parkingLocations)
        .set({ status: 'published' })
        .where(eq(schema.parkingLocations.id, id));
      return { id, slug: OwnerListingProgressSchema.parse(done.body).slug ?? '' };
    }

    async function publishAgain(id: string) {
      await db
        .update(schema.parkingLocations)
        .set({ status: 'published' })
        .where(eq(schema.parkingLocations.id, id));
    }

    /** Back out of the public catalogue, so other tests' searches never meet it. */
    async function unpublish(id: string) {
      await db
        .update(schema.parkingLocations)
        .set({ status: 'draft', slug: `draft-${id}` })
        .where(eq(schema.parkingLocations.id, id));
    }

    beforeAll(async () => {
      keeper = await signUpUser(app);
      await api(keeper, 'patch', '/profile').send(profile).expect(200);
      await api(keeper, 'put', '/profile/tax').send(tax).expect(200);
    });

    afterEach(async () => {
      for (const id of live.splice(0)) await unpublish(id);
    });

    it('keeps what is saved, soonest first, with the owner’s note', async () => {
      const id = await newListing(keeper);
      const eve = {
        label: 'Παραμονή',
        startsOn: inDays(40),
        endsOn: inDays(40),
        hours: { opens: '08:00', closes: '14:00' },
        closedHours: null,
      };
      const response = await save(keeper, id, [
        closed(inDays(41), inDays(42), 'Χριστούγεννα'),
        eve,
      ]).expect(200);
      const expected = [eve, closed(inDays(41), inDays(42), 'Χριστούγεννα')];
      expect(OwnerHoursExceptionsSchema.parse(response.body).exceptions).toEqual(expected);
      const listing = OwnerListingSchema.parse(
        (await api(keeper, 'get', `/listings/${id}`).expect(200)).body,
      );
      expect(listing.hoursExceptions).toEqual(expected);
      // Optional: nothing about the steps moves.
      expect(listing.progress.doneSteps).toEqual([]);
    });

    it('replaces the whole list, and an empty one clears it', async () => {
      const id = await newListing(keeper);
      await save(keeper, id, [closed(inDays(10)), closed(inDays(12))]).expect(200);
      await save(keeper, id, [closed(inDays(11))]).expect(200);
      const kept = await db
        .select()
        .from(schema.parkingHoursExceptions)
        .where(eq(schema.parkingHoursExceptions.locationId, id));
      expect(kept.map((row) => row.startsOn)).toEqual([inDays(11)]);
      const cleared = await save(keeper, id, []).expect(200);
      expect(OwnerHoursExceptionsSchema.parse(cleared.body).exceptions).toEqual([]);
    });

    it('lets nobody else read or change them', async () => {
      const id = await newListing(keeper);
      await save(keeper, id, [closed(inDays(5), inDays(5), 'Ιδιωτικό')]).expect(200);
      const theirs = await save(stranger, id, []).expect(404);
      expect((theirs.body as { code: string }).code).toBe('LISTING_NOT_FOUND');
      await save(stranger, 'not-a-uuid', []).expect(404);
      const listing = OwnerListingSchema.parse(
        (await api(keeper, 'get', `/listings/${id}`).expect(200)).body,
      );
      expect(listing.hoursExceptions).toHaveLength(1);
    });

    it('refuses what can’t be meant, naming the entry and the field', async () => {
      const id = await newListing(keeper);
      const overlap = await save(keeper, id, [
        closed(inDays(10), inDays(12)),
        closed(inDays(12)),
      ]).expect(400);
      expect(overlap.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: ['exceptionOverlap'],
      });
      const ended = await save(keeper, id, [closed(inDays(-1))]).expect(400);
      expect((ended.body as { message: string[] }).message).toEqual(['dateInPast']);
      await save(keeper, id, [closed(inDays(400))]).expect(400);
      await save(keeper, id, [
        { ...closed(inDays(3)), hours: { opens: '14:00', closes: '08:00' } },
      ]).expect(400);
      await api(keeper, 'put', `/listings/${id}/hours-exceptions`)
        .send({ exceptions: [], locationId: randomUUID() })
        .expect(400);
    });

    it('stays open to the owner while staff have the listing and once it is live', async () => {
      const id = await readyListing(keeper);
      await api(keeper, 'post', `/listings/${id}/submit`).send({ confirmed: true }).expect(200);
      await save(keeper, id, [closed(inDays(3))]).expect(200);
      // The steps themselves stay locked.
      await api(keeper, 'put', `/listings/${id}/hours`).send(hours).expect(409);

      for (const status of ['published', 'suspended', 'changes_requested'] as const) {
        await db
          .update(schema.parkingLocations)
          .set({ status })
          .where(eq(schema.parkingLocations.id, id));
        await save(keeper, id, [closed(inDays(4))]).expect(200);
      }
      // No new review: the status is where staff left it.
      expect((await progress(keeper, id)).status).toBe('changes_requested');
      await unpublish(id);
    });

    it('takes a closed day out of search and says so on the listing page', async () => {
      const { id, slug } = await liveListing();
      const shut = inDays(20);
      const short = inDays(21);
      await save(keeper, id, [
        closed(shut, shut, 'Απογραφή'),
        {
          label: null,
          startsOn: short,
          endsOn: short,
          hours: { opens: '08:00', closes: '14:00' },
          closedHours: null,
        },
      ]).expect(200);

      const found = async (window: object) => {
        const response = await request(app.getHttpServer())
          .get('/v1/parking/search')
          .query({ ...HERE, ...window })
          .expect(200);
        return ParkingSearchResponseSchema.parse(response.body).results.some(
          (result) => result.slug === slug,
        );
      };
      const page = async (window: object) =>
        ParkingListingDetailSchema.parse(
          (await request(app.getHttpServer()).get(`/v1/parking/${slug}`).query(window).expect(200))
            .body,
        );

      expect(await found(at(shut, '10:00', '12:00'))).toBe(false);
      // 22:30 the evening before in UTC: the closed day is still the one the stay is on.
      expect(await found(at(shut, '00:30', '01:30'))).toBe(false);
      expect(await found(at(inDays(19), '10:00', '12:00'))).toBe(true);
      expect(await found(at(inDays(19), '22:30', '23:30'))).toBe(true);
      expect(await found(at(short, '09:00', '13:00'))).toBe(true);
      expect(await found(at(short, '13:00', '15:00'))).toBe(false);
      // A stay of several days fails on the one closed day in the middle.
      expect(
        await found({
          start: at(inDays(19), '10:00', '12:00').start,
          end: at(inDays(22), '10:00', '12:00').end,
        }),
      ).toBe(false);

      const closedDay = await page(at(shut, '10:00', '12:00'));
      expect(closedDay.availability?.open).toBe(false);
      expect((await page(at(short, '09:00', '13:00'))).availability?.open).toBe(true);
      expect(closedDay.hoursExceptions).toEqual([
        { startsOn: shut, endsOn: shut, hours: null, closedHours: null },
        {
          startsOn: short,
          endsOn: short,
          hours: { opens: '08:00', closes: '14:00' },
          closedHours: null,
        },
      ]);
      // The owner's note never reaches the public.
      const raw = await request(app.getHttpServer()).get(`/v1/parking/${slug}`).expect(200);
      expect(JSON.stringify(raw.body)).not.toContain('Απογραφή');
      for (const entry of (raw.body as { hoursExceptions: object[] }).hoursExceptions) {
        expect(Object.keys(entry).sort()).toEqual(['closedHours', 'endsOn', 'hours', 'startsOn']);
      }
      await unpublish(id);
    });

    it('drops an entry once it has ended, for the owner and the public alike', async () => {
      const { id, slug } = await liveListing();
      await db.insert(schema.parkingHoursExceptions).values([
        { locationId: id, startsOn: inDays(-3), endsOn: inDays(-1) },
        { locationId: id, startsOn: inDays(0), endsOn: inDays(0) },
      ]);
      const owned = OwnerListingSchema.parse(
        (await api(keeper, 'get', `/listings/${id}`).expect(200)).body,
      );
      expect(owned.hoursExceptions.map((entry) => entry.endsOn)).toEqual([inDays(0)]);
      const shown = ParkingListingDetailSchema.parse(
        (await request(app.getHttpServer()).get(`/v1/parking/${slug}`).expect(200)).body,
      );
      expect(shown.hoursExceptions.map((entry) => entry.endsOn)).toEqual([inDays(0)]);
      await unpublish(id);
    });

    it('closes part of a day and keeps the week’s hours around it, in search and on the page', async () => {
      const { id, slug } = await liveListing();
      const cleaning = inDays(25);
      await save(keeper, id, [
        { ...closed(cleaning), closedHours: { from: '10:00', to: '14:00' } },
      ]).expect(200);
      const owned = OwnerListingSchema.parse(
        (await api(keeper, 'get', `/listings/${id}`).expect(200)).body,
      );
      expect(owned.hoursExceptions[0]).toMatchObject({
        hours: null,
        closedHours: { from: '10:00', to: '14:00' },
      });

      const found = async (from: string, to: string) => {
        const response = await request(app.getHttpServer())
          .get('/v1/parking/search')
          .query({ ...HERE, ...at(cleaning, from, to) })
          .expect(200);
        return ParkingSearchResponseSchema.parse(response.body).results.some(
          (result) => result.slug === slug,
        );
      };
      expect(await found('08:00', '10:00')).toBe(true);
      expect(await found('14:00', '20:00')).toBe(true);
      expect(await found('09:00', '11:00')).toBe(false);
      expect(await found('13:30', '15:00')).toBe(false);

      const shown = ParkingListingDetailSchema.parse(
        (await request(app.getHttpServer()).get(`/v1/parking/${slug}`).expect(200)).body,
      );
      expect(shown.hoursExceptions).toEqual([
        {
          startsOn: cleaning,
          endsOn: cleaning,
          hours: null,
          closedHours: { from: '10:00', to: '14:00' },
        },
      ]);
      await unpublish(id);
    });

    it('takes a break in the weekly hours, and search keeps to it', async () => {
      const { id, slug } = await liveListing();
      // Every day 08:00–20:00, closed 14:00–17:00: two periods a day, three on none.
      const week = WEEK.flatMap((weekday) => [
        { weekday, opens: '08:00', closes: '14:00' },
        { weekday, opens: '17:00', closes: '20:00' },
      ]);
      await db
        .update(schema.parkingLocations)
        .set({ status: 'draft' })
        .where(eq(schema.parkingLocations.id, id));
      await api(keeper, 'put', `/listings/${id}/hours`).send({ periods: week }).expect(200);
      await publishAgain(id);
      const owned = OwnerListingSchema.parse(
        (await api(keeper, 'get', `/listings/${id}`).expect(200)).body,
      );
      expect(owned.openingHours.filter((period) => period.weekday === 1)).toEqual(week.slice(0, 2));

      const found = async (from: string, to: string) => {
        const response = await request(app.getHttpServer())
          .get('/v1/parking/search')
          .query({ ...HERE, ...at(inDays(9), from, to) })
          .expect(200);
        return ParkingSearchResponseSchema.parse(response.body).results.some(
          (result) => result.slug === slug,
        );
      };
      expect(await found('09:00', '13:00')).toBe(true);
      expect(await found('13:00', '15:00')).toBe(false);
      expect(await found('17:00', '19:00')).toBe(true);
      await unpublish(id);
    });

    it('takes up to three weekly periods a day, which a night with a break needs', async () => {
      const id = await newListing(keeper);
      const nights = WEEK.flatMap((weekday) => [
        { weekday, opens: '00:00', closes: '02:00' },
        { weekday, opens: '08:00', closes: '14:00' },
        { weekday, opens: '17:00', closes: '24:00' },
      ]);
      await api(keeper, 'put', `/listings/${id}/hours`).send({ periods: nights }).expect(200);
      await api(keeper, 'put', `/listings/${id}/hours`)
        .send({ periods: [...nights, { weekday: 1, opens: '03:00', closes: '04:00' }] })
        .expect(400);
    });

    describe('copied to the owner’s other listings', () => {
      const entries = () => [
        closed(inDays(30), inDays(30), 'Αργία'),
        { ...closed(inDays(31)), closedHours: { from: '12:00', to: '15:00' } },
      ];
      const copy = (user: TestUser, id: string, to: string[]) =>
        api(user, 'post', `/listings/${id}/hours-exceptions/copy`).send({ to });
      const outcomes = (response: request.Response) =>
        OwnerHoursExceptionsCopySchema.parse(response.body).results;
      const held = async (user: TestUser, id: string) =>
        OwnerListingSchema.parse((await api(user, 'get', `/listings/${id}`).expect(200)).body)
          .hoursExceptions;
      // Copying has its own limit per visitor, and each test user is one: a new owner per test.
      const freshOwner = () => signUpUser(app);

      it('adds the entries to each listing chosen, live or not, notes and all', async () => {
        const source = await newListing(keeper);
        const draft = await newListing(keeper);
        const { id: live } = await liveListing();
        await save(keeper, source, entries()).expect(200);
        await save(keeper, draft, [closed(inDays(40))]).expect(200);

        const response = await copy(keeper, source, [draft, live]).expect(200);
        expect(outcomes(response)).toEqual([
          { id: draft, outcome: 'copied' },
          { id: live, outcome: 'copied' },
        ]);
        expect(await held(keeper, draft)).toEqual([...entries(), closed(inDays(40))]);
        expect(await held(keeper, live)).toEqual(entries());
        expect((await progress(keeper, live)).status).toBe('published');
      });

      it('counts what a listing already has as copied, so copying twice is harmless', async () => {
        const owner = await freshOwner();
        const source = await newListing(owner);
        const other = await newListing(owner);
        await save(owner, source, entries()).expect(200);
        await copy(owner, source, [other]).expect(200);
        expect(outcomes(await copy(owner, source, [other]).expect(200))[0]?.outcome).toBe('copied');
        expect(await held(owner, other)).toHaveLength(2);
      });

      it('keeps a listing’s own note on an entry it already has', async () => {
        const owner = await freshOwner();
        const source = await newListing(owner);
        const other = await newListing(owner);
        await save(owner, source, [closed(inDays(30), inDays(30), 'Αργία')]).expect(200);
        await save(owner, other, [closed(inDays(30), inDays(30), 'Δική μου')]).expect(200);
        expect(outcomes(await copy(owner, source, [other]).expect(200))[0]?.outcome).toBe('copied');
        expect(await held(owner, other)).toEqual([closed(inDays(30), inDays(30), 'Δική μου')]);
      });

      it('leaves a listing with other hours on one of those days exactly as it was', async () => {
        const owner = await freshOwner();
        const source = await newListing(owner);
        const busy = await newListing(owner);
        await save(owner, source, entries()).expect(200);
        const own = [{ ...closed(inDays(31)), hours: { opens: '09:00', closes: '12:00' } }];
        await save(owner, busy, own).expect(200);
        expect(outcomes(await copy(owner, source, [busy]).expect(200))).toEqual([
          { id: busy, outcome: 'clash' },
        ]);
        expect(await held(owner, busy)).toEqual(own);
      });

      it('answers for each listing on its own: one clash stops none of the others', async () => {
        const owner = await freshOwner();
        const source = await newListing(owner);
        const busy = await newListing(owner);
        const free = await newListing(owner);
        await save(owner, source, entries()).expect(200);
        const own = [{ ...closed(inDays(30)), hours: { opens: '09:00', closes: '12:00' } }];
        await save(owner, busy, own).expect(200);
        expect(outcomes(await copy(owner, source, [busy, free]).expect(200))).toEqual([
          { id: busy, outcome: 'clash' },
          { id: free, outcome: 'copied' },
        ]);
        expect(await held(owner, busy)).toEqual(own);
        expect(await held(owner, free)).toEqual(entries());
      });

      it('fills a listing to the limit exactly, and no further', async () => {
        const owner = await freshOwner();
        const source = await newListing(owner);
        const room = await newListing(owner);
        const full = await newListing(owner);
        await save(owner, source, entries()).expect(200);
        const others = (count: number) =>
          Array.from({ length: count }, (_, day) => closed(inDays(100 + day)));
        await save(owner, room, others(HOURS_EXCEPTIONS_MAX - 2)).expect(200);
        await save(owner, full, others(HOURS_EXCEPTIONS_MAX - 1)).expect(200);
        expect(outcomes(await copy(owner, source, [room, full]).expect(200))).toEqual([
          { id: room, outcome: 'copied' },
          { id: full, outcome: 'full' },
        ]);
        expect(await held(owner, room)).toHaveLength(HOURS_EXCEPTIONS_MAX);
        expect(await held(owner, full)).toHaveLength(HOURS_EXCEPTIONS_MAX - 1);
      });

      it('clears entries that ended, which would otherwise block a copy unseen', async () => {
        const owner = await freshOwner();
        const source = await newListing(owner);
        const other = await newListing(owner);
        await save(owner, source, [closed(inDays(-2), inDays(3))]).expect(200);
        await db
          .insert(schema.parkingHoursExceptions)
          .values({ locationId: other, startsOn: inDays(-2), endsOn: inDays(-1) });
        expect(outcomes(await copy(owner, source, [other]).expect(200))[0]?.outcome).toBe('copied');
      });

      it('copies nothing anywhere when one listing named is not the owner’s', async () => {
        const owner = await freshOwner();
        const source = await newListing(owner);
        const mine = await newListing(owner);
        const theirs = await newListing(stranger);
        await save(owner, source, entries()).expect(200);
        const response = await copy(owner, source, [mine, theirs]).expect(404);
        expect((response.body as { code: string }).code).toBe('LISTING_NOT_FOUND');
        expect(await held(owner, mine)).toEqual([]);
        await copy(owner, source, [randomUUID()]).expect(404);
        // Nor from a listing that isn't theirs.
        await copy(stranger, source, [theirs]).expect(404);
      });

      it('passes over the listing copied from, and refuses a list that makes no sense', async () => {
        const owner = await freshOwner();
        const source = await newListing(owner);
        await save(owner, source, entries()).expect(200);
        expect(outcomes(await copy(owner, source, [source]).expect(200))).toEqual([]);
        // The same listing in capitals is still that listing.
        expect(outcomes(await copy(owner, source, [source.toUpperCase()]).expect(200))).toEqual([]);
        await copy(owner, source, []).expect(400);
        await copy(owner, source, ['not-a-uuid']).expect(400);
        const other = await newListing(owner);
        await copy(owner, source, [other, other]).expect(400);
      });

      it('has a limit of its own, well below the general one', async () => {
        const owner = await freshOwner();
        const source = await newListing(owner);
        const other = await newListing(owner);
        const answers = [];
        for (let call = 0; call < 11; call++) {
          answers.push((await copy(owner, source, [other])).status);
        }
        expect(answers.slice(0, 10).every((status) => status === 200)).toBe(true);
        expect(answers[10]).toBe(429);
      });

      it('leaves a live listing’s row alone, and moves a draft’s for its reminder', async () => {
        const source = await newListing(keeper);
        const draft = await newListing(keeper);
        const { id: live } = await liveListing();
        await save(keeper, source, [closed(inDays(60))]).expect(200);
        const before = async (id: string) =>
          (
            await db
              .select({ updatedAt: schema.parkingLocations.updatedAt })
              .from(schema.parkingLocations)
              .where(eq(schema.parkingLocations.id, id))
          )[0]?.updatedAt.getTime() ?? 0;
        const [draftBefore, liveBefore] = [await before(draft), await before(live)];
        await copy(keeper, source, [draft, live]).expect(200);
        expect(await before(draft)).toBeGreaterThan(draftBefore);
        expect(await before(live)).toBe(liveBefore);
      });
    });

    describe('at the same moment', () => {
      it('takes two saves of one listing, keeping exactly one of the two lists', async () => {
        const owner = await signUpUser(app);
        const one = [closed(inDays(10), inDays(12))];
        const two = [closed(inDays(11)), closed(inDays(14))];
        // Several rounds, several listings at once: one pair alone rarely interleaves locally.
        for (let round = 0; round < 4; round++) {
          const ids = [await newListing(owner), await newListing(owner), await newListing(owner)];
          const answers = await Promise.all(
            ids.flatMap((id) => [save(owner, id, one), save(owner, id, two)]),
          );
          expect(answers.map((answer) => answer.status)).toEqual(answers.map(() => 200));
          for (const id of ids) {
            const stored = OwnerListingSchema.parse(
              (await api(owner, 'get', `/listings/${id}`).expect(200)).body,
            ).hoursExceptions;
            expect([one, two]).toContainEqual(stored);
          }
        }
      });

      it('takes a copy into a listing and a save of it one after the other', async () => {
        const owner = await signUpUser(app);
        const source = await newListing(owner);
        const target = await newListing(owner);
        await save(owner, source, [closed(inDays(31))]).expect(200);
        const own = [{ ...closed(inDays(31)), hours: { opens: '08:00', closes: '12:00' } }];
        const [saved, copied] = await Promise.all([
          save(owner, target, own),
          api(owner, 'post', `/listings/${source}/hours-exceptions/copy`).send({ to: [target] }),
        ]);
        expect([saved.status, copied.status]).toEqual([200, 200]);
        const outcome = OwnerHoursExceptionsCopySchema.parse(copied.body).results[0]?.outcome;
        const stored = OwnerListingSchema.parse(
          (await api(owner, 'get', `/listings/${target}`).expect(200)).body,
        ).hoursExceptions;
        // The save replaces the list whichever came first; a copy after it found the clash.
        expect(stored).toEqual(own);
        expect(['copied', 'clash']).toContain(outcome);
      });

      it('copies two listings into one: one gets in, the other clashes', async () => {
        const owner = await signUpUser(app);
        const [first, second, target] = [
          await newListing(owner),
          await newListing(owner),
          await newListing(owner),
        ];
        await save(owner, first, [closed(inDays(31))]).expect(200);
        await save(owner, second, [
          { ...closed(inDays(31)), hours: { opens: '08:00', closes: '12:00' } },
        ]).expect(200);
        const copy = (source: string) =>
          api(owner, 'post', `/listings/${source}/hours-exceptions/copy`).send({ to: [target] });
        const answers = await Promise.all([copy(first), copy(second)]);
        expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
        const results = answers.map(
          (answer) => OwnerHoursExceptionsCopySchema.parse(answer.body).results[0]?.outcome,
        );
        expect(results.toSorted()).toEqual(['clash', 'copied']);
        const stored = OwnerListingSchema.parse(
          (await api(owner, 'get', `/listings/${target}`).expect(200)).body,
        ).hoursExceptions;
        expect(stored).toHaveLength(1);
      });
    });

    it('sweeps away entries once they end, notes and all, on the listing’s own calendar', async () => {
      const id = await newListing(keeper);
      const [yesterday, todayDate] = [inDays(-1), today()];
      await db.insert(schema.parkingHoursExceptions).values([
        { locationId: id, startsOn: inDays(-3), endsOn: yesterday, label: 'Ιδιωτικό' },
        { locationId: id, startsOn: todayDate, endsOn: todayDate },
      ]);
      const left = async () =>
        (
          await db
            .select({ endsOn: schema.parkingHoursExceptions.endsOn })
            .from(schema.parkingHoursExceptions)
            .where(eq(schema.parkingHoursExceptions.locationId, id))
        ).map((row) => row.endsOn);
      // Moments that have passed, so nothing still running anywhere is touched. At 23:30 on
      // yesterday's date in Athens, yesterday hasn't ended.
      await deleteEndedHoursExceptions(db, zonedTimeToUtc(yesterday, '23:30', DEFAULT_TIME_ZONE)!);
      expect(await left()).toEqual([yesterday, todayDate]);
      // Half an hour into today in Athens it has, though in UTC it is still yesterday evening.
      const justAfter = zonedTimeToUtc(todayDate, '00:30', DEFAULT_TIME_ZONE)!;
      expect(justAfter.toISOString().slice(0, 10)).toBe(yesterday);
      await deleteEndedHoursExceptions(db, justAfter);
      expect(await left()).toEqual([todayDate]);
    });

    it.todo('refuses closing time over a confirmed booking until the owner cancels it (#27)');

    describe('the database’s own rules', () => {
      /** The constraint the database named in refusing, so a test can't pass on the wrong one. */
      const refusedBy = async (insert: Promise<unknown>) => {
        try {
          await insert;
        } catch (error) {
          const cause = (error as { cause?: { constraint?: string } }).cause;
          return cause?.constraint;
        }
        return 'accepted';
      };
      const insert = (values: Partial<typeof schema.parkingHoursExceptions.$inferInsert>) =>
        db.insert(schema.parkingHoursExceptions).values({
          locationId: '',
          startsOn: '2099-02-01',
          endsOn: '2099-02-01',
          ...values,
        });

      it('refuses two entries on one day', async () => {
        const id = await newListing(keeper);
        await insert({ locationId: id, startsOn: '2099-01-01', endsOn: '2099-01-03' });
        expect(
          await refusedBy(insert({ locationId: id, startsOn: '2099-01-03', endsOn: '2099-01-05' })),
        ).toBe('parking_hours_exceptions_no_overlap');
      });

      it('refuses dates backwards, half a time and times off the half hour', async () => {
        const id = await newListing(keeper);
        expect(
          await refusedBy(insert({ locationId: id, startsOn: '2099-02-02', endsOn: '2099-02-01' })),
        ).toBe('parking_hours_exceptions_range_check');
        expect(await refusedBy(insert({ locationId: id, opensMinute: 480 }))).toBe(
          'parking_hours_exceptions_period_check',
        );
        expect(
          await refusedBy(insert({ locationId: id, opensMinute: 480, closesMinute: 495 })),
        ).toBe('parking_hours_exceptions_period_check');
      });

      it('refuses a closed part that is half there, backwards, or beside other hours', async () => {
        const id = await newListing(keeper);
        expect(await refusedBy(insert({ locationId: id, closedFromMinute: 600 }))).toBe(
          'parking_hours_exceptions_closed_part_check',
        );
        expect(
          await refusedBy(insert({ locationId: id, closedFromMinute: 840, closedToMinute: 600 })),
        ).toBe('parking_hours_exceptions_closed_part_check');
        expect(
          await refusedBy(
            insert({
              locationId: id,
              opensMinute: 480,
              closesMinute: 1200,
              closedFromMinute: 600,
              closedToMinute: 840,
            }),
          ),
        ).toBe('parking_hours_exceptions_closed_part_check');
      });

      it('refuses a note longer than the form allows', async () => {
        const id = await newListing(keeper);
        expect(await refusedBy(insert({ locationId: id, label: 'x'.repeat(81) }))).toBe(
          'parking_hours_exceptions_label_check',
        );
      });
    });
  });

  describe('weekly hours copied to other listings', () => {
    let copier: TestUser;
    const lunch = {
      periods: WEEK.flatMap((weekday) => [
        { weekday, opens: '08:00', closes: '14:00' },
        { weekday, opens: '17:00', closes: '20:00' },
      ]),
    };
    const copy = (user: TestUser, id: string, to: string[]) =>
      api(user, 'post', `/listings/${id}/hours/copy`).send({ to });
    const weekOf = async (user: TestUser, id: string) =>
      OwnerListingSchema.parse((await api(user, 'get', `/listings/${id}`).expect(200)).body)
        .openingHours;
    const setStatus = (id: string, status: 'changes_requested' | 'published' | 'suspended') =>
      db.update(schema.parkingLocations).set({ status }).where(eq(schema.parkingLocations.id, id));
    /** Out of the public catalogue again, so other tests' searches never meet it. */
    const backToDraft = (id: string) =>
      db
        .update(schema.parkingLocations)
        .set({ status: 'draft', slug: `draft-${id}` })
        .where(eq(schema.parkingLocations.id, id));
    /** An owner who can send listings in. Copying has a limit per visitor: one each keeps clear. */
    async function submitter(): Promise<TestUser> {
      const user = await signUpUser(app);
      await api(user, 'patch', '/profile').send(profile).expect(200);
      await api(user, 'put', '/profile/tax').send(tax).expect(200);
      return user;
    }

    beforeAll(async () => {
      copier = await submitter();
    });

    it('gives drafts and listings sent back the same week, and leaves checked ones alone', async () => {
      const source = await newListing(copier);
      await api(copier, 'put', `/listings/${source}/hours`).send(lunch).expect(200);
      const draft = await newListing(copier);
      const sentBack = await readyListing(copier);
      const withStaff = await readyListing(copier);
      for (const id of [sentBack, withStaff]) {
        await api(copier, 'post', `/listings/${id}/submit`).send({ confirmed: true }).expect(200);
      }
      await setStatus(sentBack, 'changes_requested');
      const theirOwn = await weekOf(copier, withStaff);

      const response = await copy(copier, source, [draft, sentBack, withStaff]).expect(200);
      expect(OwnerHoursCopySchema.parse(response.body).results).toEqual([
        { id: draft, outcome: 'copied' },
        { id: sentBack, outcome: 'copied' },
        { id: withStaff, outcome: 'locked' },
      ]);
      const expected = await weekOf(copier, source);
      expect(await weekOf(copier, draft)).toEqual(expected);
      // The week replaces what was there, not adds to it.
      expect(await weekOf(copier, sentBack)).toEqual(expected);
      expect(await weekOf(copier, withStaff)).toEqual(theirOwn);
      expect((await progress(copier, draft)).doneSteps).toEqual(['hours']);
    });

    it('copies from a live listing to a draft, the week staff checked', async () => {
      const live = await readyListing(copier);
      await api(copier, 'post', `/listings/${live}/submit`).send({ confirmed: true }).expect(200);
      await setStatus(live, 'published');
      try {
        const draft = await newListing(copier);
        await copy(copier, live, [draft]).expect(200);
        expect(await weekOf(copier, draft)).toEqual(await weekOf(copier, live));
      } finally {
        await backToDraft(live);
      }
    });

    it.each(['published', 'suspended'] as const)(
      'leaves a %s listing’s week as staff checked it',
      async (status) => {
        const owner = await submitter();
        const source = await newListing(owner);
        await api(owner, 'put', `/listings/${source}/hours`).send(lunch).expect(200);
        const checked = await readyListing(owner);
        await api(owner, 'post', `/listings/${checked}/submit`)
          .send({ confirmed: true })
          .expect(200);
        await setStatus(checked, status);
        try {
          const own = await weekOf(owner, checked);
          const response = await copy(owner, source, [checked]).expect(200);
          expect(OwnerHoursCopySchema.parse(response.body).results).toEqual([
            { id: checked, outcome: 'locked' },
          ]);
          expect(await weekOf(owner, checked)).toEqual(own);
        } finally {
          await backToDraft(checked);
        }
      },
    );

    it('moves a draft’s row for its reminder, and leaves a checked one’s alone', async () => {
      const owner = await submitter();
      const source = await newListing(owner);
      await api(owner, 'put', `/listings/${source}/hours`).send(lunch).expect(200);
      const draft = await newListing(owner);
      const checked = await readyListing(owner);
      await api(owner, 'post', `/listings/${checked}/submit`).send({ confirmed: true }).expect(200);
      const touched = async (id: string) =>
        (
          await db
            .select({ updatedAt: schema.parkingLocations.updatedAt })
            .from(schema.parkingLocations)
            .where(eq(schema.parkingLocations.id, id))
        )[0]?.updatedAt.getTime() ?? 0;
      const [draftBefore, checkedBefore] = [await touched(draft), await touched(checked)];
      await copy(owner, source, [draft, checked]).expect(200);
      expect(await touched(draft)).toBeGreaterThan(draftBefore);
      expect(await touched(checked)).toBe(checkedBefore);
    });

    it('refuses to copy an empty week, which would close every listing it reached', async () => {
      const owner = await signUpUser(app);
      const source = await newListing(owner);
      const target = await newListing(owner);
      await api(owner, 'put', `/listings/${target}/hours`).send(hours).expect(200);
      const response = await copy(owner, source, [target]).expect(409);
      expect((response.body as { code: string }).code).toBe('NOTHING_TO_COPY');
      expect(await weekOf(owner, target)).toHaveLength(7);
    });

    it('copies nothing anywhere when one listing named is not the owner’s', async () => {
      const owner = await signUpUser(app);
      const source = await newListing(owner);
      const mine = await newListing(owner);
      const theirs = await newListing(stranger);
      await api(owner, 'put', `/listings/${source}/hours`).send(lunch).expect(200);
      const response = await copy(owner, source, [mine, theirs]).expect(404);
      expect((response.body as { code: string }).code).toBe('LISTING_NOT_FOUND');
      expect(await weekOf(owner, mine)).toEqual([]);
      // Nor from a listing that isn't theirs.
      await copy(stranger, source, [theirs]).expect(404);
    });

    it('passes over the listing copied from, and refuses a list that makes no sense', async () => {
      const owner = await signUpUser(app);
      const source = await newListing(owner);
      const other = await newListing(owner);
      await api(owner, 'put', `/listings/${source}/hours`).send(lunch).expect(200);
      const itself = await copy(owner, source, [source, source.toUpperCase()]).expect(200);
      expect(OwnerHoursCopySchema.parse(itself.body).results).toEqual([]);
      // One listing in two spellings is still that one listing, not a stranger's.
      const twice = await copy(owner, source, [other, other.toUpperCase()]).expect(200);
      expect(OwnerHoursCopySchema.parse(twice.body).results).toEqual([
        { id: other, outcome: 'copied' },
      ]);
      await copy(owner, source, []).expect(400);
      await copy(owner, source, ['not-a-uuid']).expect(400);
      await copy(owner, source, [other, other]).expect(400);
      await api(owner, 'post', `/listings/${source}/hours/copy`)
        .send({ to: [other], status: 'published' })
        .expect(400);
      await copy(owner, source, [randomUUID()]).expect(404);
    });

    it('has a limit of its own, ten a minute, apart from the closures copy’s', async () => {
      const owner = await signUpUser(app);
      const source = await newListing(owner);
      const other = await newListing(owner);
      await api(owner, 'put', `/listings/${source}/hours`).send(lunch).expect(200);
      // The closures copy counts separately: these don't touch the hours copy's ten.
      for (let call = 0; call < 3; call++) {
        await api(owner, 'post', `/listings/${source}/hours-exceptions/copy`)
          .send({ to: [other] })
          .expect(200);
      }
      const answers = [];
      for (let call = 0; call < 11; call++) {
        answers.push((await copy(owner, source, [other])).status);
      }
      expect(answers.slice(0, 10).every((status) => status === 200)).toBe(true);
      expect(answers[10]).toBe(429);
    });

    describe('at the same moment', () => {
      it('takes a copy and a save of the same listings one after the other, never both', async () => {
        const owner = await signUpUser(app);
        const source = await newListing(owner);
        await api(owner, 'put', `/listings/${source}/hours`).send(lunch).expect(200);
        // Several rounds of three: one pair alone rarely interleaves locally.
        for (let round = 0; round < 4; round++) {
          const targets = [
            await newListing(owner),
            await newListing(owner),
            await newListing(owner),
          ];
          const answers = await Promise.all([
            copy(owner, source, targets),
            ...targets.map((id) => api(owner, 'put', `/listings/${id}/hours`).send(hours)),
          ]);
          expect(answers.map((answer) => answer.status)).toEqual(answers.map(() => 200));
          for (const id of targets) {
            // 14 periods from the copy or 7 from the save; 21 would be the two merged.
            expect([7, 14]).toContain((await weekOf(owner, id)).length);
          }
        }
      });

      it('copies two listings the other way round into the same ones without a deadlock', async () => {
        const owner = await signUpUser(app);
        const [first, second] = [await newListing(owner), await newListing(owner)];
        await api(owner, 'put', `/listings/${first}/hours`).send(lunch).expect(200);
        await api(owner, 'put', `/listings/${second}/hours`).send(hours).expect(200);
        const [b, c] = [await newListing(owner), await newListing(owner)];
        const answers = await Promise.all([
          copy(owner, first, [b, c]),
          copy(owner, second, [c, b]),
        ]);
        expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
        // Each target got one whole week, whichever copy came last.
        for (const id of [b, c]) {
          expect([7, 14]).toContain((await weekOf(owner, id)).length);
        }
      });

      it('waits for a submission under way, then leaves the week it handed over alone', async () => {
        const owner = await submitter();
        const source = await newListing(owner);
        await api(owner, 'put', `/listings/${source}/hours`).send(lunch).expect(200);
        const target = await readyListing(owner);
        const own = await weekOf(owner, target);

        // A submission holding the row, as `handOver` does, until the copy is seen waiting on it.
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => (release = resolve));
        const submitting = db.transaction(async (tx) => {
          await tx
            .select({ id: schema.parkingLocations.id })
            .from(schema.parkingLocations)
            .where(eq(schema.parkingLocations.id, target))
            .for('update');
          await tx
            .update(schema.parkingLocations)
            .set({ status: 'in_review' })
            .where(eq(schema.parkingLocations.id, target));
          await held;
        });
        const copying = copy(owner, source, [target]).then((response) => response);
        await expect
          .poll(
            async () =>
              (
                await db.execute(
                  sql`select count(*)::int as waiting from pg_stat_activity
                      where wait_event_type = 'Lock' and query ilike '%for no key update%'`,
                )
              ).rows[0]?.waiting,
            { timeout: 5000, interval: 25 },
          )
          .toBeGreaterThan(0);
        release();
        await submitting;

        const response = await copying;
        expect(response.status).toBe(200);
        expect(OwnerHoursCopySchema.parse(response.body).results).toEqual([
          { id: target, outcome: 'locked' },
        ]);
        expect(await weekOf(owner, target)).toEqual(own);
      });
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
