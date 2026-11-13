import {
  DISPUTE_STATUSES,
  type DisputeStatus,
  type PaymentStatus,
  type PayoutStatus,
} from '@parkfairy/contracts';
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
  /** The charge that took the money (`ch_…`): an owner's transfer is tied to it. */
  chargeId: string | null;
  currency: string;
  /** From the PaymentIntent's metadata: which booking it pays for. */
  bookingId: string | null;
}

/** A refund as Stripe has it now: one it accepted can still fail later (a closed card). */
export interface RefundState {
  id: string;
  status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';
  paymentIntentId: string | null;
  /** From our metadata: a cancellation's (`cancelled`) or a paid hold's (`not_bookable`). */
  reason: 'cancelled' | 'not_bookable' | null;
  bookingId: string | null;
}

/** A dispute as Stripe has it now (4.3): what it's about, how it stands, when it's due. */
export interface DisputeState {
  id: string;
  status: DisputeStatus;
  reason: string;
  amountMinor: number;
  currency: string;
  chargeId: string | null;
  paymentIntentId: string | null;
  /** Past it, a dispute without a response is lost. */
  dueBy: Date | null;
  /** Responses sent to the bank: once one is, the evidence can't change. */
  submissions: number;
}

/**
 * What a booking says for itself in a dispute (#59), as text Stripe passes to the bank. Staged,
 * never submitted: support completes it in Stripe's dashboard and submits it there (once sent,
 * nothing can be added), or accepts the dispute.
 */
export interface DisputeEvidence {
  bookingId: string;
  productDescription: string;
  serviceDate: string;
  customerName: string;
  customerEmail: string;
  cancellationPolicy: string;
  refundPolicy: string;
  accessActivityLog: string;
  uncategorized: string;
}

/** A webhook event, verified, narrowed to what we act on. */
export type PaymentsEvent =
  | { id: string; type: string; kind: 'payment'; paymentIntentId: string }
  | { id: string; type: string; kind: 'refund'; refundId: string }
  | { id: string; type: string; kind: 'dispute'; disputeId: string }
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
  /**
   * What a cancellation gives back, by its policy (4.2): part or all of the payment. Asked again,
   * the same refund (idempotency key, a day long; past it, `refundMadeFor` says whether it was
   * made). `quick`: one try, three seconds at most, for a request a person waits on; the worker
   * sends it otherwise.
   */
  refundCancelled(
    input: { paymentIntentId: string; bookingId: string; amountMinor: number },
    options?: { quick?: boolean },
  ): Promise<string>;
  /** A refund as it stands now, to check one Stripe says changed. */
  refund(refundId: string): Promise<RefundState>;
  /** A dispute as it stands now (4.3), to act on one Stripe says changed. */
  dispute(disputeId: string): Promise<DisputeState>;
  /** The booking's evidence, staged on the dispute for support to complete and submit (#59). */
  stageDisputeEvidence(disputeId: string, evidence: DisputeEvidence): Promise<void>;
  /**
   * A payee's part of the owners' share to their Express account (#4, #6, #54), tied to the
   * charge so it waits for the money to be there. Asked again, the same transfer (idempotency key,
   * per booking and payee).
   */
  transfer(input: {
    bookingId: string;
    ownerId: string;
    accountId: string;
    amountMinor: number;
    currency: string;
    chargeId: string;
  }): Promise<string>;
  /**
   * What Stripe already made for a booking, past an idempotency key's day (inside it the key is
   * enough): its cancellation refund, its transfer, so a retry never makes a second one.
   */
  refundMadeFor(paymentIntentId: string): Promise<string | null>;
  transferMadeFor(bookingId: string, ownerId: string): Promise<string | null>;
  /**
   * A PaymentIntent nobody will pay any more (its hold lapsed): it can't be paid after this. One
   * paid or called off meanwhile is left as it is, and its state returned.
   */
  cancelPayment(paymentIntentId: string): Promise<PaymentState>;
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
  if (status === 'canceled') return 'canceled';
  // Not paid yet: waiting for a card, a declined one to be replaced, or 3-D Secure.
  return 'pending';
}

/** A dispute opened, changed or closed (4.3): ours to record, to stage evidence for, to hold. */
const DISPUTE_EVENTS = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
]);

/** A refund that changed: one that failed after Stripe took it is ours to hear of (4.2). */
const REFUND_EVENTS = new Set(['refund.updated', 'refund.failed', 'charge.refund.updated']);

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
    chargeId:
      charge?.id ?? (typeof intent.latest_charge === 'string' ? intent.latest_charge : null),
    currency: intent.currency.toUpperCase(),
    bookingId: intent.metadata.bookingId ?? null,
  };
}

function disputeStateOf(dispute: Stripe.Dispute): DisputeState {
  const status = (DISPUTE_STATUSES as readonly string[]).includes(dispute.status)
    ? (dispute.status as DisputeStatus)
    : 'needs_response';
  const due = dispute.evidence_details?.due_by;
  return {
    id: dispute.id,
    status,
    reason: dispute.reason,
    amountMinor: dispute.amount,
    currency: dispute.currency.toUpperCase(),
    chargeId: typeof dispute.charge === 'string' ? dispute.charge : (dispute.charge?.id ?? null),
    paymentIntentId:
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : (dispute.payment_intent?.id ?? null),
    dueBy: due ? new Date(due * 1000) : null,
    submissions: dispute.evidence_details?.submission_count ?? 0,
  };
}

