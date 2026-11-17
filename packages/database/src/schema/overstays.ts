/**
 * Overstay reports (5.2c4, #11, #76): an owner says a car stayed past its booking, and staff close
 * the report with a note. A record and a queue, nothing more: no money moves because of one, and the
 * driver isn't told. One report to a booking, kept for good with the booking it is about (restrict,
 * as the booking's own references are), so staff can always say what was reported and who closed it.
 */
import {
  ADMIN_REASON_NOTE_MAX,
  OVERSTAY_NOTE_MAX,
  OVERSTAY_STATUSES,
  type OverstayStatus,
} from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { bookings } from './bookings.js';

/** `'a', 'b'` list for CHECK constraints built from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const instant = (name: string) => timestamp(name, { withTimezone: true });

export const overstayReports = pgTable(
  'overstay_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** One report to a booking: a second is refused, so two owners can't fill the queue. */
    bookingId: uuid('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    /** The owner, co-owner or manager who reported it. Restricted, like the staff who closed it. */
    reportedBy: uuid('reported_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Written by the API to the millisecond: a page of the queue names its place exactly. */
    reportedAt: instant('reported_at').notNull(),
    /** What the reporter wrote: for staff only. */
    note: text('note').notNull(),
    status: text('status').$type<OverstayStatus>().notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'restrict' }),
    resolvedAt: instant('resolved_at'),
    /** Staff's note, for the log and the next person to read the report: never shown to owners. */
    resolution: text('resolution'),
  },
  (t) => [
    // The queue: open reports, oldest first, a page at a time by place.
    index('overstay_reports_open_idx')
      .on(t.reportedAt, t.id)
      .where(sql`${t.status} = 'open'`),
    // And the closed ones, in the same order.
    index('overstay_reports_resolved_idx')
      .on(t.reportedAt, t.id)
      .where(sql`${t.status} = 'resolved'`),
    // Deleting an account that closed reports checks this; the reporter's is covered by the same need.
    index('overstay_reports_reported_by_idx').on(t.reportedBy),
    index('overstay_reports_resolved_by_idx')
      .on(t.resolvedBy)
      .where(sql`${t.resolvedBy} is not null`),
    check('overstay_reports_status_check', sql`${t.status} in (${sqlList(OVERSTAY_STATUSES)})`),
    check(
      'overstay_reports_note_check',
      sql`char_length(${t.note}) between 1 and ${sql.raw(String(OVERSTAY_NOTE_MAX))}`,
    ),
    // Open has no closing; resolved has all of it. Nulls stated: a CHECK passes on null.
    check(
      'overstay_reports_resolution_check',
      sql`case when ${t.status} = 'resolved' then ${t.resolvedBy} is not null and ${t.resolvedAt} is not null and ${t.resolution} is not null and char_length(${t.resolution}) between 1 and ${sql.raw(String(ADMIN_REASON_NOTE_MAX))} else ${t.resolvedBy} is null and ${t.resolvedAt} is null and ${t.resolution} is null end`,
    ),
  ],
);
