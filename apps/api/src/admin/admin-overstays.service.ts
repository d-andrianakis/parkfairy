import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ADMIN_PAGE_SIZE,
  adminCursor,
  type AdminOverstay,
  type AdminOverstays,
  AdminOverstaySchema,
  type AdminOverstaysQuery,
  AdminOverstaysSchema,
  type AdminReasonInput,
  NAME_MAX_LENGTH,
  type OverstayStatus,
  parseBookingsCursor,
} from '@parkfairy/contracts';
import { type Database, recordAudit, schema } from '@parkfairy/database';
import { and, eq, sql } from 'drizzle-orm';

import { DB } from '../database/database.module.js';
import { isOwn } from './admin-listings.service.js';

const report = schema.overstayReports;
const booking = schema.bookings;
const listing = schema.parkingLocations;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refused(status: 403 | 404 | 409, code: string) {
  const body = { statusCode: status, message: code, code };
  if (status === 403) return new ForbiddenException({ ...body, error: 'Forbidden' });
  if (status === 404) return new NotFoundException({ ...body, error: 'Not Found' });
  return new ConflictException({ ...body, error: 'Conflict' });
}

/**
 * Staff's queue of overstay reports (5.2c4, #11, #76): what owners say about cars left past their
 * stays, oldest first, each closed with a note. Recorded and triaged only: closing one moves no
 * money and tells nobody, and the line of the audit log names the booking it was about. Staff close
 * other people's reports only, as they decide other people's listings (5.2a).
 */
@Injectable()
export class AdminOverstaysService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** A page of the queue by status, oldest report first, the next by the place the last gave out. */
  async list({ status, after }: AdminOverstaysQuery): Promise<AdminOverstays> {
    const place = after ? parseBookingsCursor(after) : null;
    const rows = await this.db
      .select({
        id: report.id,
        status: report.status,
        bookingId: booking.id,
        reference: booking.reference,
        listingName: booking.listingName,
        contentLocale: booking.listingLocale,
        endedAt: booking.endsAt,
        reportedAt: report.reportedAt,
      })
      .from(report)
      .innerJoin(booking, eq(booking.id, report.bookingId))
      .where(
        and(
          eq(report.status, status),
          // As a pair, so Postgres bounds the index on it.
          place
            ? sql`(${report.reportedAt}, ${report.id}) > (${place.start.toISOString()}::timestamptz, ${place.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(report.reportedAt, report.id)
      .limit(ADMIN_PAGE_SIZE + 1);
    const page = rows.slice(0, ADMIN_PAGE_SIZE);
    const last = page.at(-1);
    return AdminOverstaysSchema.parse({
      reports: page.map((row) => ({
        id: row.id,
        status: row.status,
        bookingId: row.bookingId,
        reference: row.reference,
        listingName: row.listingName,
        contentLocale: row.contentLocale,
        endedAt: row.endedAt.toISOString(),
        reportedAt: row.reportedAt.toISOString(),
      })),
      next: rows.length > ADMIN_PAGE_SIZE && last ? adminCursor(last.reportedAt, last.id) : null,
    });
  }

  /** One report, with the stay it is about. Reading it is not a line of the log: the driver isn't on it. */
  async open(adminId: string, id: string): Promise<AdminOverstay> {
    if (!UUID.test(id)) throw refused(404, 'OVERSTAY_NOT_FOUND');
    return this.read(adminId, id);
  }

  /**
   * Closes a report with a note (#76): once, under the report's lock, so two admins can't both.
   * Never one about a listing the admin runs. The line of the log is the booking's, since that
   * is where staff look for what was done about a stay.
   */
  async resolve(adminId: string, id: string, { note }: AdminReasonInput): Promise<AdminOverstay> {
    if (!UUID.test(id)) throw refused(404, 'OVERSTAY_NOT_FOUND');
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: report.id,
          status: report.status,
          bookingId: report.bookingId,
          reportedBy: report.reportedBy,
          reference: booking.reference,
          locationId: booking.locationId,
        })
        .from(report)
        .innerJoin(booking, eq(booking.id, report.bookingId))
        .where(eq(report.id, id))
        .for('update', { of: report });
      if (!row) throw refused(404, 'OVERSTAY_NOT_FOUND');
      const [mine] = await tx
        .select({ own: isOwn(adminId) })
        .from(listing)
        .where(eq(listing.id, row.locationId));
      // Nor one they made themselves, as an owner they no longer are.
      if (mine?.own || row.reportedBy === adminId) throw refused(403, 'OWN_LISTING');
      if (row.status !== 'open') throw refused(409, 'ALREADY_RESOLVED');
      await tx
        .update(report)
        .set({ status: 'resolved', resolvedBy: adminId, resolvedAt: new Date(), resolution: note })
        .where(eq(report.id, id));
      await recordAudit(tx, {
        actorId: adminId,
        action: 'overstay.resolved',
        targetType: 'booking',
        targetId: row.bookingId,
        details: { reference: row.reference, note },
      });
    });
    return this.read(adminId, id);
  }

  private async read(adminId: string, id: string): Promise<AdminOverstay> {
    const reporter = schema.users;
    const [row] = await this.db
      .select({
        r: report,
        b: booking,
        reporterName: sql<string>`left(${reporter.name}, ${NAME_MAX_LENGTH})`,
        resolverName: sql<
          string | null
        >`(select left(name, ${NAME_MAX_LENGTH}) from users where id = ${report.resolvedBy})`,
        own: isOwn(adminId),
      })
      .from(report)
      .innerJoin(booking, eq(booking.id, report.bookingId))
      .innerJoin(reporter, eq(reporter.id, report.reportedBy))
      .innerJoin(listing, eq(listing.id, booking.locationId))
      .where(eq(report.id, id));
    if (!row) throw refused(404, 'OVERSTAY_NOT_FOUND');
    const { r, b } = row;
    // A listing the admin runs, or a report they made themselves.
    const own = row.own || r.reportedBy === adminId;
    return AdminOverstaySchema.parse({
      id: r.id,
      status: r.status satisfies OverstayStatus,
      reportedAt: r.reportedAt.toISOString(),
      reporter: { name: row.reporterName },
      note: r.note,
      booking: {
        id: b.id,
        reference: b.reference,
        listing: {
          id: b.locationId,
          name: b.listingName,
          contentLocale: b.listingLocale,
        },
        spaceLabel: b.spaceLabel,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
      },
      resolution:
        r.status === 'resolved' && r.resolvedAt && r.resolution
          ? {
              at: r.resolvedAt.toISOString(),
              by: { name: row.resolverName ?? '' },
              note: r.resolution,
            }
          : null,
      canResolve: r.status === 'open' && !own,
      own,
    });
  }
}
