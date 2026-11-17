import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, schema } from '@parkfairy/database';
import { PaymentProviderError, type PaymentsEvent } from '@parkfairy/payments';
import { eq } from 'drizzle-orm';

import { BookingsService } from '../bookings/bookings.service.js';
import { DB } from '../database/database.module.js';
import { DisputesService } from './disputes.service.js';
import { PayoutsService } from './payouts.service.js';

const events = schema.stripeEvents;

/**
 * Stripe's webhook events, verified, acted on once. Acting is safe to repeat (a booking settles to
 * the same state, an older account update never overwrites a newer one), so an event is recorded
 * only after it was handled: one that failed half way is handled again when Stripe retries it.
 */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bookings: BookingsService,
    private readonly payouts: PayoutsService,
    private readonly disputes: DisputesService,
  ) {}

  async handle(event: PaymentsEvent): Promise<void> {
    // Nothing to do, nothing to remember: only what we act on is kept.
    if (event.kind === 'ignored') return;
    const [seen] = await this.db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.stripeEventId, event.id));
    if (seen) return;
    if (event.kind === 'payment' || event.kind === 'refund' || event.kind === 'dispute') {
      try {
        if (event.kind === 'payment') await this.bookings.settlePayment(event.paymentIntentId);
        else if (event.kind === 'refund') await this.bookings.settleRefund(event.refundId);
        else await this.disputes.settle(event.disputeId);
      } catch (error) {
        // Stripe retries the delivery; what failed is worth a line (its type and code only).
        if (error instanceof PaymentProviderError) {
          this.logger.warn({ eventId: event.id, detail: error.detail }, 'Stripe event not handled');
        }
        throw error;
      }
    }
    if (event.kind === 'account')
      await this.payouts.record(event.accountId, event.status, event.at);
    await this.db
      .insert(events)
      .values({ stripeEventId: event.id, type: event.type })
      .onConflictDoNothing({ target: events.stripeEventId });
    // Ids and types only: an event's body holds people's details.
    this.logger.log({ eventId: event.id, type: event.type }, 'Stripe event handled');
  }
}
