import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ADMIN_PAGE_SIZE,
  type AdminChangesInput,
  adminCursor,
  type AdminListingReview,
  AdminListingReviewSchema,
  type AdminQueue,
  type AdminQueueQuery,
  AdminQueueSchema,
  type AdminReasonInput,
  type AdminSuspendListingInput,
  parseBookingsCursor,
  SHARE_BPS_PER_PERCENT,
} from '@parkfairy/contracts';
import { type Database, recordAudit, runsListing, schema } from '@parkfairy/database';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { BookingsService } from '../bookings/bookings.service.js';
import { DB } from '../database/database.module.js';
import type { FieldCrypto } from '../owner/field-crypto.js';
import { FIELD_CRYPTO } from '../owner/field-crypto.provider.js';
import { everyoneReported } from '../owner/listing-owners.service.js';
import { doneAccountSteps } from '../owner/onboarding-progress.js';
import { listingNotFound } from '../owner/owner.errors.js';
import { profileFacts } from '../owner/owner-profile.service.js';
import { OBJECT_STORE, type ObjectStore } from '../storage/object-store.js';

const listing = schema.parkingLocations;
const owners = schema.listingOwners;
const profile = schema.ownerProfiles;
const users = schema.users;
const proof = schema.parkingProofDocuments;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tax values reach staff as their last characters, as they reach the owner (#67). */
const ENDING_LENGTH = 3;

/**
 * The admin owns or manages the listing, or is the profile it names as its owner: staff never
 * decide their own. The last is a belt over the owners' rows, which every listing has.
 */
const isOwn = (adminId: string) => sql<boolean>`(
  ${runsListing(adminId)}
  or ${listing.ownerId} in (select id from owner_profiles where user_id = ${adminId})
)`;

function refused(status: 403 | 404 | 409, code: string) {
  const body = { statusCode: status, message: code, code };
  if (status === 403) return new ForbiddenException({ ...body, error: 'Forbidden' });
  if (status === 404) return new NotFoundException({ ...body, error: 'Not Found' });
  return new ConflictException({ ...body, error: 'Conflict' });
}

/**
 * Staff review of the listings people sent in (5.2, #66–#68). Every action is written to the audit
 * log in its own transaction, and staff never decide a listing they own or manage. Drafts are the
 * owner's alone: nothing here shows one.
 */
@Injectable()
export class AdminListingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly bookings: BookingsService,
  ) {}

  /** Listings in one status, the oldest sent in first: what is waiting longest comes first. */
  async queue({ status, after }: AdminQueueQuery): Promise<AdminQueue> {
    const place = after ? parseBookingsCursor(after) : null;
    const rows = await this.db.execute<{
      id: string;
      status: AdminQueue['listings'][number]['status'];
      name: string | null;
      address: string | null;
      content_locale: 'el' | 'en';
      owner: string | null;
      at: string;
      sent: string | null;
    }>(sql`
      select l.id, l.status, l.name, l.address, l.content_locale, u.name as owner,
        date_trunc('milliseconds', coalesce(l.submitted_at, l.created_at))::text as at, l.submitted_at::text as sent
      from parking_locations l
      left join owner_profiles p on p.id = l.owner_id
      left join users u on u.id = p.user_id
      where l.status = ${status}
        ${
          place
            ? sql`and (date_trunc('milliseconds', coalesce(l.submitted_at, l.created_at)), l.id) > (${place.start.toISOString()}::timestamptz, ${place.id}::uuid)`
            : sql``
        }
      order by date_trunc('milliseconds', coalesce(l.submitted_at, l.created_at)), l.id
      limit ${ADMIN_PAGE_SIZE + 1}
    `);
    const page = rows.rows.slice(0, ADMIN_PAGE_SIZE);
    const last = page.at(-1);
    return AdminQueueSchema.parse({
      listings: page.map((row) => ({
        id: row.id,
        status: row.status,
        name: row.name,
        address: row.address,
        contentLocale: row.content_locale,
        owner: row.owner,
        submittedAt: row.sent ? new Date(row.sent).toISOString() : null,
      })),
      next:
        rows.rows.length > ADMIN_PAGE_SIZE && last ? adminCursor(new Date(last.at), last.id) : null,
    });
  }

  async review(adminId: string, id: string): Promise<AdminListingReview> {
    return this.read(this.db, adminId, id);
  }

  /**
   * A proof of the right to rent, as a download: a deed or a lease names people and their tax
   * numbers, so opening one is a line in the log. The file is read first and the line written
   * before it is handed over, so a file that can't be read is not recorded as opened.
   */
  async proofFile(
    adminId: string,
    id: string,
    proofId: string,
  ): Promise<{ file: Buffer; fileName: string; contentType: string }> {
    if (!UUID.test(id) || !UUID.test(proofId)) throw refused(404, 'PROOF_NOT_FOUND');
    const [row] = await this.db
      .select({ proof })
      .from(proof)
      .innerJoin(listing, eq(listing.id, proof.locationId))
      .where(
        and(eq(proof.id, proofId), eq(proof.locationId, id), sql`${listing.status} <> 'draft'`),
      );
    if (!row) throw refused(404, 'PROOF_NOT_FOUND');
    const file = await this.store.get(row.proof.storageKey);
    if (!file) throw refused(404, 'PROOF_NOT_FOUND');
    await this.db.transaction((tx) =>
      recordAudit(tx, {
        actorId: adminId,
        action: 'listing.proof_opened',
        targetType: 'listing',
        targetId: id,
        details: { proofId, kind: row.proof.kind },
      }),
    );
    return { file, fileName: row.proof.fileName, contentType: row.proof.contentType };
  }

  /** Publishes a listing that is in review, and verifies the owners accountable for it. */
  async approve(adminId: string, id: string): Promise<AdminListingReview> {
    return this.decide(adminId, id, async (tx, row) => {
      // The primary and everyone paid a share: their details and proof of the right to rent were
      // what the review was of (#22).
      const accountable = await tx
        .select({ id: owners.ownerId })
        .from(owners)
        .where(
          and(
            eq(owners.locationId, row.id),
            sql`(${owners.role} = 'primary' or ${owners.shareBps} > 0)`,
          ),
        );
      // Read again under the profiles' locks: an owner who emptied their details since they sent it
      // in can't be verified, and one editing them waits for this to finish.
      if (
        !(await everyoneReported(
          tx,
          accountable.map((owner) => owner.id),
        ))
      ) {
        throw refused(409, 'OWNER_DETAILS_MISSING');
      }
      await tx
        .update(listing)
        .set({ status: 'published', reviewNote: null })
        .where(eq(listing.id, row.id));
      const verified = await tx
        .update(profile)
        .set({ verification: 'verified' })
        .where(
          and(
            inArray(
              profile.id,
              accountable.map((owner) => owner.id),
            ),
            eq(profile.verification, 'pending'),
          ),
        )
        .returning({ id: profile.id });
      await recordAudit(tx, {
        actorId: adminId,
        action: 'listing.approved',
        targetType: 'listing',
        targetId: row.id,
        details: { from: 'in_review', ownersVerified: verified.length },
      });
    });
  }

  /** Sends a listing back to its owner with what to change; the owner is told by the status sweep. */
  async requestChanges(
    adminId: string,
    id: string,
    { note }: AdminChangesInput,
  ): Promise<AdminListingReview> {
    return this.decide(adminId, id, async (tx, row) => {
      await tx
        .update(listing)
        .set({ status: 'changes_requested', reviewNote: note })
        .where(eq(listing.id, row.id));
      // The note stays here: the listing's own is cleared when the owner sends it in again.
      await recordAudit(tx, {
        actorId: adminId,
        action: 'listing.changes_requested',
        targetType: 'listing',
        targetId: row.id,
        details: { from: 'in_review', note },
      });
    });
  }

  /**
   * Takes a live listing down (#78): out of search, not bookable, its note read by its owners (#79),
   * the primary owner told, and, if staff chose, every upcoming booking called off with the drivers
   * refunded in full. One transaction under the listing's lock: nothing is booked between the choice
   * and the suspension. Never a listing staff own or manage.
   */
  async suspend(
    adminId: string,
    id: string,
    { note, cancelBookings }: AdminSuspendListingInput,
  ): Promise<AdminListingReview> {
    await this.moderate(adminId, id, 'published', 'NOT_PUBLISHED', async (tx, row) => {
      await tx
        .update(listing)
        .set({ status: 'suspended', reviewNote: note, notifiedStatus: 'suspended' })
        .where(eq(listing.id, row.id));
      const cancelled = cancelBookings
        ? await this.bookings.cancelUpcomingForStaff(tx, adminId, row.id)
        : 0;
      await this.tellPrimary(tx, row.id, 'listing-suspended');
      await recordAudit(tx, {
        actorId: adminId,
        action: 'listing.suspended',
        targetType: 'listing',
        targetId: row.id,
        details: { from: 'published', note, cancelBookings, bookingsCancelled: cancelled },
      });
    });
    return this.read(this.db, adminId, id);
  }

  /** Brings a suspended listing back (#81): live again, its owner told, the note for the log alone. */
  async reinstate(
    adminId: string,
    id: string,
    { note }: AdminReasonInput,
  ): Promise<AdminListingReview> {
    await this.moderate(adminId, id, 'suspended', 'NOT_SUSPENDED', async (tx, row) => {
      await tx
        .update(listing)
        .set({ status: 'published', reviewNote: null, notifiedStatus: 'published' })
        .where(eq(listing.id, row.id));
      await this.tellPrimary(tx, row.id, 'listing-reinstated');
      await recordAudit(tx, {
        actorId: adminId,
        action: 'listing.reinstated',
        targetType: 'listing',
        targetId: row.id,
        details: { from: 'suspended', note },
      });
    });
    return this.read(this.db, adminId, id);
  }

  /**
   * A change of a listing's life that is staff's to make, under its row lock: never a draft, never
   * their own, and only from the status the change starts at (a second admin finds it done).
   */
  private async moderate(
    adminId: string,
    id: string,
    from: 'published' | 'suspended',
    wrongStatus: 'NOT_PUBLISHED' | 'NOT_SUSPENDED',
    work: (tx: Transaction, row: { id: string }) => Promise<void>,
  ): Promise<void> {
    if (!UUID.test(id)) throw listingNotFound();
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: listing.id, status: listing.status })
        .from(listing)
        .where(eq(listing.id, id))
        .for('update');
      if (!row || row.status === 'draft') throw listingNotFound();
      const [mine] = await tx
        .select({ own: isOwn(adminId) })
        .from(listing)
        .where(eq(listing.id, id));
      if (mine?.own) throw refused(403, 'OWN_LISTING');
      if (row.status !== from) throw refused(409, wrongStatus);
      await work(tx, row);
    });
  }

  /**
   * The email to a listing's primary owner (its words and its link are the same for every listing:
   * its name is theirs, and the reason is on the page the button opens). Written in the change's
   * own transaction, with a key of its own each time: a listing can be taken down and brought back
   * more than once, and the status sweep has been told (`notified_status`), so it sends nothing.
   */
  private async tellPrimary(
    tx: Transaction,
    listingId: string,
    kind: 'listing-suspended' | 'listing-reinstated',
  ): Promise<void> {
    const [lead] = await tx
      .select({ userId: profile.userId, name: listing.name, contentLocale: listing.contentLocale })
      .from(listing)
      .innerJoin(profile, eq(profile.id, listing.ownerId))
      .where(eq(listing.id, listingId));
    if (!lead) return;
    await tx
      .insert(schema.emailOutbox)
      .values({
        kind,
        userId: lead.userId,
        payload: { listingName: lead.name ?? undefined, contentLocale: lead.contentLocale },
        dedupeKey: `${kind}:${listingId}:${randomUUID()}`,
      })
      .onConflictDoNothing({ target: schema.emailOutbox.dedupeKey });
  }

  /**
   * A decision on a listing in review, under its row lock: a second admin deciding at once finds it
   * decided (`NOT_IN_REVIEW`), and the change and its audit line are one transaction.
   */
  private async decide(
    adminId: string,
    id: string,
    work: (tx: Transaction, row: { id: string }) => Promise<void>,
  ): Promise<AdminListingReview> {
    if (!UUID.test(id)) throw listingNotFound();
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: listing.id, status: listing.status })
        .from(listing)
        .where(eq(listing.id, id))
        .for('update');
      if (!row || row.status === 'draft') throw listingNotFound();
      const [mine] = await tx
        .select({ own: isOwn(adminId) })
        .from(listing)
        .where(eq(listing.id, id));
      if (mine?.own) throw refused(403, 'OWN_LISTING');
      if (row.status !== 'in_review') throw refused(409, 'NOT_IN_REVIEW');
      await work(tx, row);
    });
    // Read once it is committed, on the pool: a transaction has one connection, and its queries
    // would take turns on it however they are asked.
    return this.read(this.db, adminId, id);
  }

  private async read(db: Database, adminId: string, id: string): Promise<AdminListingReview> {
    if (!UUID.test(id)) throw listingNotFound();
    const [row] = await db.select().from(listing).where(eq(listing.id, id));
    if (!row || row.status === 'draft') throw listingNotFound();
    // A few at a time: the API's pool is small, and a page of staff is not worth six connections.
    const [people, proofs, spaces] = await Promise.all([
      db
        .select({
          role: owners.role,
          shareBps: owners.shareBps,
          account: users.name,
          profile,
        })
        .from(owners)
        .innerJoin(profile, eq(profile.id, owners.ownerId))
        .innerJoin(users, eq(users.id, profile.userId))
        .where(eq(owners.locationId, id))
        .orderBy(sql`${owners.role} = 'primary' desc`, asc(owners.createdAt)),
      db
        .select()
        .from(proof)
        .where(eq(proof.locationId, id))
        .orderBy(asc(proof.createdAt), asc(proof.id)),
      db
        .select({ label: schema.parkingSpaces.label })
        .from(schema.parkingSpaces)
        .where(eq(schema.parkingSpaces.locationId, id))
        .orderBy(asc(schema.parkingSpaces.label)),
    ]);
    const [photos, own, upcoming] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.parkingPhotos)
        .where(eq(schema.parkingPhotos.locationId, id)),
      db
        .select({ own: isOwn(adminId) })
        .from(listing)
        .where(eq(listing.id, id)),
      // What suspending may cancel: confirmed, not yet started (`bookings_location_starts_id_idx`).
      // Only a live listing can be suspended, so only its page asks.
      row.status === 'published'
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.bookings)
            .where(
              and(
                eq(schema.bookings.locationId, id),
                eq(schema.bookings.status, 'confirmed'),
                sql`${schema.bookings.startsAt} > now()`,
              ),
            )
        : Promise.resolve([{ count: 0 }]),
    ]);
    const ending = (rowId: string, field: string, stored: string | null) =>
      stored === null
        ? null
        : this.crypto.decrypt(stored, `${rowId}:${field}`).slice(-ENDING_LENGTH);
    return AdminListingReviewSchema.parse({
      id: row.id,
      status: row.status,
      name: row.name,
      description: row.description,
      address: row.address,
      areaId: row.areaId,
      contentLocale: row.contentLocale,
      landRegistrationNumber: row.landRegistrationNumber,
      hourlyRate:
        row.hourlyRateMinor === null
          ? null
          : { amountMinor: row.hourlyRateMinor, currency: row.currency },
      spaces: spaces.map((space) => space.label),
      photos: photos[0]?.count ?? 0,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      owners: people.map(({ role, shareBps, account, profile: p }) => ({
        role,
        accountName: account,
        kind: p.kind,
        firstName: p.firstName,
        lastName: p.lastName,
        legalName: p.legalName,
        country: p.country,
        taxCountry: p.taxCountry,
        taxIdEnding: ending(p.id, 'taxId', p.taxIdEncrypted),
        vatIdEnding: ending(p.id, 'vatId', p.vatIdEncrypted),
        registrationEnding: ending(p.id, 'registrationNumber', p.registrationNumberEncrypted),
        verification: p.verification,
        sharePercent: shareBps / SHARE_BPS_PER_PERCENT,
        detailsComplete: doneAccountSteps(profileFacts(p)).length === 2,
      })),
      proofs: proofs.map((file) => ({
        id: file.id,
        kind: file.kind,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        createdAt: file.createdAt.toISOString(),
      })),
      canDecide: row.status === 'in_review',
      canSuspend: row.status === 'published' && own[0]?.own !== true,
      canReinstate: row.status === 'suspended' && own[0]?.own !== true,
      upcomingBookings: upcoming[0]?.count ?? 0,
      own: own[0]?.own === true,
    });
  }
}
