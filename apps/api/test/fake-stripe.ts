import Stripe from 'stripe';
import { vi } from 'vitest';
import {
  PaymentProviderError,
  stripeGateway,
  type AccountStatus,
  type PaymentState,
  type PaymentsGateway,
  type RefundState,
} from '@parkfairy/payments';

/** The fake endpoint's signing secret: events are signed with it as Stripe would. */
export const WEBHOOK_SECRET = 'whsec_parkfairyTestSecret';

/**
 * Stripe in memory, for tests without keys (decision #47): accounts, PaymentIntents, refunds and
 * transfers in maps, with Stripe's idempotency where we lean on it (one account per owner, one
 * PaymentIntent, cancellation refund and transfer per booking). Webhook events go through the real
 * SDK's signature check.
 */
export function fakeStripe() {
  const accounts = new Map<string, AccountStatus>();
  const accountsByOwner = new Map<string, string>();
  const intents = new Map<string, PaymentState>();
  const intentsByBooking = new Map<string, string>();
  const refunds: string[] = [];
  /** A cancellation's refund per booking: its id and amount. */
  const cancellationRefunds = new Map<
    string,
    { id: string; amountMinor: number; paymentIntentId: string; status: RefundState['status'] }
  >();
  /** The owner's transfer per booking. */
  const transfers = new Map<
    string,
    { id: string; accountId: string; amountMinor: number; chargeId: string }
  >();
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
          chargeId: null,
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
    refundCancelled: vi.fn<PaymentsGateway['refundCancelled']>(
      ({ paymentIntentId, bookingId, amountMinor }) => {
        const known = cancellationRefunds.get(bookingId);
        if (known) return Promise.resolve(known.id);
        const state = intents.get(paymentIntentId);
        if (!state || state.status !== 'succeeded') {
          return Promise.reject(new PaymentProviderError('invalid_request_error resource_missing'));
        }
        // As Stripe: never more back than came in.
        if (state.refundedMinor + amountMinor > state.receivedMinor) {
          return Promise.reject(new PaymentProviderError('invalid_request_error amount_too_large'));
        }
        const id = `re_${(++next).toString().padStart(6, '0')}Fake`;
        cancellationRefunds.set(bookingId, {
          id,
          amountMinor,
          paymentIntentId,
          status: 'succeeded',
        });
        intents.set(paymentIntentId, {
          ...state,
          refundedMinor: state.refundedMinor + amountMinor,
        });
        return Promise.resolve(id);
      },
    ),
    transfer: vi.fn<PaymentsGateway['transfer']>(
      ({ bookingId, ownerId, accountId, amountMinor, chargeId }) => {
        // One per booking and payee, as the gateway's idempotency key has it.
        const key = `${bookingId}:${ownerId}`;
        const known = transfers.get(key);
        if (known) return Promise.resolve(known.id);
        if (accounts.get(accountId) !== 'active') {
          return Promise.reject(
            new PaymentProviderError(
              'invalid_request_error insufficient_capabilities_for_transfer',
            ),
          );
        }
        const id = `tr_${(++next).toString().padStart(6, '0')}Fake`;
        transfers.set(key, { id, accountId, amountMinor, chargeId });
        return Promise.resolve(id);
      },
    ),
    refund: vi.fn<PaymentsGateway['refund']>((refundId) => {
      for (const [bookingId, made] of cancellationRefunds) {
        if (made.id === refundId) {
          return Promise.resolve({
            id: made.id,
            status: made.status,
            paymentIntentId: made.paymentIntentId,
            reason: 'cancelled' as const,
            bookingId,
          });
        }
      }
      return Promise.reject(new PaymentProviderError('invalid_request_error resource_missing'));
    }),
    refundMadeFor: vi.fn<PaymentsGateway['refundMadeFor']>((paymentIntentId) => {
      for (const made of cancellationRefunds.values()) {
        if (made.paymentIntentId === paymentIntentId && made.status !== 'failed') {
          return Promise.resolve(made.id);
        }
      }
      return Promise.resolve(null);
    }),
    transferMadeFor: vi.fn<PaymentsGateway['transferMadeFor']>((bookingId, ownerId) =>
      Promise.resolve(transfers.get(`${bookingId}:${ownerId}`)?.id ?? null),
    ),
    cancelPayment: vi.fn<PaymentsGateway['cancelPayment']>((id) => {
      const state = intents.get(id);
      if (!state) {
        return Promise.reject(new PaymentProviderError('invalid_request_error resource_missing'));
      }
      // As the gateway: one paid (or being paid) meanwhile is left as it is.
      if (state.status !== 'pending') return Promise.resolve({ ...state });
      const canceled = { ...state, status: 'canceled' as const };
      intents.set(id, canceled);
      return Promise.resolve({ ...canceled });
    }),
    parseEvent: (rawBody: Buffer, signature: string) => real.parseEvent(rawBody, signature),
  } satisfies PaymentsGateway;

  return {
    gateway,
    accounts,
    intents,
    refunds,
    cancellationRefunds,
    transfers,
    /** A cancellation's refund Stripe took and that failed after (a closed card, say). */
    failRefund(bookingId: string) {
      const made = cancellationRefunds.get(bookingId);
      if (!made) throw new Error(`No refund for ${bookingId}`);
      made.status = 'failed';
      const state = intents.get(made.paymentIntentId);
      if (state) {
        intents.set(made.paymentIntentId, {
          ...state,
          refundedMinor: state.refundedMinor - made.amountMinor,
        });
      }
      return made.id;
    },
    /** What the driver's bank and card did: the PaymentIntent moves on; paid, all of it in. */
    setPayment(id: string, change: Partial<PaymentState>) {
      const state = intents.get(id);
      if (!state) throw new Error(`No PaymentIntent ${id}`);
      const next = { ...state, ...change };
      if (change.status === 'succeeded' && change.receivedMinor === undefined) {
        next.receivedMinor = next.amountMinor;
      }
      if (change.status === 'succeeded' && change.chargeId === undefined) {
        next.chargeId = next.chargeId ?? `ch_${id.slice(3)}`;
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
        chargeId: `ch_${id.slice(3)}`,
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
