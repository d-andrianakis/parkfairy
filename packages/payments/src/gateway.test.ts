import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  accountStatusOf,
  InvalidSignatureError,
  PaymentProviderError,
  paymentStatusOf,
  stripeGateway,
} from './gateway.js';

const SECRET = 'whsec_unitTestSecret';
const signer = new Stripe('sk_test_unit');

function account(overrides: Partial<Stripe.Account> = {}) {
  return {
    capabilities: { transfers: 'active' },
    payouts_enabled: true,
    details_submitted: true,
    requirements: { currently_due: [], past_due: [], disabled_reason: null },
    ...overrides,
  } as unknown as Stripe.Account;
}

/** The SDK's resources, as far as the gateway calls them. */
function fakeClient() {
  const client = {
    accounts: {
      create: vi.fn(() => Promise.resolve({ id: 'acct_123' })),
      retrieve: vi.fn(() => Promise.resolve(account())),
      createLoginLink: vi.fn(() =>
        Promise.resolve({ url: 'https://connect.stripe.com/express/x' }),
      ),
    },
    accountLinks: {
      create: vi.fn(() => Promise.resolve({ url: 'https://connect.stripe.com/setup/x' })),
    },
    paymentIntents: {
      create: vi.fn(() =>
        Promise.resolve({
          id: 'pi_1',
          client_secret: 'pi_1_secret_2',
          status: 'requires_payment_method',
          amount: 400,
          currency: 'eur',
          amount_received: 0,
          latest_charge: null,
          metadata: { bookingId: 'b1' },
        }),
      ),
      retrieve: vi.fn(),
      cancel: vi.fn(),
    },
    refunds: {
      create: vi.fn(() => Promise.resolve({ id: 're_1' })),
      list: vi.fn(() => Promise.resolve({ data: [] as unknown[] })),
      retrieve: vi.fn(),
    },
    transfers: {
      create: vi.fn(() => Promise.resolve({ id: 'tr_1' })),
      list: vi.fn(() => Promise.resolve({ data: [] as unknown[] })),
    },
    webhooks: signer.webhooks,
  };
  return client;
}

const gatewayWith = (client: ReturnType<typeof fakeClient>) =>
  stripeGateway(
    { secretKey: 'sk_test_unit', webhookSecrets: ['whsec_other', SECRET] },
    client as unknown as Stripe,
  );

describe('accountStatusOf', () => {
  it('is active once transfers work and payouts are on', () => {
    expect(accountStatusOf(account())).toBe('active');
  });

  it('is restricted while the owner has something to do, or was refused', () => {
    expect(accountStatusOf(account({ details_submitted: false, payouts_enabled: false }))).toBe(
      'restricted',
    );
    expect(
      accountStatusOf(
        account({
          capabilities: { transfers: 'inactive' },
          requirements: {
            currently_due: ['external_account'],
            past_due: [],
            disabled_reason: 'requirements.past_due',
          } as unknown as Stripe.Account['requirements'],
        }),
      ),
    ).toBe('restricted');
    expect(
      accountStatusOf(
        account({
          capabilities: { transfers: 'inactive' },
          requirements: {
            currently_due: [],
            past_due: [],
            disabled_reason: 'rejected.fraud',
          } as unknown as Stripe.Account['requirements'],
        }),
      ),
    ).toBe('restricted');
  });

  it('is pending while Stripe checks what was sent', () => {
    expect(
      accountStatusOf(
        account({
          capabilities: { transfers: 'pending' },
          payouts_enabled: false,
          requirements: {
            currently_due: [],
            past_due: [],
            disabled_reason: 'requirements.pending_verification',
          } as unknown as Stripe.Account['requirements'],
        }),
      ),
    ).toBe('pending');
  });
});

describe('paymentStatusOf', () => {
  it.each([
    ['succeeded', 'succeeded'],
    ['processing', 'processing'],
    ['requires_payment_method', 'pending'],
    ['requires_action', 'pending'],
    ['canceled', 'canceled'],
  ] as const)('reads %s as %s', (stripe, ours) => {
    expect(paymentStatusOf(stripe)).toBe(ours);
  });
});

