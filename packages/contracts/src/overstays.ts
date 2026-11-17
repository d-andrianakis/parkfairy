import { z } from 'zod';

import { ADMIN_PAGE_SIZE, ADMIN_REASON_NOTE_MAX, staffNote } from './admin.js';
import { BOOKING_REFERENCE_PATTERN, parseBookingsCursor } from './bookings.js';
import { LocaleSchema } from './i18n.js';
import { contractsRegistry } from './registry.js';
import { message, NAME_MAX_LENGTH } from './validation.js';

/**
 * Overstays (5.2c4, #11, #76): a driver's car still in a space after the stay it was booked for.
 * The owner reports it, staff see a queue and close each report with a note. A report is recorded
 * and triaged only: nothing is charged, refunded or held by it, and the driver is not told.
 */
export const OVERSTAY_STATUSES = ['open', 'resolved'] as const;
export const OverstayStatusSchema = z
  .enum(OVERSTAY_STATUSES)
  .register(contractsRegistry, { id: 'OverstayStatus' });
export type OverstayStatus = z.infer<typeof OverstayStatusSchema>;

/** What an owner says: how long, which car, what they did. Staff read it; nobody else does. */
export const OVERSTAY_NOTE_MAX = 300;

/**
 * How long after a stay ended it may still be reported: our reading (not asked), so that a report
 * is about something staff can still look into and the next driver can still be made whole.
 */
export const OVERSTAY_REPORT_DAYS = 14;

/** The `code`s the owners' report route answers with besides the owner area's usual ones. */
export const OVERSTAY_ERROR_CODES = [
  /** An overstay is reported once the stay is over. */
  'BOOKING_NOT_ENDED',
  /** …and within `OVERSTAY_REPORT_DAYS` of its end. */
  'OVERSTAY_TOO_LATE',
  /** One report to a booking. */
  'OVERSTAY_REPORTED',
] as const;

/** Who may report: whoever runs the listing, once the stay is over (`BOOKING_NOT_ENDED`). */
export const OverstayReportInputSchema = z
  .object({ note: staffNote(OVERSTAY_NOTE_MAX) })
  .strict()
  .register(contractsRegistry, { id: 'OverstayReportInput' });
export type OverstayReportInput = z.infer<typeof OverstayReportInputSchema>;

/**
 * What the owners' list says of a booking's report: that there is one, since when, and whether
 * support has closed it. Staff's own note stays with staff.
 */
export const OwnerOverstaySchema = z
  .object({
    reportedAt: z.iso.datetime(),
    status: OverstayStatusSchema,
  })
  .register(contractsRegistry, { id: 'OwnerOverstay' });
export type OwnerOverstay = z.infer<typeof OwnerOverstaySchema>;

/** The queue shows open reports, or the ones closed. */
export const AdminOverstaysQuerySchema = z
  .object({
    status: OverstayStatusSchema.default('open'),
    after: z
      .string(message('invalid'))
      .refine((place) => parseBookingsCursor(place) !== null, message('invalid'))
      .optional(),
  })
  .register(contractsRegistry, { id: 'AdminOverstaysQuery' });
export type AdminOverstaysQuery = z.infer<typeof AdminOverstaysQuerySchema>;

/** A row of the queue: no driver, no plate, no note. Those are on the report and the booking. */
export const AdminOverstayItemSchema = z
  .object({
    id: z.uuid(),
    status: OverstayStatusSchema,
    bookingId: z.uuid(),
    reference: z.string().regex(BOOKING_REFERENCE_PATTERN),
    listingName: z.string().nullable(),
    contentLocale: LocaleSchema,
    /** When the stay ended: what the owner says it overran. */
    endedAt: z.iso.datetime(),
    /** When it was reported: what the queue is ordered by, oldest first. */
    reportedAt: z.iso.datetime(),
  })
  .register(contractsRegistry, { id: 'AdminOverstayItem' });
export type AdminOverstayItem = z.infer<typeof AdminOverstayItemSchema>;

export const AdminOverstaysSchema = z
  .object({
    reports: z.array(AdminOverstayItemSchema).max(ADMIN_PAGE_SIZE),
    /** `after` for the page that follows, null on the last. */
    next: z.string().nullable(),
  })
  .register(contractsRegistry, { id: 'AdminOverstays' });
export type AdminOverstays = z.infer<typeof AdminOverstaysSchema>;

/**
 * A report as staff read it: who made it and what they wrote, the stay it is about, and how it was
 * closed. The driver is not here: their page is the booking's, and opening it is logged.
 */
export const AdminOverstaySchema = z
  .object({
    id: z.uuid(),
    status: OverstayStatusSchema,
    reportedAt: z.iso.datetime(),
    /** The reporter's account name, and what they wrote: their own words. */
    reporter: z.object({ name: z.string().max(NAME_MAX_LENGTH) }),
    note: z.string().max(OVERSTAY_NOTE_MAX),
    booking: z.object({
      id: z.uuid(),
      reference: z.string().regex(BOOKING_REFERENCE_PATTERN),
      /** The listing as it was when booked. */
      listing: z.object({
        id: z.uuid(),
        name: z.string().nullable(),
        contentLocale: LocaleSchema,
      }),
      spaceLabel: z.string(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
    }),
    resolution: z
      .object({
        at: z.iso.datetime(),
        by: z.object({ name: z.string().max(NAME_MAX_LENGTH) }),
        note: z.string().max(ADMIN_REASON_NOTE_MAX),
      })
      .nullable(),
    /** Open, and not the reader's own listing (staff decide other people's, as for a review). */
    canResolve: z.boolean(),
    /** The reader owns, co-owns or manages the listing: someone else has to close it. */
    own: z.boolean(),
  })
  .register(contractsRegistry, { id: 'AdminOverstay' });
export type AdminOverstay = z.infer<typeof AdminOverstaySchema>;
