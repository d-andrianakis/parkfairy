import { Global, Module } from '@nestjs/common';
import { stripeGateway } from '@parkfairy/payments';

import { BookingsModule } from '../bookings/bookings.module.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DisputesService } from './disputes.service.js';
import { PaymentEventsService } from './payment-events.service.js';
import { PAYMENTS } from './payments.tokens.js';
import { PayoutsController } from './payouts.controller.js';
import { PayoutsService } from './payouts.service.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';

/** Stripe for everyone who needs it: bookings pay through it, owners are paid through it. */
@Global()
@Module({
  providers: [
    {
      provide: PAYMENTS,
      useFactory: (env: Env) => (env.stripe ? stripeGateway(env.stripe) : null),
      inject: [ENV],
    },
  ],
  exports: [PAYMENTS],
})
export class PaymentsGatewayModule {}

@Module({
  imports: [BookingsModule],
  controllers: [PayoutsController, StripeWebhookController],
  providers: [PayoutsService, PaymentEventsService, DisputesService],
})
export class PaymentsModule {}
