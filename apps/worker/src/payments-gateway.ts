import { stripeGateway, type PaymentsGateway } from '@parkfairy/payments';
import type { Env } from './env.js';

/**
 * Stripe for the worker's payments jobs, where a key is set (4.2); without one, nothing was paid
 * for and the jobs skip. The worker sends money and never hears of it: no webhook secrets. One
 * network retry: a sweep that fails tries again on its next run anyway.
 */
export function paymentsGatewayFor(
  env: Pick<Env, 'stripe'>,
  make: typeof stripeGateway = stripeGateway,
): PaymentsGateway | null {
  if (!env.stripe) return null;
  return make({ secretKey: env.stripe.secretKey, webhookSecrets: [], maxNetworkRetries: 1 });
}
