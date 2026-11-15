import { z } from 'zod';
import {
  BOOKING_REFERENCE_PATTERN,
  BOOKINGS_CURSOR_PATTERN,
  parseBookingsCursor,
} from './bookings.js';
import { LocaleSchema } from './i18n.js';
import { MoneySchema } from './parking.js';
import { contractsRegistry } from './registry.js';
import { message } from './validation.js';

/**
 * What an owner has earned (5.1, #50, #51, #54): their own part of each booking, after Parkfairy's
 * commission, never another co-owner's. An amount is known once the worker has worked it out, 24
 * hours after the stay (#4); before that a booking is only counted (`coming`).
 */
export const EARNINGS_PAGE_SIZE = 20;
/** Months shown, this one included. */
export const EARNINGS_MONTHS = 12;
/**
 * Parts worked out and not yet sent are few: the worker sends them in its next sweep unless the
 * owner's account (#52) or a dispute (#58) holds them. Capped, so a stuck account can't make the
 * page unbounded.
 */
export const EARNINGS_IN_PROGRESS_MAX = 50;

/** Why a part worked out has not gone: the owner's account can't be paid, or a dispute holds it. */
export const EARNING_HOLDS = ['account', 'dispute'] as const;
export const EarningHoldSchema = z.enum(EARNING_HOLDS).register(contractsRegistry, {
  id: 'EarningHold',
});
export type EarningHold = z.infer<typeof EarningHoldSchema>;

export const EARNING_STATES = ['sending', 'sent'] as const;
export const EarningStateSchema = z.enum(EARNING_STATES).register(contractsRegistry, {
  id: 'EarningState',
});
export type EarningState = z.infer<typeof EarningStateSchema>;

const cursor = z
  .string(message('invalid'))
  .refine((place) => parseBookingsCursor(place) !== null, message('invalid'));

/** The sent parts after one place (when it was sent, and its id); none is the first page. */
export const OwnerEarningsQuerySchema = z
  .object({ after: cursor.optional() })
  .register(contractsRegistry, { id: 'OwnerEarningsQuery' });
export type OwnerEarningsQuery = z.infer<typeof OwnerEarningsQuerySchema>;

export const EarningListingSchema = z
  .object({
    id: z.uuid(),
    /** Null only if the owner has since emptied it, on a listing sent back to them. */
    name: z.string().nullable(),
    contentLocale: LocaleSchema,
  })
  .register(contractsRegistry, { id: 'EarningListing' });

/** One booking's part of the owner's money. */
export const EarningLineSchema = z
  .object({
    id: z.uuid(),
    reference: z.string().regex(BOOKING_REFERENCE_PATTERN),
    listing: EarningListingSchema,
    /** When the stay ended. */
    end: z.iso.datetime(),
    state: EarningStateSchema,
    /** The owner's part, after the commission: what was sent, or is to be. */
    amount: MoneySchema,
    /** When it was sent; null until then. */
    sentAt: z.iso.datetime().nullable(),
    /** Why a part worked out has not gone, if something holds it; always null once sent. */
    hold: EarningHoldSchema.nullable(),
  })
  .register(contractsRegistry, { id: 'EarningLine' });
export type EarningLine = z.infer<typeof EarningLineSchema>;

export const EarningMonthSchema = z
  .object({
    /** `2026-11`: the month the part was sent, in the platform's time zone. */
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    amount: MoneySchema,
  })
  .register(contractsRegistry, { id: 'EarningMonth' });

export const EarningListingTotalSchema = z
  .object({ listing: EarningListingSchema, amount: MoneySchema })
  .register(contractsRegistry, { id: 'EarningListingTotal' });

export const OwnerEarningsSchema = z
  .object({
    /** Everything sent to the owner, all time. */
    sent: MoneySchema,
    /** Worked out and not sent yet, held or on its way. */
    sending: MoneySchema,
    /** Paid bookings of the owner's whose part isn't worked out yet: a stay not over, or held. */
    coming: z.int().nonnegative(),
    /** Of those, due already and held back: by the owner's account (#52) or a dispute (#58). */
    held: z.object({ account: z.int().nonnegative(), dispute: z.int().nonnegative() }),
    /** The last EARNINGS_MONTHS months, newest first; a month with nothing sent is left out. */
    months: z.array(EarningMonthSchema).max(EARNINGS_MONTHS),
    /** Per listing, all time, most first. */
    listings: z.array(EarningListingTotalSchema).max(100),
    /** Parts worked out and not sent: the oldest first. */
    inProgress: z.array(EarningLineSchema).max(EARNINGS_IN_PROGRESS_MAX),
    /** Parts sent, newest first, a page at a time. */
    lines: z.array(EarningLineSchema).max(EARNINGS_PAGE_SIZE),
    /** `after` for the page that follows, null on the last. */
    next: z.string().regex(BOOKINGS_CURSOR_PATTERN).nullable(),
  })
  .register(contractsRegistry, { id: 'OwnerEarnings' });
export type OwnerEarnings = z.infer<typeof OwnerEarningsSchema>;
