'use client';

import { useEffect } from 'react';

/** What Stripe adds to the address coming back from a bank: the secret among it. */
const STRIPE_PARAMS = ['payment_intent', 'payment_intent_client_secret', 'redirect_status'];

/**
 * Takes Stripe's parameters out of the address once back from the bank, so the PaymentIntent's
 * secret stays out of the history and of what is shared or bookmarked. The page reads none of it:
 * it asks the API instead.
 */
export function TidyPaymentReturn() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!STRIPE_PARAMS.some((name) => url.searchParams.has(name))) return;
    for (const name of STRIPE_PARAMS) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, '', url);
  }, []);
  return null;
}