describe('stripeGateway', () => {
  it('makes an Express account, once per owner, that can receive transfers', async () => {
    const client = fakeClient();
    await expect(
      gatewayWith(client).createPayoutAccount({
        ownerId: 'o1',
        email: 'owner@example.gr',
        country: 'GR',
        businessType: 'individual',
      }),
    ).resolves.toBe('acct_123');
    expect(client.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        country: 'GR',
        business_type: 'individual',
        controller: {
          stripe_dashboard: { type: 'express' },
          fees: { payer: 'application' },
          losses: { payments: 'application' },
          requirement_collection: 'stripe',
        },
        capabilities: { transfers: { requested: true } },
      }),
      { idempotencyKey: 'payout-account-o1' },
    );
  });

  it('makes one PaymentIntent per booking, on the platform, grouped for the owner’s transfer', async () => {
    const client = fakeClient();
    const state = await gatewayWith(client).createPayment({
      bookingId: 'b1',
      reference: 'K7M4-Q2ZD',
      amountMinor: 400,
      currency: 'EUR',
    });
    expect(state).toEqual({
      id: 'pi_1',
      clientSecret: 'pi_1_secret_2',
      status: 'pending',
      amountMinor: 400,
      receivedMinor: 0,
      refundedMinor: 0,
      chargeId: null,
      currency: 'EUR',
      bookingId: 'b1',
    });
    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 400,
        currency: 'eur',
        allowed_payment_method_types: ['card'],
        metadata: { bookingId: 'b1', reference: 'K7M4-Q2ZD' },
        transfer_group: 'booking_b1',
      }),
      { idempotencyKey: 'booking-payment-b1' },
    );
  });

  it('reads what Stripe took, and what of it went back, from the latest charge', async () => {
    const client = fakeClient();
    client.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      client_secret: 'pi_1_secret_2',
      status: 'succeeded',
      amount: 400,
      amount_received: 400,
      currency: 'eur',
      latest_charge: { id: 'ch_1', amount_refunded: 150 },
      metadata: { bookingId: 'b1' },
    });
    await expect(gatewayWith(client).payment('pi_1')).resolves.toMatchObject({
      status: 'succeeded',
      receivedMinor: 400,
      refundedMinor: 150,
    });
    expect(client.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', {
      expand: ['latest_charge'],
    });
  });

  it('refuses a PaymentIntent without its client secret, and names a failure not Stripe’s only', async () => {
    const client = fakeClient();
    client.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_1',
      client_secret: null,
      status: 'succeeded',
      amount: 1,
      amount_received: 1,
      currency: 'eur',
      latest_charge: null,
      metadata: {},
    });
    await expect(gatewayWith(client).payment('pi_1')).rejects.toThrow(PaymentProviderError);
    client.paymentIntents.retrieve.mockRejectedValueOnce(
      new TypeError('socket hang up at 10.0.0.1'),
    );
    const error = await gatewayWith(client)
      .payment('pi_1')
      .catch((caught: unknown) => caught);
    expect(String(error)).toBe('PaymentProviderError: Stripe failed: TypeError');
  });

  it('gives back what a cancellation’s policy gives, once per booking', async () => {
    const client = fakeClient();
    await expect(
      gatewayWith(client).refundCancelled({
        paymentIntentId: 'pi_1',
        bookingId: 'b1',
        amountMinor: 250,
      }),
    ).resolves.toBe('re_1');
    expect(client.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 250, metadata: { bookingId: 'b1', reason: 'cancelled' } },
      { idempotencyKey: 'refund-cancelled-b1' },
    );
    // Asked while a person waits: one short try, the same refund; the worker does the rest.
    await gatewayWith(client).refundCancelled(
      { paymentIntentId: 'pi_1', bookingId: 'b1', amountMinor: 250 },
      { quick: true },
    );
    expect(client.refunds.create).toHaveBeenLastCalledWith(expect.anything(), {
      idempotencyKey: 'refund-cancelled-b1',
      timeout: 3_000,
      maxNetworkRetries: 0,
    });
  });

  it('reads a refund as it stands, a failed one included', async () => {
    const client = fakeClient();
    client.refunds.retrieve.mockResolvedValueOnce({
      id: 're_1',
      status: 'failed',
      payment_intent: 'pi_1',
      metadata: { bookingId: 'b1', reason: 'cancelled' },
    });
    await expect(gatewayWith(client).refund('re_1')).resolves.toEqual({
      id: 're_1',
      status: 'failed',
      paymentIntentId: 'pi_1',
      reason: 'cancelled',
      bookingId: 'b1',
    });
    // Another app's refund, expanded or not: no reason of ours.
    client.refunds.retrieve.mockResolvedValueOnce({
      id: 're_2',
      status: 'succeeded',
      payment_intent: { id: 'pi_9' },
      metadata: {},
    });
    await expect(gatewayWith(client).refund('re_2')).resolves.toEqual({
      id: 're_2',
      status: 'succeeded',
      paymentIntentId: 'pi_9',
      reason: null,
      bookingId: null,
    });
  });

  it('transfers the owner’s share out of the booking’s charge, once per booking', async () => {
    const client = fakeClient();
    await expect(
      gatewayWith(client).transfer({
        bookingId: 'b1',
        accountId: 'acct_1',
        amountMinor: 1800,
        currency: 'EUR',
        chargeId: 'ch_1',
      }),
    ).resolves.toBe('tr_1');
    expect(client.transfers.create).toHaveBeenCalledWith(
      {
        amount: 1800,
        currency: 'eur',
        destination: 'acct_1',
        source_transaction: 'ch_1',
        transfer_group: 'booking_b1',
        metadata: { bookingId: 'b1' },
      },
      { idempotencyKey: 'transfer-b1' },
    );
  });

  it('finds what was already made for a booking, so a late retry makes nothing twice', async () => {
    const client = fakeClient();
    client.refunds.list.mockResolvedValueOnce({
      data: [
        { id: 're_unbooked', metadata: { reason: 'not_bookable' }, status: 'succeeded' },
        { id: 're_failed', metadata: { reason: 'cancelled' }, status: 'failed' },
        { id: 're_2', metadata: { reason: 'cancelled' }, status: 'succeeded' },
      ],
    });
    client.transfers.list.mockResolvedValueOnce({
      data: [
        { id: 'tr_other', metadata: { bookingId: 'b9' } },
        { id: 'tr_2', metadata: { bookingId: 'b1' } },
      ],
    });
    await expect(gatewayWith(client).refundMadeFor('pi_1')).resolves.toBe('re_2');
    await expect(gatewayWith(client).transferMadeFor('b1')).resolves.toBe('tr_2');
    expect(client.refunds.list).toHaveBeenCalledWith({ payment_intent: 'pi_1', limit: 10 });
    expect(client.transfers.list).toHaveBeenCalledWith({ transfer_group: 'booking_b1', limit: 10 });
  });

  it('cancels a PaymentIntent nobody will pay, and reads the charge either way Stripe gives it', async () => {
    const client = fakeClient();
    client.paymentIntents.cancel.mockResolvedValueOnce({
      id: 'pi_1',
      client_secret: 'pi_1_secret_2',
      status: 'canceled',
      amount: 400,
      amount_received: 0,
      currency: 'eur',
      latest_charge: null,
      metadata: { bookingId: 'b1' },
    });
    await expect(gatewayWith(client).cancelPayment('pi_1')).resolves.toMatchObject({
      status: 'canceled',
      chargeId: null,
    });
    client.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_1',
      client_secret: 'pi_1_secret_2',
      status: 'succeeded',
      amount: 400,
      amount_received: 400,
      currency: 'eur',
      latest_charge: 'ch_9',
      metadata: { bookingId: 'b1' },
    });
    await expect(gatewayWith(client).payment('pi_1')).resolves.toMatchObject({ chargeId: 'ch_9' });
  });

  it('leaves a PaymentIntent paid meanwhile as it is, and says so', async () => {
    const client = fakeClient();
    client.paymentIntents.cancel.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        code: 'payment_intent_unexpected_state',
        message: 'You cannot cancel this PaymentIntent because it has a status of succeeded.',
      }),
    );
    client.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_1',
      client_secret: 'pi_1_secret_2',
      status: 'succeeded',
      amount: 400,
      amount_received: 400,
      currency: 'eur',
      latest_charge: { id: 'ch_1', amount_refunded: 0 },
      metadata: { bookingId: 'b1' },
    });
    await expect(gatewayWith(client).cancelPayment('pi_1')).resolves.toMatchObject({
      status: 'succeeded',
      chargeId: 'ch_1',
    });
    // Read with its charge, or what went back of it would read as nothing.
    expect(client.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', {
      expand: ['latest_charge'],
    });
    // Any other failure is one.
    client.paymentIntents.cancel.mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({ type: 'api_error', message: 'down' }),
    );
    await expect(gatewayWith(client).cancelPayment('pi_1')).rejects.toThrow(PaymentProviderError);
  });

  it('never counts a cancelled or failed refund as made', async () => {
    const client = fakeClient();
    client.refunds.list.mockResolvedValueOnce({
      data: [
        { id: 're_canceled', metadata: { reason: 'cancelled' }, status: 'canceled' },
        { id: 're_failed', metadata: { reason: 'cancelled' }, status: 'failed' },
      ],
    });
    await expect(gatewayWith(client).refundMadeFor('pi_1')).resolves.toBeNull();
    await expect(gatewayWith(client).transferMadeFor('b1')).resolves.toBeNull();
  });

  it('refunds all of a payment, once', async () => {
    const client = fakeClient();
    await gatewayWith(client).refundPayment('pi_1', 'not_bookable');
    expect(client.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', metadata: { reason: 'not_bookable' } },
      { idempotencyKey: 'refund-unbooked-pi_1' },
    );
  });

  it('turns Stripe’s failures into its type and code, never its message', async () => {
    const client = fakeClient();
    client.paymentIntents.create.mockRejectedValueOnce(
      new Stripe.errors.StripeCardError({
        type: 'card_error',
        code: 'card_declined',
        message: 'Your card for maria@example.gr was declined',
      }),
    );
    const error = await gatewayWith(client)
      .createPayment({ bookingId: 'b1', reference: 'R', amountMinor: 1, currency: 'EUR' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaymentProviderError);
    expect(String(error)).toMatch(/card_error card_declined/);
    expect(String(error)).not.toMatch(/maria/);
  });

  describe('parseEvent', () => {
    const sign = (type: string, object: object, secret = SECRET) => {
      const payload = JSON.stringify({
        id: 'evt_1',
        object: 'event',
        type,
        created: 1_700_000_000,
        data: { object },
      });
      return {
        body: Buffer.from(payload),
        signature: signer.webhooks.generateTestHeaderString({ payload, secret }),
      };
    };

    it('reads a payment event as the PaymentIntent to look at', () => {
      const { body, signature } = sign('payment_intent.succeeded', {
        id: 'pi_9',
        object: 'payment_intent',
      });
      expect(gatewayWith(fakeClient()).parseEvent(body, signature)).toEqual({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        kind: 'payment',
        paymentIntentId: 'pi_9',
      });
    });

    it('reads a refund that changed as the refund to look at', () => {
      for (const type of ['refund.updated', 'refund.failed', 'charge.refund.updated']) {
        const { body, signature } = sign(type, { id: 're_7', object: 'refund' });
        expect(gatewayWith(fakeClient()).parseEvent(body, signature)).toEqual({
          id: 'evt_1',
          type,
          kind: 'refund',
          refundId: 're_7',
        });
      }
    });

    it('reads an account update as its status, when Stripe made it', () => {
      const { body, signature } = sign('account.updated', {
        ...account(),
        id: 'acct_9',
        object: 'account',
      });
      expect(gatewayWith(fakeClient()).parseEvent(body, signature)).toEqual({
        id: 'evt_1',
        type: 'account.updated',
        kind: 'account',
        accountId: 'acct_9',
        status: 'active',
        at: new Date(1_700_000_000_000),
      });
    });

    it.each([
      'payment_intent.processing',
      'payment_intent.payment_failed',
      'payment_intent.canceled',
    ])('reads %s as the PaymentIntent to look at too', (type) => {
      const { body, signature } = sign(type, { id: 'pi_9', object: 'payment_intent' });
      expect(gatewayWith(fakeClient()).parseEvent(body, signature)).toMatchObject({
        kind: 'payment',
        paymentIntentId: 'pi_9',
      });
    });

    it('takes either endpoint’s secret, and refuses a delivery replayed long after', () => {
      const other = sign('payment_intent.succeeded', { id: 'pi_9' }, 'whsec_other');
      expect(gatewayWith(fakeClient()).parseEvent(other.body, other.signature)).toMatchObject({
        kind: 'payment',
      });
      const payload = JSON.stringify({
        id: 'evt_2',
        object: 'event',
        type: 'payment_intent.succeeded',
        created: 1,
        data: { object: { id: 'pi_9' } },
      });
      const stale = signer.webhooks.generateTestHeaderString({
        payload,
        secret: SECRET,
        timestamp: Math.floor(Date.now() / 1000) - 600,
      });
      expect(() => gatewayWith(fakeClient()).parseEvent(Buffer.from(payload), stale)).toThrow(
        InvalidSignatureError,
      );
    });

    it('lets other events by', () => {
      const { body, signature } = sign('charge.updated', { id: 'ch_1' });
      expect(gatewayWith(fakeClient()).parseEvent(body, signature)).toMatchObject({
        kind: 'ignored',
      });
    });

    it('refuses a signature that doesn’t hold', () => {
      const forged = sign('payment_intent.succeeded', { id: 'pi_9' }, 'whsec_nobodys');
      expect(() => gatewayWith(fakeClient()).parseEvent(forged.body, forged.signature)).toThrow(
        InvalidSignatureError,
      );
      const real = sign('payment_intent.succeeded', { id: 'pi_9' });
      const changed = Buffer.from(real.body.toString().replace('pi_9', 'pi_8'));
      expect(() => gatewayWith(fakeClient()).parseEvent(changed, real.signature)).toThrow(
        InvalidSignatureError,
      );
    });
  });
});
