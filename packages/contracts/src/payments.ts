import { z } from 'zod';
import { LocaleSchema } from './i18n.js';
import { contractsRegistry } from './registry.js';

/**
 * Payments (Phase 4), in Stripe's test mode until #18 and #19 are answered (memory.md #46). The
 * driver pays in full at booking (decision #3), on the platform's account; the owner is paid by a
 * transfer to their Express account after the stay (#4, #6, #48).
 */

/**
 * How a held booking becomes a booking: `payment` in Stripe's Payment Element (#49); `confirm` by
 * the stand-in press that charges nothing, on a local run without Stripe (#33, #47).
 */
export const CHECKOUT_KINDS = ['payment', 'confirm'] as const;
export const CheckoutKindSchema = z.enum(CHECKOUT_KINDS).register(contractsRegistry, {
  id: 'CheckoutKind',
});
export type CheckoutKind = z.infer<typeof CheckoutKindSchema>;

/**
 * Where a booking's payment stands, as Stripe last told us. `pending`: asked for, not paid yet (or
 * a card declined, which the driver may try again); `processing`: paid, the bank still deciding;
 * `succeeded`: the money is in; `refunding`: it goes back, decided and Stripe being asked (kept so
 * a refund that failed half way is finished, and nothing confirms the booking meanwhile);
 * `refunded`: all of it went back (a late payment for a space taken meanwhile, decision #3);
 * `canceled`: never paid, and called off at Stripe once its hold lapsed, so it can't be now.
 */
export const PAYMENT_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'refunding',
  'refunded',
  'canceled',
] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES).register(contractsRegistry, {
  id: 'PaymentStatus',
});
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/**
 * A cancellation's refund at Stripe (4.2): `owed` in the cancel's own transaction, `sent` once
 * Stripe has it. The worker sends what is still owed. `failed`: Stripe took it and it failed later
 * (a closed card, say), the money back with the platform; support's to settle with the driver.
 */
export const REFUND_STATUSES = ['owed', 'sent', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * The owner's share at Stripe (#4): `sending` once worked out and asked for, `sent` once Stripe
 * made the transfer. A `sending` one is asked again, never made twice (idempotency, then a look).
 */
export const TRANSFER_STATUSES = ['sending', 'sent'] as const;

/**
 * A dispute's state, as Stripe has it (4.3, #57–#60). `warning_*` are inquiries before a
 * chargeback. Settled: won, lost, `warning_closed` and `prevented`; an open or lost one holds the
 * booking's payout (#58), a lost one for support to decide (#57).
 */
export const DISPUTE_STATUSES = [
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
  'prevented',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
/** A dispute that leaves the booking's money where it was: its payout may go. */
export const DISPUTES_RELEASED = ['won', 'warning_closed', 'prevented'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** What the booking page needs to take the payment. */
export const BookingPaymentSchema = z
  .object({
    /**
     * For the Payment Element, which confirms the payment from the browser. A secret for this one
     * payment: never logged, cached or stored by us.
     */
    clientSecret: z.string().regex(/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/),
    /** Asked again after paying: not `pending`, and the page settles it instead of paying twice. */
    status: PaymentStatusSchema,
  })
  .register(contractsRegistry, { id: 'BookingPayment' });
export type BookingPayment = z.infer<typeof BookingPaymentSchema>;

/**
 * An owner's payout account, an Express account at Stripe (#48). `none`: not started; `pending`:
 * details sent, Stripe still checking; `restricted`: Stripe needs more from the owner; `active`:
 * transfers can be paid to it, and drivers can book the owner's listings.
 */
export const PAYOUT_STATUSES = ['none', 'pending', 'restricted', 'active'] as const;
export const PayoutStatusSchema = z.enum(PAYOUT_STATUSES).register(contractsRegistry, {
  id: 'PayoutStatus',
});
export type PayoutStatus = z.infer<typeof PayoutStatusSchema>;

export const OwnerPayoutsSchema = z
  .object({
    /** Whether payouts can be set up here at all: Stripe is configured (#47). */
    available: z.boolean(),
    status: PayoutStatusSchema,
  })
  .register(contractsRegistry, { id: 'OwnerPayouts' });
export type OwnerPayouts = z.infer<typeof OwnerPayoutsSchema>;

/** The language the owner's pages are in, for where Stripe sends them back to. */
export const PayoutLinkInputSchema = z
  .object({ locale: LocaleSchema })
  .register(contractsRegistry, { id: 'PayoutLinkInput' });
export type PayoutLinkInput = z.infer<typeof PayoutLinkInputSchema>;

/** A one-time link to Stripe: onboarding, or the owner's Express dashboard. */
export const PayoutLinkSchema = z
  .object({ url: z.url({ protocol: /^https$/ }) })
  .register(contractsRegistry, { id: 'PayoutLink' });
export type PayoutLink = z.infer<typeof PayoutLinkSchema>;

/** Every `code` a payment or payout route answers with, for clients to translate. */
export const PAYMENT_ERROR_CODES = [
  /** Stripe isn't configured here (#47). */
  'PAYMENTS_UNAVAILABLE',
  /** Payouts need the owner's profile first: who they are decides the account's kind. */
  'PROFILE_REQUIRED',
  /** The dashboard link needs an account that finished onboarding. */
  'PAYOUTS_NOT_STARTED',
  /** Stripe failed or was too slow; nothing was charged. */
  'PAYMENT_PROVIDER_ERROR',
] as const;
export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number];
