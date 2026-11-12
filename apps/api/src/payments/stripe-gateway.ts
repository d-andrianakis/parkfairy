import type { PaymentStatus, PayoutStatus } from '@parkfairy/contracts';
import Stripe from 'stripe';

/**
 * Stripe, behind the one interface the rest of the API sees, so tests swap in a fake (decision
 * #47: built without keys). Test mode only until #18 and #19 are answered: `loadEnv` refuses live
 * keys (memory.md #46).
 *
 * Nothing Stripe answers is logged whole: its messages can carry a person's details, so a failure
 * becomes a `PaymentProviderError` with Stripe's error type and code only.
 */

/** A payout account's state that matters to us. */
export type AccountStatus = Exclude<PayoutStatus, 'none'>;

export interface PaymentState {
  id: string;
  clientSecret: string;
  /** Stripe's state as ours; a refund is ours to record, so never `refunding` or `refunded`. */
  status: Exclude<PaymentStatus, 'refunding' | 'refunded'>;
  amountMinor: number;
  /** What Stripe actually took, and what of it went back since: only all-in, none-back books. */
  receivedMinor: number;
  refundedMinor: number;
  currency: string;
  /** From the PaymentIntent's metadata: which booking it pays for. */
  bookingId: string | null;
}

/** A webhook event, verified, narrowed to what we act on. */
export type PaymentsEvent =
  | { id: string; type: string; kind: 'payment'; paymentIntentId: string }
  | {
      id: string;
      type: string;
      kind: 'account';
      accountId: string;
      status: AccountStatus;
      at: Date;
    }
  | { id: string; type: string; kind: 'ignored' };

export interface PaymentsGateway {
  /** An Express account for an owner (#48), able to receive transfers. */
  createPayoutAccount(input: {
    ownerId: string;
    email: string;
    country: string;
    businessType: 'individual' | 'company';
  }): Promise<string>;
  accountStatus(accountId: string): Promise<AccountStatus>;
  /** Stripe's hosted onboarding, one use, minutes long. */
  onboardingLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<string>;
  /** A one-time sign-in to the owner's Express dashboard. */
  dashboardLink(accountId: string): Promise<string>;
  /** One PaymentIntent per booking: asked again, the same one (idempotency key). */
  createPayment(input: {
    bookingId: string;
    reference: string;
    amountMinor: number;
    currency: string;
  }): Promise<PaymentState>;
  payment(paymentIntentId: string): Promise<PaymentState>;
  /** All of it back to the driver; asked again, the same refund (idempotency key). */
  refundPayment(paymentIntentId: string, reason: 'not_bookable'): Promise<void>;
  /** Verifies the signature (`InvalidSignatureError` if it doesn't hold) and narrows the event. */
  parseEvent(rawBody: Buffer, signature: string): PaymentsEvent;
}

/** Stripe failed, refused or was too slow. Its type and code only, never its message. */
export class PaymentProviderError extends Error {
  constructor(readonly detail: string) {
    super(`Stripe failed: ${detail}`);
    this.name = 'PaymentProviderError';
  }
}

export class InvalidSignatureError extends Error {
  constructor() {
    super('Stripe signature does not verify');
    this.name = 'InvalidSignatureError';
  }
}

/**
 * Where an owner's account stands. `active` once Stripe lets us transfer to it and it pays out;
 * `restricted` while Stripe waits for the owner (unfinished onboarding, documents due, or refused);
 * `pending` while Stripe checks what was sent.
 */
export function accountStatusOf(
  account: Pick<
    Stripe.Account,
    'capabilities' | 'payouts_enabled' | 'details_submitted' | 'requirements'
  >,
): AccountStatus {
  if (account.capabilities?.transfers === 'active' && account.payouts_enabled) return 'active';
  const requirements = account.requirements;
  const due = [...(requirements?.currently_due ?? []), ...(requirements?.past_due ?? [])];
  const reason = requirements?.disabled_reason ?? null;
  const checking = reason === null || reason.startsWith('requirements.pending_verification');
  return account.details_submitted && due.length === 0 && checking ? 'pending' : 'restricted';
}

/** Stripe's PaymentIntent states as ours. */
export function paymentStatusOf(status: Stripe.PaymentIntent.Status): PaymentState['status'] {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'processing') return 'processing';
  // Not paid yet: waiting for a card, a declined one to be replaced, 3-D Secure, or cancelled.
  return 'pending';
}

const PAYMENT_EVENTS = new Set([
  'payment_intent.succeeded',
  'payment_intent.processing',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
]);

