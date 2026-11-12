/**
 * Stripe, behind `PaymentsGateway`; null where Stripe isn't configured (#47). Tests provide a fake
 * here; nothing else does.
 */
export const PAYMENTS = Symbol('PAYMENTS');
