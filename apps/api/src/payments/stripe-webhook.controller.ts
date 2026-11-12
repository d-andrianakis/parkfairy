import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/auth.decorators.js';
import { PaymentEventsService } from './payment-events.service.js';
import { PAYMENTS } from './payments.tokens.js';
import { InvalidSignatureError, type PaymentsGateway } from './stripe-gateway.js';

/** Stripe sends bursts (a day's account updates, retries after an outage). */
const WEBHOOK_LIMIT = { default: { limit: 600, ttl: 60_000 } };

/** The path `configureApp` keeps the raw body for: the signature is over the exact bytes. */
export const STRIPE_WEBHOOK_PATH = '/v1/payments/webhook';

/**
 * Stripe's webhook endpoint. No session and no origin: what proves it is Stripe is the signature
 * over the raw body, with the endpoint's signing secret; anything else is a 400 and nothing more.
 * Not in the OpenAPI document: no client of ours calls it.
 */
@ApiExcludeController()
@Controller('payments')
export class StripeWebhookController {
  constructor(
    @Inject(PAYMENTS) private readonly payments: PaymentsGateway | null,
    private readonly events: PaymentEventsService,
  ) {}

  @Post('webhook')
  @Public()
  @HttpCode(200)
  @Throttle(WEBHOOK_LIMIT)
  async receive(
    @Req() request: Request,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const gateway = this.payments;
    // Without Stripe there is no endpoint to speak of.
    if (!gateway) throw new NotFoundException();
    const body: unknown = request.body;
    if (!signature || !Buffer.isBuffer(body)) throw refused();
    let event;
    try {
      event = gateway.parseEvent(body, signature);
    } catch (error) {
      if (error instanceof InvalidSignatureError) throw refused();
      throw error;
    }
    await this.events.handle(event);
    return { received: true };
  }
}

function refused(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'INVALID_SIGNATURE',
    code: 'INVALID_SIGNATURE',
  });
}
