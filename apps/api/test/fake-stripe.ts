import Stripe from 'stripe';
import { vi } from 'vitest';
import {
  PaymentProviderError,
  stripeGateway,
  type AccountStatus,
  type PaymentState,
  type PaymentsGateway,
} from '../src/payments/stripe-gateway.js';

/** The fake endpoint's signing secret: events are signed with it as Stripe would. */
export const WEBHOOK_SECRET = 'whsec_parkfairyTestSecret';

/**
 * Stripe in memory, for tests without keys (decision #47): accounts, PaymentIntents and refunds in
 * maps, with Stripe's idempotency where we lean on it (one account per owner, one PaymentIntent
 * per booking). Webhook events go through the real SDK's signature check.
 */
export function fakeStripe() {
  const accounts = new Map<string, AccountStatus>();
  const accountsByOwner = new Map<string, string>();
  const intents = new Map<string, PaymentState>();
  const intentsByBooking = new Map<string, string>();
  const refunds: string[] = [];
  let next = 0;
  const real = stripeGateway(
    { secretKey: 'sk_test_fake', webhookSecrets: ['whsec_otherEndpoint', WEBHOOK_SECRET] },
    new Stripe('sk_test_fake'),
  );

  const gateway = {
    createPayoutAccount: vi.fn<PaymentsGateway['createPayoutAccount']>(({ ownerId }) => {
      const known = accountsByOwner.get(ownerId);
      if (known) return Promise.resolve(known);
      const id = `acct_${(++next).toString().padStart(4, '0')}${ownerId.replaceAll('-', '').slice(0, 8)}`;
      accounts.set(id, 'restricted');
      accountsByOwner.set(ownerId, id);
      return Promise.resolve(id);
    }),
    accountStatus: vi.fn<PaymentsGateway['accountStatus']>((id) =>
      Promise.resolve(accounts.get(id) ?? 'restricted'),
    ),
    onboardingLink: vi.fn<PaymentsGateway['onboardingLink']>(({ accountId }) =>
      Promise.resolve(`https://connect.stripe.com/setup/e/${accountId}/onboarding`),
    ),
    dashboardLink: vi.fn<PaymentsGateway['dashboardLink']>((id) =>
      Promise.resolve(`https://connect.stripe.com/express/${id}/login`),
    ),
    createPayment: vi.fn<PaymentsGateway['createPayment']>(
      ({ bookingId, amountMinor, currency }) => {
        const known = intentsByBooking.get(bookingId);
        if (known) return Promise.resolve(intents.get(known) as PaymentState);
        const id = `pi_${(++next).toString().padStart(6, '0')}Fake`;
        const state: PaymentState = {
          id,
          clientSecret: `${id}_secret_${next}abc`,
          status: 'pending',
          amountMinor,
          receivedMinor: 0,
          refundedMinor: 0,
          currency,
          bookingId,
        };
        intents.set(id, state);
        intentsByBooking.set(bookingId, id);
        return Promise.resolve(state);
      },
    ),
    payment: vi.fn<PaymentsGateway['payment']>((id) => {
      const state = intents.get(id);
      if (!state) {
        return Promise.reject(new PaymentProviderError('invalid_request_error resource_missing'));
      }
      return Promise.resolve({ ...state });
    }),
    refundPayment: vi.fn<PaymentsGateway['refundPayment']>((id) => {
      const state = intents.get(id);
      // As Stripe: a charge refunded in full refuses another refund (past the key's day).
      if (
        state &&
        state.receivedMinor > 0 &&
        state.refundedMinor >= state.receivedMinor &&
        !refunds.includes(id)
      ) {
        return Promise.reject(
          new PaymentProviderError('invalid_request_error charge_already_refunded'),
        );
      }
      if (!refunds.includes(id)) refunds.push(id);
      if (state) intents.set(id, { ...state, refundedMinor: state.receivedMinor });
      return Promise.resolve();
    }),
    parseEvent: (rawBody: Buffer, signature: string) => real.parseEvent(rawBody, signature),
  } satisfies PaymentsGateway;

  return {
    gateway,
    accounts,
    intents,
    refunds,
    /** What the driver's bank and card did: the PaymentIntent moves on; paid, all of it in. */
    setPayment(id: string, change: Partial<PaymentState>) {
      const state = intents.get(id);
      if (!state) throw new Error(`No PaymentIntent ${id}`);
      const next = { ...state, ...change };
      if (change.status === 'succeeded' && change.receivedMinor === undefined) {
        next.receivedMinor = next.amountMinor;
      }
      intents.set(id, next);
    },
    /** A payment made outside our bookings (another app on the same account). */
    foreignPayment(): string {
      const id = `pi_${(++next).toString().padStart(6, '0')}Other`;
      intents.set(id, {
        id,
        clientSecret: `${id}_secret_x`,
        status: 'succeeded',
        amountMinor: 999,
        receivedMinor: 999,
        refundedMinor: 0,
        currency: 'EUR',
        bookingId: null,
      });
      return id;
    },
  };
}

let events = 0;
const signer = new Stripe('sk_test_fake');

/** A webhook delivery as Stripe sends it: the JSON body and its signature header. */
export function signedEvent(
  type: string,
  object: Record<string, unknown>,
  {
    id = `evt_test${++events}${Date.now()}`,
    created = Math.floor(Date.now() / 1000),
    secret = WEBHOOK_SECRET,
  } = {},
) {
  const payload = JSON.stringify({
    id,
    object: 'event',
    type,
    created,
    livemode: false,
    api_version: '2026-09-30.endive',
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  });
  const signature = signer.webhooks.generateTestHeaderString({ payload, secret });
  return { id, payload, signature };
}

/** An Express account as `account.updated` carries it. */
export function accountObject(id: string, state: 'active' | 'restricted') {
  const active = state === 'active';
  return {
    id,
    object: 'account',
    capabilities: { transfers: active ? 'active' : 'inactive' },
    payouts_enabled: active,
    details_submitted: true,
    requirements: {
      currently_due: active ? [] : ['external_account'],
      past_due: [],
      disabled_reason: active ? null : 'requirements.past_due',
    },
  };
}