/** Only what a failure may say in our logs. */
function providerError(error: unknown): PaymentProviderError {
  if (error instanceof Stripe.errors.StripeError) {
    return new PaymentProviderError(
      [error.rawType ?? error.type, error.code].filter(Boolean).join(' '),
    );
  }
  return new PaymentProviderError(error instanceof Error ? error.name : 'unknown');
}

async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw providerError(error);
  }
}

function stateOf(intent: Stripe.PaymentIntent): PaymentState {
  if (!intent.client_secret) throw new PaymentProviderError('no client secret');
  // Expanded where it matters (`payment`); a new PaymentIntent has no charge yet.
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    status: paymentStatusOf(intent.status),
    amountMinor: intent.amount,
    receivedMinor: intent.amount_received,
    refundedMinor: charge?.amount_refunded ?? 0,
    currency: intent.currency.toUpperCase(),
    bookingId: intent.metadata.bookingId ?? null,
  };
}

export function stripeGateway(
  { secretKey, webhookSecrets }: { secretKey: string; webhookSecrets: string[] },
  client: Stripe = new Stripe(secretKey, {
    maxNetworkRetries: 2,
    timeout: 10_000,
    telemetry: false,
    appInfo: { name: 'Parkfairy' },
  }),
): PaymentsGateway {
  return {
    createPayoutAccount: ({ ownerId, email, country, businessType }) =>
      call(async () => {
        const account = await client.accounts.create(
          {
            country,
            email,
            business_type: businessType,
            // Express (#48): Stripe collects the owner's details and hosts their dashboard; the
            // platform pays Stripe's fees and stands behind losses (separate charges, #6).
            controller: {
              stripe_dashboard: { type: 'express' },
              fees: { payer: 'application' },
              losses: { payments: 'application' },
              requirement_collection: 'stripe',
            },
            capabilities: { transfers: { requested: true } },
            metadata: { ownerId },
          },
          // Asked twice at once, one account.
          { idempotencyKey: `payout-account-${ownerId}` },
        );
        return account.id;
      }),
    accountStatus: (accountId) =>
      call(async () => accountStatusOf(await client.accounts.retrieve(accountId))),
    onboardingLink: ({ accountId, refreshUrl, returnUrl }) =>
      call(async () => {
        const link = await client.accountLinks.create({
          account: accountId,
          refresh_url: refreshUrl,
          return_url: returnUrl,
          type: 'account_onboarding',
        });
        return link.url;
      }),
    dashboardLink: (accountId) =>
      call(async () => (await client.accounts.createLoginLink(accountId)).url),
    createPayment: ({ bookingId, reference, amountMinor, currency }) =>
      call(async () =>
        stateOf(
          await client.paymentIntents.create(
            {
              amount: amountMinor,
              currency: currency.toLowerCase(),
              // Cards (wallets included) answer at once: a method that takes days would settle
              // long after the ten-minute hold, mostly into a refund (#3).
              allowed_payment_method_types: ['card'],
              description: `Parking ${reference}`,
              metadata: { bookingId, reference },
              // Separate charges and transfers (#6): the owner's transfer joins this group later.
              transfer_group: `booking_${bookingId}`,
            },
            { idempotencyKey: `booking-payment-${bookingId}` },
          ),
        ),
      ),
    payment: (paymentIntentId) =>
      call(async () =>
        stateOf(
          await client.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] }),
        ),
      ),
    refundPayment: (paymentIntentId, reason) =>
      call(async () => {
        await client.refunds.create(
          { payment_intent: paymentIntentId, metadata: { reason } },
          // Its own purpose in the key: a cancellation's refund (4.2) must not meet this one.
          { idempotencyKey: `refund-unbooked-${paymentIntentId}` },
        );
      }),
    parseEvent(rawBody, signature) {
      // The platform's endpoint and the Connect one (owners' accounts) sign with their own
      // secrets: either verifies.
      let event: Stripe.Event | undefined;
      for (const secret of webhookSecrets) {
        try {
          event = client.webhooks.constructEvent(rawBody, signature, secret);
          break;
        } catch {
          // The next secret, if any.
        }
      }
      if (!event) throw new InvalidSignatureError();
      if (PAYMENT_EVENTS.has(event.type)) {
        const intent = event.data.object as Stripe.PaymentIntent;
        return { id: event.id, type: event.type, kind: 'payment', paymentIntentId: intent.id };
      }
      if (event.type === 'account.updated') {
        const account = event.data.object;
        return {
          id: event.id,
          type: event.type,
          kind: 'account',
          accountId: account.id,
          status: accountStatusOf(account),
          at: new Date(event.created * 1000),
        };
      }
      return { id: event.id, type: event.type, kind: 'ignored' };
    },
  };
}
