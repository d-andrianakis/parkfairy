import { Inject, Injectable, Logger } from '@nestjs/common';
import { type CancellationPolicy, DEFAULT_TIME_ZONE } from '@parkfairy/contracts';
import { type Database, markEvidenceStaged, recordDispute, schema } from '@parkfairy/database';
import type { DisputeEvidence, DisputeState, PaymentsGateway } from '@parkfairy/payments';
import { eq } from 'drizzle-orm';

import { DB } from '../database/database.module.js';
import { PAYMENTS } from './payments.tokens.js';

const booking = schema.bookings;
const users = schema.users;

/** The terms as the driver was shown them before paying (#16), in the bank's language. */
const POLICY_TEXT: Record<CancellationPolicy, string> = {
  oneHour: 'Full refund if cancelled at least 1 hour before the start; no refund after that.',
  oneDay: 'Full refund if cancelled at least 24 hours before the start; no refund after that.',
  oneDayThenHalf:
    'Full refund if cancelled at least 24 hours before the start; half refunded after that, until the start.',
};

const instant = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: DEFAULT_TIME_ZONE,
  }).format(at);
const day = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIME_ZONE }).format(at);
const amount = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;

const toAnswer = (status: DisputeState['status']) =>
  status === 'needs_response' || status === 'warning_needs_response';

/**
 * Disputes of a booking's payment (4.3, #57–#60), from Stripe's webhook: each recorded against its
 * booking, which holds its payout while open or lost (#58); the booking's facts staged as evidence
 * when one opens (#59), for support to complete and submit in Stripe's dashboard; support told
 * when one opens and when one is lost (#57). Nothing happens to the driver's account (#60).
 * Another app's dispute on the same Stripe account is none of ours.
 */
@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENTS) private readonly payments: PaymentsGateway | null,
  ) {}

  async settle(disputeId: string): Promise<void> {
    const gateway = this.payments;
    if (!gateway) return;
    const dispute = await gateway.dispute(disputeId);
    const found = await this.bookingOf(dispute);
    if (!found) return;
    const recorded = await recordDispute(this.db, found.id, {
      stripeDisputeId: dispute.id,
      status: dispute.status,
      reason: dispute.reason,
      amountMinor: dispute.amountMinor,
      currency: dispute.currency,
      dueBy: dispute.dueBy,
      submissions: dispute.submissions,
    });
    // An older reading than the one recorded (a delivery crossed by a later one): nothing to do.
    if (!recorded) return;
    const { opened, evidenceStaged } = recorded;
    // Ids, the reason and dates only: the dispute's own text can carry the driver's details.
    const facts = {
      bookingId: found.id,
      disputeId: dispute.id,
      reason: dispute.reason,
      status: dispute.status,
      dueBy: dispute.dueBy?.toISOString() ?? null,
      ownersPaid: found.transferStatus === 'sent',
    };
    if (opened) this.logger.error(facts, 'payment disputed: support to answer before it is due');
    if (toAnswer(dispute.status) && dispute.submissions === 0 && !evidenceStaged) {
      // Never over what Stripe holds: support may have written it in the dashboard by now, or
      // our staging went through and only its record here didn't.
      if (!dispute.evidenceGiven) {
        // Recorded first: a lost connection is retried with Stripe's next delivery. An error
        // Stripe answered is kept under the key for a day, so retries fail alike until then;
        // the daily look tells support of a dispute due soon either way.
        await gateway.stageDisputeEvidence(dispute.id, this.evidence(found));
      }
      await markEvidenceStaged(this.db, dispute.id);
    }
    if (dispute.status === 'lost') {
      this.logger.error(facts, 'dispute lost: support decides who bears it');
    }
  }

  /**
   * Ours, by its PaymentIntent (its unique index); none for another app's. Every charge of ours
   * comes from a PaymentIntent, so a dispute without one is someone else's: matching the charge
   * too would read the whole table, as `stripe_charge_id` has no index.
   */
  private async bookingOf(dispute: DisputeState) {
    if (!dispute.paymentIntentId) return null;
    const [row] = await this.db
      .select({
        id: booking.id,
        reference: booking.reference,
        status: booking.status,
        listingName: booking.listingName,
        listingAddress: booking.listingAddress,
        spaceLabel: booking.spaceLabel,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        createdAt: booking.createdAt,
        confirmedAt: booking.confirmedAt,
        cancelledAt: booking.cancelledAt,
        cancelledBy: booking.cancelledBy,
        cancellationPolicy: booking.cancellationPolicy,
        refundMinor: booking.refundMinor,
        totalMinor: booking.totalMinor,
        currency: booking.currency,
        transferStatus: booking.transferStatus,
        driverName: users.name,
        driverEmail: users.email,
      })
      .from(booking)
      .innerJoin(users, eq(users.id, booking.userId))
      .where(eq(booking.paymentIntentId, dispute.paymentIntentId));
    return row ?? null;
  }

  /**
   * What the booking says for itself (#59), in English for the bank: the place and times, the
   * terms shown before paying, what happened to it. Not the plate: support adds it if it helps.
   */
  private evidence(found: NonNullable<Awaited<ReturnType<DisputesService['bookingOf']>>>) {
    const place = [found.listingName, found.listingAddress].filter(Boolean).join(', ');
    const stay = `${instant(found.startsAt)} to ${instant(found.endsAt)} (Athens time)`;
    const cancelled = found.cancelledAt
      ? `The booking was cancelled by the ${found.cancelledBy ?? 'driver'} on ${instant(found.cancelledAt)}; ${amount(found.refundMinor ?? 0, found.currency)} was refunded.`
      : 'The booking was not cancelled.';
    return {
      bookingId: found.id,
      productDescription: `A parking space (${found.spaceLabel}) at ${place}, booked on Parkfairy for ${stay}.`,
      serviceDate: day(found.startsAt),
      customerName: found.driverName,
      customerEmail: found.driverEmail,
      cancellationPolicy: `${POLICY_TEXT[found.cancellationPolicy]} The terms were shown on the listing and on the booking's page before paying.`,
      refundPolicy: `Refunds follow the cancellation terms. ${cancelled}`,
      accessActivityLog: [
        `Space held: ${instant(found.createdAt)}.`,
        found.confirmedAt ? `Paid and confirmed: ${instant(found.confirmedAt)}.` : null,
        `Stay: ${stay}.`,
      ]
        .filter(Boolean)
        .join(' '),
      uncategorized: `Parkfairy booking ${found.reference}, ${amount(found.totalMinor, found.currency)}, status ${found.status}. The driver received a confirmation email with the place, the times and the reference when the booking was made.`,
    } satisfies DisputeEvidence;
  }
}