function refundStateOf(refund: Stripe.Refund): RefundState {
  const reason = refund.metadata?.reason;
  return {
    id: refund.id,
    status: (['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const).includes(
      refund.status as RefundState['status'],
    )
      ? (refund.status as RefundState['status'])
      : 'pending',
    paymentIntentId:
      typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : (refund.payment_intent?.id ?? null),
    reason: reason === 'cancelled' || reason === 'not_bookable' ? reason : null,
    bookingId: refund.metadata?.bookingId ?? null,
  };
}

export function stripeGateway(
  {
    secretKey,
    webhookSecrets,
    maxNetworkRetries = 2,
  }: {
    secretKey: string;
    webhookSecrets: string[];
    /** The worker tries again on its next run: one retry is enough there. */
    maxNetworkRetries?: number;
  },
  client: Stripe = new Stripe(secretKey, {
    maxNetworkRetries,
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
    refundCancelled: ({ paymentIntentId, bookingId, amountMinor }, options) =>
      call(async () => {
        const refund = await client.refunds.create(
          {
            payment_intent: paymentIntentId,
            amount: amountMinor,
            metadata: { bookingId, reason: 'cancelled' },
          },
          {
            idempotencyKey: `refund-cancelled-${bookingId}`,
            ...(options?.quick ? { timeout: 3_000, maxNetworkRetries: 0 } : {}),
          },
        );
        return refund.id;
      }),
    refund: (refundId) => call(async () => refundStateOf(await client.refunds.retrieve(refundId))),
    dispute: (disputeId) =>
      call(async () => disputeStateOf(await client.disputes.retrieve(disputeId))),
    stageDisputeEvidence: (disputeId, evidence) =>
      call(async () => {
        await client.disputes.update(
          disputeId,
          {
            evidence: {
              product_description: evidence.productDescription,
              service_date: evidence.serviceDate,
              customer_name: evidence.customerName,
              customer_email_address: evidence.customerEmail,
              cancellation_policy_disclosure: evidence.cancellationPolicy,
              refund_policy_disclosure: evidence.refundPolicy,
              access_activity_log: evidence.accessActivityLog,
              uncategorized_text: evidence.uncategorized,
            },
            // Staged, not sent: once submitted nothing can be added, and countering is support's
            // call (it costs a fee; accepting may be better).
            submit: false,
            metadata: { bookingId: evidence.bookingId },
          },
          { idempotencyKey: `dispute-evidence-${disputeId}` },
        );
      }),
    transfer: ({ bookingId, ownerId, accountId, amountMinor, currency, chargeId }) =>
      call(async () => {
        const made = await client.transfers.create(
          {
            amount: amountMinor,
            currency: currency.toLowerCase(),
            destination: accountId,
            // Paid out of this charge: the transfer waits for its money to be available.
            source_transaction: chargeId,
            transfer_group: `booking_${bookingId}`,
            metadata: { bookingId, ownerId },
          },
          { idempotencyKey: `transfer-${bookingId}-${ownerId}` },
        );
        return made.id;
      }),
    refundMadeFor: (paymentIntentId) =>
      call(async () => {
        const refunds = await client.refunds.list({ payment_intent: paymentIntentId, limit: 10 });
        const made = refunds.data.find(
          (refund) =>
            refund.metadata?.reason === 'cancelled' &&
            refund.status !== 'failed' &&
            refund.status !== 'canceled',
        );
        return made?.id ?? null;
      }),
    transferMadeFor: (bookingId, ownerId) =>
      call(async () => {
        const transfers = await client.transfers.list({
          transfer_group: `booking_${bookingId}`,
          limit: 10,
        });
        return (
          transfers.data.find(
            (made) => made.metadata.bookingId === bookingId && made.metadata.ownerId === ownerId,
          )?.id ?? null
        );
      }),
    cancelPayment: (paymentIntentId) =>
      call(async () => {
        try {
          return stateOf(await client.paymentIntents.cancel(paymentIntentId));
        } catch (error) {
          // Paid (or being paid, or called off) since we last looked: it is as it is, and the
          // caller learns how.
          if (
            error instanceof Stripe.errors.StripeError &&
            error.code === 'payment_intent_unexpected_state'
          ) {
            return stateOf(
              await client.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] }),
            );
          }
          throw error;
        }
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
      if (DISPUTE_EVENTS.has(event.type)) {
        const dispute = event.data.object as Stripe.Dispute;
        return { id: event.id, type: event.type, kind: 'dispute', disputeId: dispute.id };
      }
      if (REFUND_EVENTS.has(event.type)) {
        const refund = event.data.object as Stripe.Refund;
        return { id: event.id, type: event.type, kind: 'refund', refundId: refund.id };
      }
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
