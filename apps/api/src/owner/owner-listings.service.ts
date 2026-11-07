import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HOURS_EXCEPTIONS_MAX,
  OWNER_LISTINGS_MAX,
  OwnerHoursCopySchema,
  OwnerHoursExceptionsCopySchema,
  OwnerHoursExceptionsSchema,
  OwnerListingProgressSchema,
  OwnerListingSchema,
  OwnerOnboardingSchema,
  PHOTO_LIMITS,
  PROOF_LIMITS,
  wallMinutes,
  zonedParts,
  type ListingHoursCopyInput,
  type ListingHoursExceptionsCopyInput,
  type ListingHoursExceptionsInput,
  type ListingHoursInput,
  type ListingLocationPatch,
  type ListingPhotoOrder,
  type ListingPhotoUpdate,
  type ListingPricesInput,
  type ListingProofPatch,
  type ListingSpacesInput,
  type OwnerHoursCopy,
  type OwnerHoursException,
  type OwnerHoursExceptions,
  type OwnerHoursExceptionsCopy,
  type OwnerListing,
  type OwnerListingProgress,
  type OwnerOnboarding,
  type OwnerPhoto,
  type OwnerPrices,
  type OwnerProof,
  type ParkingFeature,
  type ProofKind,
} from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { and, asc, count, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import { hoursOf, wallTime } from '../parking/opening-hours.js';
import { OBJECT_STORE, type ObjectStore } from '../storage/object-store.js';
import {
  cleanScan,
  photoObjectKeys,
  PhotoRejected,
  storePhoto,
} from '../storage/photo-pipeline.js';
import { UploadGate } from '../storage/upload-gate.js';
import {
  doneAccountSteps,
  doneListingSteps,
  isEditable,
  missingForSubmit,
  nextListingStep,
} from './onboarding-progress.js';
import { badUpload, conflict, listingNotFound } from './owner.errors.js';
import { OwnerProfileService, profileFacts } from './owner-profile.service.js';
import { slugFromName } from './slug.js';

const listing = schema.parkingLocations;
const profile = schema.ownerProfiles;
const space = schema.parkingSpaces;
const hours = schema.parkingOpeningHours;
const exception = schema.parkingHoursExceptions;
const rules = schema.parkingPriceRules;
const discounts = schema.parkingStayDiscounts;
const photo = schema.parkingPhotos;
const proof = schema.parkingProofDocuments;

type ListingRow = typeof listing.$inferSelect;
type ExceptionRow = typeof exception.$inferSelect;
type CopyOutcome = OwnerHoursExceptionsCopy['results'][number]['outcome'];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Reader = Pick<Database, 'select' | 'selectDistinctOn'>;

interface StepCounts {
  spaces: number;
  periods: number;
  photos: number;
  proofs: number;
}

interface Cover {
  key: string;
  width: number;
  height: number;
  alt: string | null;
  color: string;
}

export { OWNER_LISTINGS_MAX };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FEATURE_COLUMNS: Record<ParkingFeature, 'isCovered' | 'hasEvCharging' | 'isAccessible'> = {
  covered: 'isCovered',
  evCharging: 'hasEvCharging',
  accessible: 'isAccessible',
};

const PDF_MAGIC = Buffer.from('%PDF-');
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const EXTENSIONS: Record<OwnerProof['contentType'], string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/** What the bytes are, whatever the request says they are. */
function proofContentType(file: Buffer): OwnerProof['contentType'] | null {
  if (file.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return 'application/pdf';
  if (file.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return 'image/jpeg';
  if (file.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'image/png';
  return null;
}

/**
 * A name for the download: no paths, no control or formatting characters (bidi marks can make a
 * name read differently to staff), and the extension of what the file really is.
 */
export function safeFileName(name: string, contentType: OwnerProof['contentType']): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\p{Cc}\p{Cf}\p{Cs}"]/gu, '').trim();
  const stem = clean.replace(/\.[^.]*$/, '').slice(0, PROOF_LIMITS.fileName - 5) || 'document';
  return `${stem}${EXTENSIONS[contentType]}`;
}

/** The same days and the same hours; the owner's note doesn't matter. */
const sameEntry = (a: ExceptionRow, b: ExceptionRow) =>
  a.startsOn === b.startsOn &&
  a.endsOn === b.endsOn &&
  a.opensMinute === b.opensMinute &&
  a.closesMinute === b.closesMinute &&
  a.closedFromMinute === b.closedFromMinute &&
  a.closedToMinute === b.closedToMinute;

const shareADay = (a: ExceptionRow, b: ExceptionRow) =>
  a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

/**
 * Where a copy goes: each listing once and never the one copied from. Postgres reads a uuid
 * whatever its case, so the comparisons here must too, or two spellings of one listing would
 * count twice and fail the ownership check as a stranger's.
 */
const copyTargetsOf = (to: string[], source: string) =>
  [...new Set(to.map((target) => target.toLowerCase()))].filter((target) => target !== source);

const isUniqueViolation = (error: unknown, constraint: string) => {
  const cause = (error as { cause?: { code?: string; constraint?: string } }).cause ?? error;
  const { code, constraint: name } = cause as { code?: string; constraint?: string };
  return code === '23505' && name === constraint;
};

@Injectable()
export class OwnerListingsService {
  private readonly logger = new Logger(OwnerListingsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly profiles: OwnerProfileService,
    private readonly gate: UploadGate,
  ) {}

  /** The account's checklist and every listing's: what the dashboard shows. */
  async overview(userId: string): Promise<OwnerOnboarding> {
    const owner = await this.profiles.find(userId);
    if (!owner) {
      return OwnerOnboardingSchema.parse({ started: false, doneAccountSteps: [], listings: [] });
    }
    const rows = await this.db
      .select()
      .from(listing)
      .where(eq(listing.ownerId, owner.id))
      .orderBy(desc(listing.updatedAt))
      .limit(OWNER_LISTINGS_MAX);
    const progress = await this.progressOf(rows);
    return OwnerOnboardingSchema.parse({
      started: true,
      doneAccountSteps: doneAccountSteps(profileFacts(owner)),
      listings: rows.flatMap((row) => progress.get(row.id) ?? []),
    });
  }

  async create(userId: string): Promise<{ id: string }> {
    const owner = await this.profiles.ensure(userId);
    return this.db.transaction(async (tx) => {
      // The count and the insert under the owner's row, so two at once can't both pass the limit.
      await tx
        .select({ id: profile.id })
        .from(profile)
        .where(eq(profile.id, owner.id))
        .for('update');
      const [existing] = await tx
        .select({ value: count() })
        .from(listing)
        .where(eq(listing.ownerId, owner.id));
      if ((existing?.value ?? 0) >= OWNER_LISTINGS_MAX) throw conflict('TOO_MANY_LISTINGS');
      const id = randomUUID();
      await tx.insert(listing).values({ id, ownerId: owner.id, slug: `draft-${id}` });
      return { id };
    });
  }

  async get(userId: string, id: string): Promise<OwnerListing> {
    const row = await this.owned(userId, id);
    const [spaces, periods, exceptions, prices, photos, proofs, owner] = await Promise.all([
      this.db
        .select()
        .from(space)
        .where(eq(space.locationId, row.id))
        .orderBy(asc(space.createdAt), asc(space.label)),
      this.db
        .select()
        .from(hours)
        .where(eq(hours.locationId, row.id))
        .orderBy(asc(hours.weekday), asc(hours.opensMinute)),
      this.hoursExceptions(this.db, row),
      this.prices(row),
      this.photos(this.db, row.id),
      this.proofs(row.id),
      this.profiles.find(userId),
    ]);
    return OwnerListingSchema.parse({
      id: row.id,
      status: row.status,
      locked: !isEditable(row.status),
      // From the rows just read: counting the same tables again would double the queries.
      progress: this.progressFrom(
        row,
        {
          spaces: spaces.length,
          periods: periods.length,
          photos: photos.length,
          proofs: proofs.length,
        },
        photos[0],
      ),
      doneAccountSteps: doneAccountSteps(owner && profileFacts(owner)),
      location: {
        name: row.name,
        address: row.address,
        areaId: row.areaId,
        latitude: row.location?.latitude ?? null,
        longitude: row.location?.longitude ?? null,
        description: row.description,
        contentLocale: row.contentLocale,
      },
      spaces: spaces.map((s) => ({
        id: s.id,
        label: s.label,
        hourlyRateMinor: s.hourlyRateMinor,
        features: (Object.keys(FEATURE_COLUMNS) as ParkingFeature[]).filter(
          (feature) => s[FEATURE_COLUMNS[feature]],
        ),
      })),
      openingHours: periods.map((period) => ({
        weekday: period.weekday,
        opens: wallTime(period.opensMinute),
        closes: wallTime(period.closesMinute),
      })),
      hoursExceptions: exceptions,
      prices,
      photos,
      proofs,
      landRegistrationNumber: row.landRegistrationNumber,
    });
  }

  /** Throws unless this user may change the listing; uploads ask before reading a byte. */
  async assertEditable(userId: string, id: string): Promise<void> {
    const row = await this.owned(userId, id);
    if (!isEditable(row.status)) throw conflict('LISTING_LOCKED');
  }

  async remove(userId: string, id: string): Promise<void> {
    const { keys, storageKeys } = await this.edit(userId, id, async (tx, row) => {
      if (row.status !== 'draft') throw conflict('LISTING_LOCKED');
      const [photos, proofs] = await Promise.all([
        this.photos(tx, row.id),
        tx.select({ key: proof.storageKey }).from(proof).where(eq(proof.locationId, row.id)),
      ]);
      await tx.delete(listing).where(eq(listing.id, row.id));
      return { keys: photos.map((p) => p.key), storageKeys: proofs.map((p) => p.key) };
    });
    await this.deleteFiles([...(await this.unusedPhotoFiles(keys)), ...storageKeys]);
  }

  async saveLocation(
    userId: string,
    id: string,
    patch: ListingLocationPatch,
  ): Promise<OwnerListingProgress> {
    const { latitude, longitude, ...columns } = patch;
    const point =
      latitude === undefined || longitude === undefined
        ? undefined
        : latitude === null || longitude === null
          ? null
          : { latitude, longitude };
    await this.edit(userId, id, (tx, row) =>
      tx
        .update(listing)
        .set({ ...columns, location: point })
        .where(eq(listing.id, row.id)),
    );
    return this.progress(userId, id);
  }

  /** Editable listings have no bookings yet, so the list can simply be replaced. */
  async saveSpaces(
    userId: string,
    id: string,
    { spaces }: ListingSpacesInput,
  ): Promise<OwnerListingProgress> {
    await this.edit(userId, id, async (tx, row) => {
      await tx.delete(space).where(eq(space.locationId, row.id));
      await tx.insert(space).values(
        spaces.map(({ label, features, hourlyRateMinor }) => ({
          locationId: row.id,
          label,
          hourlyRateMinor,
          isCovered: features.includes('covered'),
          hasEvCharging: features.includes('evCharging'),
          isAccessible: features.includes('accessible'),
        })),
      );
    });
    return this.progress(userId, id);
  }

  async saveHours(
    userId: string,
    id: string,
    { periods }: ListingHoursInput,
  ): Promise<OwnerListingProgress> {
    await this.edit(userId, id, async (tx, row) => {
      await tx.delete(hours).where(eq(hours.locationId, row.id));
      await tx.insert(hours).values(
        periods.map(({ weekday, opens, closes }) => ({
          locationId: row.id,
          weekday,
          opensMinute: wallMinutes(opens),
          closesMinute: wallMinutes(closes),
        })),
      );
    });
    return this.progress(userId, id);
  }

  /**
   * Closures and special hours, whatever the status and with no new review (decision #24): they
   * only change when drivers can come. What is sent replaces what is stored, so entries that have
   * ended go too; nobody sees them again. Phase 3 refuses this over a booking (decision #27), here,
   * under the same lock.
   */
  async saveHoursExceptions(
    userId: string,
    id: string,
    { exceptions }: ListingHoursExceptionsInput,
  ): Promise<OwnerHoursExceptions> {
    return this.edit(
      userId,
      id,
      async (tx, row) => {
        await tx.delete(exception).where(eq(exception.locationId, row.id));
        if (exceptions.length > 0) {
          await tx.insert(exception).values(
            exceptions.map(({ label, startsOn, endsOn, hours: open, closedHours: shut }) => ({
              locationId: row.id,
              label,
              startsOn,
              endsOn,
              opensMinute: open ? wallMinutes(open.opens) : null,
              closesMinute: open ? wallMinutes(open.closes) : null,
              closedFromMinute: shut ? wallMinutes(shut.from) : null,
              closedToMinute: shut ? wallMinutes(shut.to) : null,
            })),
          );
        }
        return OwnerHoursExceptionsSchema.parse({
          exceptions: await this.hoursExceptions(tx, row),
        });
      },
      { anyStatus: true },
    );
  }

  /**
   * Adds this listing's closures and special hours to other listings of the owner's (decision
   * #29). One transaction, a handful of statements, each listing all or nothing: an entry a
   * listing already has, the same days and hours, counts as copied. Any other entry on one of those
   * days is a clash, and that listing is left as it was: which of the two the owner meant is
   * theirs to say. The targets are locked in id order, so two copies at once can't deadlock.
   */
  async copyHoursExceptions(
    userId: string,
    id: string,
    { to }: ListingHoursExceptionsCopyInput,
  ): Promise<OwnerHoursExceptionsCopy> {
    const source = await this.owned(userId, id);
    const targets = copyTargetsOf(to, source.id);
    if (targets.length === 0) return OwnerHoursExceptionsCopySchema.parse({ results: [] });
    // One reading of the clock for every date below. All listings share one zone (its CHECK).
    const today = zonedParts(new Date(), source.timeZone).date;

    const outcomes = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: listing.id, status: listing.status })
        .from(listing)
        .innerJoin(profile, eq(profile.id, listing.ownerId))
        .where(and(inArray(listing.id, targets), eq(profile.userId, userId)))
        .orderBy(asc(listing.id))
        .for('no key update', { of: listing });
      // A listing that isn't theirs refuses the lot, with the same 404 as one that doesn't exist.
      if (locked.length !== targets.length) throw listingNotFound();

      // Ended entries are never shown again, but the overlap constraint still sees them.
      await tx
        .delete(exception)
        .where(and(inArray(exception.locationId, targets), lt(exception.endsOn, today)));
      const entries = await this.exceptionRows(tx, source.id, today);
      const heldBy = new Map<string, ExceptionRow[]>();
      for (const row of await tx
        .select()
        .from(exception)
        .where(inArray(exception.locationId, targets))) {
        heldBy.set(row.locationId, [...(heldBy.get(row.locationId) ?? []), row]);
      }

      const result = new Map<string, CopyOutcome>();
      const added: ExceptionRow[] = [];
      for (const target of targets) {
        const held = heldBy.get(target) ?? [];
        const fresh = entries.filter((entry) => !held.some((own) => sameEntry(own, entry)));
        if (fresh.some((entry) => held.some((own) => shareADay(own, entry)))) {
          result.set(target, 'clash');
        } else if (held.length + fresh.length > HOURS_EXCEPTIONS_MAX) {
          result.set(target, 'full');
        } else {
          result.set(target, 'copied');
          added.push(...fresh.map((entry) => ({ ...entry, locationId: target })));
        }
      }
      if (added.length > 0) {
        await tx
          .insert(exception)
          .values(added.map(({ id: _id, createdAt: _createdAt, ...entry }) => entry));
      }
      // As `edit` does: a draft's last change moves, for its reminder; others keep their row.
      const touched = locked.filter(
        (row) => isEditable(row.status) && added.some((entry) => entry.locationId === row.id),
      );
      if (touched.length > 0) {
        await tx
          .update(listing)
          .set({ updatedAt: new Date() })
          .where(
            inArray(
              listing.id,
              touched.map((row) => row.id),
            ),
          );
      }
      return result;
    });
    return OwnerHoursExceptionsCopySchema.parse({
      results: targets.map((target) => ({ id: target, outcome: outcomes.get(target) })),
    });
  }

  /**
   * Gives other listings of the owner's this one's weekly hours, replacing theirs (decision #30).
   * Only drafts and listings sent back take them: staff have checked the others' hours. One
   * transaction, the targets locked in id order, as copying closures does.
   */
  async copyHours(
    userId: string,
    id: string,
    { to }: ListingHoursCopyInput,
  ): Promise<OwnerHoursCopy> {
    const source = await this.owned(userId, id);
    const targets = copyTargetsOf(to, source.id);
    if (targets.length === 0) return OwnerHoursCopySchema.parse({ results: [] });
    // Read before any lock is taken: the source isn't locked, and a refusal then locks nothing.
    const week = await this.db
      .select({
        weekday: hours.weekday,
        opensMinute: hours.opensMinute,
        closesMinute: hours.closesMinute,
      })
      .from(hours)
      .where(eq(hours.locationId, source.id));
    // An empty week would close the targets; nobody means that by copying.
    if (week.length === 0) throw conflict('NOTHING_TO_COPY');

    const outcomes = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: listing.id, status: listing.status })
        .from(listing)
        .innerJoin(profile, eq(profile.id, listing.ownerId))
        .where(and(inArray(listing.id, targets), eq(profile.userId, userId)))
        .orderBy(asc(listing.id))
        .for('no key update', { of: listing });
      // A listing that isn't theirs refuses the lot, with the same 404 as one that doesn't exist.
      if (locked.length !== targets.length) throw listingNotFound();

      const open = locked.filter((row) => isEditable(row.status)).map((row) => row.id);
      if (open.length > 0) {
        await tx.delete(hours).where(inArray(hours.locationId, open));
        await tx
          .insert(hours)
          .values(open.flatMap((locationId) => week.map((period) => ({ ...period, locationId }))));
        await tx.update(listing).set({ updatedAt: new Date() }).where(inArray(listing.id, open));
      }
      return new Map(
        locked.map((row) => [row.id, isEditable(row.status) ? 'copied' : 'locked'] as const),
      );
    });
    return OwnerHoursCopySchema.parse({
      results: targets.map((target) => ({ id: target, outcome: outcomes.get(target) })),
    });
  }

  async savePrices(
    userId: string,
    id: string,
    input: ListingPricesInput,
  ): Promise<OwnerListingProgress> {
    await this.edit(userId, id, async (tx, { id: locationId }) => {
      await tx
        .update(listing)
        .set({
          hourlyRateMinor: input.hourlyRateMinor,
          dailyMaxMinor: input.dailyMaxMinor,
          bookingGapMinutes: input.bookingGapMinutes,
          cancellationPolicy: input.cancellationPolicy,
        })
        .where(eq(listing.id, locationId));
      await tx.delete(rules).where(eq(rules.locationId, locationId));
      await tx.delete(discounts).where(eq(discounts.locationId, locationId));
      const rows: (typeof rules.$inferInsert)[] = [
        ...(input.weekendRateMinor === null
          ? []
          : [{ locationId, kind: 'weekend' as const, hourlyRateMinor: input.weekendRateMinor }]),
        ...(input.night === null
          ? []
          : [
              {
                locationId,
                kind: 'night' as const,
                hourlyRateMinor: input.night.rateMinor,
                fromMinute: wallMinutes(input.night.from),
                toMinute: wallMinutes(input.night.to),
              },
            ]),
        ...input.datedPrices.map((dated) => ({
          locationId,
          kind: 'dated' as const,
          hourlyRateMinor: dated.rateMinor,
          startsOn: dated.startsOn,
          endsOn: dated.endsOn,
          label: dated.label,
        })),
      ];
      if (rows.length > 0) await tx.insert(rules).values(rows);
      if (input.longStayDiscounts.length > 0) {
        await tx
          .insert(discounts)
          .values(input.longStayDiscounts.map((discount) => ({ ...discount, locationId })));
      }
    });
    return this.progress(userId, id);
  }

  /**
   * Resizing runs before the transaction: it takes seconds, and no row should stay locked for it.
   * The limit is checked twice, cheaply first, then for real under the lock.
   */
  async addPhoto(userId: string, id: string, file: Buffer): Promise<OwnerPhoto> {
    const { id: locationId } = await this.owned(userId, id);
    const [existing] = await this.db
      .select({ value: count() })
      .from(photo)
      .where(eq(photo.locationId, locationId));
    if ((existing?.value ?? 0) >= PHOTO_LIMITS.maxPerListing) throw conflict('TOO_MANY_PHOTOS');

    let stored;
    try {
      stored = await this.gate.process(() => storePhoto(file, this.store));
    } catch (error) {
      if (error instanceof PhotoRejected) throw badUpload(error.code);
      throw error;
    }
    try {
      return await this.edit(userId, id, async (tx) => {
        const photos = await this.photos(tx, locationId);
        if (photos.length >= PHOTO_LIMITS.maxPerListing) throw conflict('TOO_MANY_PHOTOS');
        const position = (photos.at(-1)?.position ?? -1) + 1;
        const [row] = await tx
          .insert(photo)
          .values({ ...stored, locationId, position })
          .returning();
        if (!row) throw new Error('Photo insert returned no row');
        const { id: photoId, key, width, height, alt, color } = row;
        return { id: photoId, key, width, height, alt, color };
      });
    } catch (error) {
      await this.deleteFiles(await this.unusedPhotoFiles([stored.key]));
      if (isUniqueViolation(error, 'parking_photos_location_key_unique')) {
        throw conflict('PHOTO_DUPLICATE');
      }
      throw error;
    }
  }

  async updatePhoto(
    userId: string,
    id: string,
    photoId: string,
    { alt }: ListingPhotoUpdate,
  ): Promise<void> {
    if (!UUID.test(photoId)) throw listingNotFound();
    await this.edit(userId, id, async (tx, row) => {
      const updated = await tx
        .update(photo)
        .set({ alt })
        .where(and(eq(photo.id, photoId), eq(photo.locationId, row.id)))
        .returning({ id: photo.id });
      if (updated.length === 0) throw listingNotFound();
    });
  }

  async reorderPhotos(userId: string, id: string, { ids }: ListingPhotoOrder): Promise<void> {
    await this.edit(userId, id, async (tx, row) => {
      const known = new Set((await this.photos(tx, row.id)).map((p) => p.id));
      const sameSet = ids.length === known.size && new Set(ids).size === ids.length;
      if (!sameSet || ids.some((photoId) => !known.has(photoId))) {
        throw conflict('PHOTOS_CHANGED');
      }
      for (const [position, photoId] of ids.entries()) {
        await tx.update(photo).set({ position }).where(eq(photo.id, photoId));
      }
    });
  }

  async removePhoto(userId: string, id: string, photoId: string): Promise<void> {
    if (!UUID.test(photoId)) throw listingNotFound();
    const key = await this.edit(userId, id, async (tx, row) => {
      const [removed] = await tx
        .delete(photo)
        .where(and(eq(photo.id, photoId), eq(photo.locationId, row.id)))
        .returning({ key: photo.key });
      if (!removed) throw listingNotFound();
      return removed.key;
    });
    await this.deleteFiles(await this.unusedPhotoFiles([key]));
  }

  async addProof(
    userId: string,
    id: string,
    kind: ProofKind,
    fileName: string,
    file: Buffer,
  ): Promise<OwnerProof> {
    const { id: locationId } = await this.owned(userId, id);
    const contentType = proofContentType(file);
    if (!contentType) throw badUpload('FILE_TYPE_NOT_ALLOWED');
    const [existing] = await this.db
      .select({ value: count() })
      .from(proof)
      .where(eq(proof.locationId, locationId));
    if ((existing?.value ?? 0) >= PROOF_LIMITS.maxPerListing) throw conflict('TOO_MANY_PROOFS');

    // Scans are re-encoded so a phone's location and camera details don't sit in our storage.
    let body = file;
    if (contentType !== 'application/pdf') {
      try {
        body = await this.gate.process(() => cleanScan(file, contentType));
      } catch {
        throw badUpload('FILE_TYPE_NOT_ALLOWED');
      }
    }
    const documentId = randomUUID();
    const storageKey = `proofs/${locationId}/${documentId}`;
    await this.store.put(storageKey, body, contentType);
    try {
      await this.edit(userId, id, async (tx) => {
        const [held] = await tx
          .select({ value: count() })
          .from(proof)
          .where(eq(proof.locationId, locationId));
        if ((held?.value ?? 0) >= PROOF_LIMITS.maxPerListing) throw conflict('TOO_MANY_PROOFS');
        await tx.insert(proof).values({
          id: documentId,
          locationId,
          kind,
          storageKey,
          contentType,
          fileName: safeFileName(fileName, contentType),
          sizeBytes: body.length,
        });
      });
    } catch (error) {
      await this.deleteFiles([storageKey]);
      throw error;
    }
    const saved = (await this.proofs(locationId)).find((document) => document.id === documentId);
    if (!saved) throw new Error('Proof vanished right after insert');
    return saved;
  }

  async proofFile(
    userId: string,
    id: string,
    proofId: string,
  ): Promise<{ file: Buffer; fileName: string; contentType: string }> {
    const { id: locationId } = await this.owned(userId, id);
    if (!UUID.test(proofId)) throw listingNotFound();
    const [row] = await this.db
      .select()
      .from(proof)
      .where(and(eq(proof.id, proofId), eq(proof.locationId, locationId)));
    if (!row) throw listingNotFound();
    const file = await this.store.get(row.storageKey);
    if (!file) throw listingNotFound();
    return { file, fileName: row.fileName, contentType: row.contentType };
  }

  async removeProof(userId: string, id: string, proofId: string): Promise<void> {
    if (!UUID.test(proofId)) throw listingNotFound();
    const storageKey = await this.edit(userId, id, async (tx, row) => {
      const [removed] = await tx
        .delete(proof)
        .where(and(eq(proof.id, proofId), eq(proof.locationId, row.id)))
        .returning({ storageKey: proof.storageKey });
      if (!removed) throw listingNotFound();
      return removed.storageKey;
    });
    await this.deleteFiles([storageKey]);
  }

  async saveProofDetails(
    userId: string,
    id: string,
    { landRegistrationNumber }: ListingProofPatch,
  ): Promise<OwnerListingProgress> {
    await this.edit(userId, id, (tx, row) =>
      tx.update(listing).set({ landRegistrationNumber }).where(eq(listing.id, row.id)),
    );
    return this.progress(userId, id);
  }

  /**
   * Hands the listing to staff. Completeness is checked under the row lock every save takes, so
   * nothing it relied on can change before the commit. The worker sees the new status and sends
   * the email. Two listings with one name racing for a URL is the one retry here.
   */
  async submit(userId: string, id: string): Promise<OwnerListingProgress> {
    try {
      await this.handOver(userId, id, false);
    } catch (error) {
      if (!isUniqueViolation(error, 'parking_locations_slug_unique')) throw error;
      await this.handOver(userId, id, true);
    }
    return this.progress(userId, id);
  }

  private handOver(userId: string, id: string, forceSuffix: boolean): Promise<void> {
    return this.edit(userId, id, async (tx, row) => {
      const [owner] = await tx.select().from(profile).where(eq(profile.userId, userId));
      if (!owner) throw listingNotFound();
      const progress = (await this.progressOf([row], tx)).get(row.id);
      const missing = missingForSubmit(
        progress?.doneSteps ?? [],
        doneAccountSteps(profileFacts(owner)),
      );
      if (missing.length > 0) throw conflict('LISTING_INCOMPLETE', { missing });

      await tx
        .update(listing)
        .set({
          slug: await this.publicSlug(tx, row, forceSuffix),
          status: 'in_review',
          submittedAt: new Date(),
          reviewNote: null,
        })
        .where(eq(listing.id, row.id));
      await tx
        .update(profile)
        .set({ verification: 'pending' })
        .where(and(eq(profile.id, owner.id), eq(profile.verification, 'unverified')));
    });
  }

  /** A readable URL key: from the name, with a suffix if another listing has it. */
  private async publicSlug(tx: Reader, row: ListingRow, forceSuffix: boolean): Promise<string> {
    if (!row.slug.startsWith('draft-')) return row.slug;
    const base = slugFromName(row.name ?? '');
    const suffixed = `${base}-${row.id.slice(0, 8)}`;
    if (forceSuffix) return suffixed;
    const [taken] = await tx
      .select({ id: listing.id })
      .from(listing)
      .where(and(eq(listing.slug, base), ne(listing.id, row.id)));
    return taken ? suffixed : base;
  }

  private async progress(userId: string, id: string): Promise<OwnerListingProgress> {
    const row = await this.owned(userId, id);
    const progress = (await this.progressOf([row])).get(row.id);
    if (!progress) throw listingNotFound();
    return progress;
  }

  /** Counts per listing in one query per table, so the dashboard stays flat as listings grow. */
  private async progressOf(
    rows: ListingRow[],
    db: Reader = this.db,
  ): Promise<Map<string, OwnerListingProgress>> {
    const ids = rows.map((row) => row.id);
    const result = new Map<string, OwnerListingProgress>();
    if (ids.length === 0) return result;

    const countBy = async (
      table: typeof space | typeof hours | typeof photo | typeof proof,
    ): Promise<Map<string, number>> => {
      const counted = await db
        .select({ locationId: table.locationId, value: count() })
        .from(table)
        .where(inArray(table.locationId, ids))
        .groupBy(table.locationId);
      return new Map(counted.map(({ locationId, value }) => [locationId, value]));
    };
    const [spaces, periods, photos, proofs, covers] = await Promise.all([
      countBy(space),
      countBy(hours),
      countBy(photo),
      countBy(proof),
      db
        .selectDistinctOn([photo.locationId], {
          locationId: photo.locationId,
          key: photo.key,
          width: photo.width,
          height: photo.height,
          alt: photo.alt,
          color: photo.color,
        })
        .from(photo)
        .where(inArray(photo.locationId, ids))
        .orderBy(photo.locationId, asc(photo.position)),
    ]);
    const coverOf = new Map(covers.map(({ locationId, ...cover }) => [locationId, cover]));

    for (const row of rows) {
      const counts = {
        spaces: spaces.get(row.id) ?? 0,
        periods: periods.get(row.id) ?? 0,
        photos: photos.get(row.id) ?? 0,
        proofs: proofs.get(row.id) ?? 0,
      };
      result.set(row.id, this.progressFrom(row, counts, coverOf.get(row.id)));
    }
    return result;
  }

  private progressFrom(
    row: ListingRow,
    counts: StepCounts,
    cover: Cover | undefined,
  ): OwnerListingProgress {
    const done = doneListingSteps({
      status: row.status,
      location: {
        name: row.name ?? undefined,
        address: row.address ?? undefined,
        areaId: row.areaId ?? undefined,
        latitude: row.location?.latitude,
        longitude: row.location?.longitude,
        description: row.description,
        contentLocale: row.contentLocale,
      },
      hourlyRateMinor: row.hourlyRateMinor,
      cancellationPolicy: row.cancellationPolicy,
      spaces: counts.spaces,
      openingPeriods: counts.periods,
      photos: counts.photos,
      proofs: counts.proofs,
    });
    return OwnerListingProgressSchema.parse({
      id: row.id,
      name: row.name,
      contentLocale: row.contentLocale,
      status: row.status,
      slug: isEditable(row.status) && row.slug.startsWith('draft-') ? null : row.slug,
      coverPhoto: cover
        ? {
            key: cover.key,
            width: cover.width,
            height: cover.height,
            alt: cover.alt,
            color: cover.color,
          }
        : null,
      doneSteps: done,
      nextStep: nextListingStep(row.status, done),
      reviewNote: row.status === 'changes_requested' ? row.reviewNote : null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private async prices(row: ListingRow): Promise<OwnerPrices> {
    const [ruleRows, discountRows] = await Promise.all([
      this.db.select().from(rules).where(eq(rules.locationId, row.id)).orderBy(asc(rules.startsOn)),
      this.db
        .select({ minDays: discounts.minDays, percent: discounts.percent })
        .from(discounts)
        .where(eq(discounts.locationId, row.id))
        .orderBy(asc(discounts.minDays)),
    ]);
    const weekend = ruleRows.find((rule) => rule.kind === 'weekend');
    const night = ruleRows.find((rule) => rule.kind === 'night');
    return {
      hourlyRateMinor: row.hourlyRateMinor,
      dailyMaxMinor: row.dailyMaxMinor,
      bookingGapMinutes: row.bookingGapMinutes,
      cancellationPolicy: row.cancellationPolicy,
      weekendRateMinor: weekend?.hourlyRateMinor ?? null,
      night: night
        ? {
            rateMinor: night.hourlyRateMinor,
            from: wallTime(night.fromMinute ?? 0),
            to: wallTime(night.toMinute ?? 0),
          }
        : null,
      datedPrices: ruleRows.flatMap((rule) =>
        rule.kind === 'dated' && rule.startsOn && rule.endsOn
          ? [
              {
                label: rule.label,
                startsOn: rule.startsOn,
                endsOn: rule.endsOn,
                rateMinor: rule.hourlyRateMinor,
              },
            ]
          : [],
      ),
      longStayDiscounts: discountRows,
    };
  }

  /** Closures and special hours that have not ended on the listing's calendar, soonest first. */
  private exceptionRows(db: Reader, locationId: string, today: string) {
    return db
      .select()
      .from(exception)
      .where(and(eq(exception.locationId, locationId), gte(exception.endsOn, today)))
      .orderBy(asc(exception.startsOn));
  }

  private async hoursExceptions(
    db: Reader,
    row: Pick<ListingRow, 'id' | 'timeZone'>,
  ): Promise<OwnerHoursException[]> {
    const rows = await this.exceptionRows(db, row.id, zonedParts(new Date(), row.timeZone).date);
    return rows.map((row) => ({
      label: row.label,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      ...hoursOf(row),
    }));
  }

  private photos(db: Reader, id: string) {
    return db
      .select({
        id: photo.id,
        key: photo.key,
        width: photo.width,
        height: photo.height,
        alt: photo.alt,
        color: photo.color,
        position: photo.position,
      })
      .from(photo)
      .where(eq(photo.locationId, id))
      .orderBy(asc(photo.position), asc(photo.createdAt));
  }

  private async proofs(id: string): Promise<OwnerProof[]> {
    const rows = await this.db
      .select()
      .from(proof)
      .where(eq(proof.locationId, id))
      .orderBy(asc(proof.createdAt));
    return rows.map(({ id: documentId, kind, fileName, contentType, sizeBytes, createdAt }) => ({
      id: documentId,
      kind,
      fileName,
      // The column's CHECK holds it to this list.
      contentType: contentType as OwnerProof['contentType'],
      sizeBytes,
      createdAt: createdAt.toISOString(),
    }));
  }

  /** Files shared by content hash stay while another listing still shows them. */
  private async unusedPhotoFiles(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const stillUsed = await this.db
      .selectDistinct({ key: photo.key })
      .from(photo)
      .where(inArray(photo.key, keys));
    const used = new Set(stillUsed.map((row) => row.key));
    return keys.filter((key) => !used.has(key)).flatMap(photoObjectKeys);
  }

  /** After the commit, and never fatal: a stray file costs little, a failed delete request more. */
  private async deleteFiles(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.store.delete(keys);
    } catch (error) {
      const { name } = error as { name?: string };
      this.logger.error({ name, files: keys.length }, 'stored files not deleted');
    }
  }

  /** The listing, if this user owns it. Anything else is the same 404. */
  private async owned(userId: string, id: string): Promise<ListingRow> {
    if (!UUID.test(id)) throw listingNotFound();
    const [row] = await this.db
      .select({ listing })
      .from(listing)
      .innerJoin(profile, eq(profile.id, listing.ownerId))
      .where(and(eq(listing.id, id), eq(profile.userId, userId)));
    if (!row) throw listingNotFound();
    return row.listing;
  }

  /**
   * Every change to a listing: owned, still editable, and done under its row lock. The status is
   * read inside the lock, so a save that started before a submission can't land after it, and
   * a draft's `updated_at`, which the reminder reads, moves with every change. `anyStatus` is for
   * what an owner may change on a listing staff have or that is live; such a listing's row is
   * left alone, since rewriting it moves every one of its indexes, search's included.
   */
  private async edit<T>(
    userId: string,
    id: string,
    work: (tx: Transaction, row: ListingRow) => Promise<T>,
    { anyStatus = false }: { anyStatus?: boolean } = {},
  ): Promise<T> {
    const owned = await this.owned(userId, id);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(listing).where(eq(listing.id, owned.id)).for('update');
      if (!row || (!anyStatus && !isEditable(row.status))) throw conflict('LISTING_LOCKED');
      const result = await work(tx, row);
      if (isEditable(row.status)) {
        await tx.update(listing).set({ updatedAt: new Date() }).where(eq(listing.id, owned.id));
      }
      return result;
    });
  }
}
