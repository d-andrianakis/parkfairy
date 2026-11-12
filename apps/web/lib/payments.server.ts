import 'server-only';

/**
 * Stripe's publishable key, or null: whether drivers can pay in this deployment's pages (decision
 * #49). Without it a booking that must be paid for says payments aren't available (#47).
 */
export function stripePublishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY || null;
}
