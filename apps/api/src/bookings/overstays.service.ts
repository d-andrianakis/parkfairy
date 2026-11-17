import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  OVERSTAY_REPORT_DAYS,
  type OverstayReportInput,
  type OwnerOverstay,
  OwnerOverstaySchema,
} from '@parkfairy/contracts';
import { type Database, schema } from '@parkfairy/database';
import { and, eq, sql } from 'drizzle-orm';

import { DB } from '../database/database.module.js';
import { conflict, listingNotFound } from '../owner/owner.errors.js';

const booking = schema.bookings;
const listing = schema.parkingLocations;
const reports = schema.overstayReports;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

function bookingNotFound() {
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Not Found',
    code: 'BOOKING_NOT_FOUND',
  });
}

/**
 * An owner reports a car left past its stay (5.2c4, #11, #76). Whoever runs the listing may: its
 * owners, a co-owner or a manager, as for cancelling a booking, and as there another listing's
 * booking is the same 404 as one that doesn't exist. The stay must be over, and not so long ago that
 * staff could no longer look into it (`OVERSTAY_REPORT_DAYS`). One report to a booking. Nothing
 * else happens: no email, no money, and the driver doesn't hear of it.
 */
@Injectable()
export class OverstaysService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async report(
    userId: string,
    listingId: string,
    bookingId: string,
    { note }: OverstayReportInput,
  ): Promise<OwnerOverstay> {
    if (!UUID.test(listingId)) throw listingNotFound();
    if (!UUID.test(bookingId)) throw bookingNotFound();
    const reported = await this.db.transaction(async (tx) => {
      // The listing's lock first, as every path takes them, then whether this is still one of those
      // who run it, read after the lock: one statement would see them as they were before the wait,
      // and someone removed meanwhile would still report.
      const [locked] = await tx
        .select({ id: listing.id })
        .from(listing)
        .where(eq(listing.id, listingId))
        .for('share');
      if (!locked) throw listingNotFound();
      const joined = await tx.execute<{ joined: string | null }>(sql`
        select min(created_at)::text as joined from (
          select lo.created_at from listing_owners lo
            join owner_profiles p on p.id = lo.owner_id
            where lo.location_id = ${listingId} and p.user_id = ${userId}
          union all
          select lm.created_at from listing_managers lm
            where lm.location_id = ${listingId} and lm.user_id = ${userId}
        ) mine
      `);
      const since = joined.rows[0]?.joined;
      if (!since) throw listingNotFound();

      const [current] = await tx
        .select({ status: booking.status, endsAt: booking.endsAt })
        .from(booking)
        .where(and(eq(booking.id, bookingId), eq(booking.locationId, listingId)))
        .for('share');
      // What was never a booking, or was called off, was not overstayed. A stay that ended before this
      // account joined the listing is none of theirs to read (#35), so none to report.
      if (current?.status !== 'confirmed' || current.endsAt <= new Date(since)) {
        throw bookingNotFound();
      }
      const now = new Date();
      if (current.endsAt > now) throw conflict('BOOKING_NOT_ENDED');
      if (now.getTime() - current.endsAt.getTime() > OVERSTAY_REPORT_DAYS * DAY_MS) {
        throw conflict('OVERSTAY_TOO_LATE');
      }
      // To the millisecond, as the queue's places are.
      const [made] = await tx
        .insert(reports)
        .values({ bookingId, reportedBy: userId, reportedAt: now, note })
        .onConflictDoNothing({ target: reports.bookingId })
        .returning({ reportedAt: reports.reportedAt, status: reports.status });
      if (!made) throw conflict('OVERSTAY_REPORTED');
      return made;
    });
    return OwnerOverstaySchema.parse({
      reportedAt: reported.reportedAt.toISOString(),
      status: reported.status,
    });
  }
}
