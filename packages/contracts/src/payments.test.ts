import { describe, expect, it } from 'vitest';

import {
  BookingPaymentSchema,
  OwnerPayoutsSchema,
  PAYMENT_ERROR_CODES,
  PayoutLinkInputSchema,
  PayoutLinkSchema,
} from './payments.js';

describe('BookingPaymentSchema', () => {
  it('takes a PaymentIntent’s client secret and where the payment stands', () => {
    expect(
      BookingPaymentSchema.parse({ clientSecret: 'pi_3Abc_secret_xyz9', status: 'pending' }),
    ).toEqual({ clientSecret: 'pi_3Abc_secret_xyz9', status: 'pending' });
  });

  it('refuses anything else as a secret, and a state we don’t know', () => {
    for (const clientSecret of ['sk_test_123', 'pi_3Abc', 'pi_3Abc_secret_', 'seti_1_secret_2']) {
      expect(BookingPaymentSchema.safeParse({ clientSecret, status: 'pending' }).success).toBe(
        false,
      );
    }
    expect(
      BookingPaymentSchema.safeParse({ clientSecret: 'pi_1_secret_2', status: 'paid' }).success,
    ).toBe(false);
  });
});

describe('payouts', () => {
  it('says whether payouts exist here and how the owner’s account stands', () => {
    expect(OwnerPayoutsSchema.parse({ available: false, status: 'none' })).toEqual({
      available: false,
      status: 'none',
    });
    expect(OwnerPayoutsSchema.safeParse({ available: true, status: 'verified' }).success).toBe(
      false,
    );
  });

  it('asks for links back in a language we speak', () => {
    expect(PayoutLinkInputSchema.parse({ locale: 'el' })).toEqual({ locale: 'el' });
    expect(PayoutLinkInputSchema.safeParse({ locale: 'fr' }).success).toBe(false);
  });

  it('only ever sends an owner to an https link', () => {
    expect(PayoutLinkSchema.safeParse({ url: 'https://connect.stripe.com/setup/x' }).success).toBe(
      true,
    );
    for (const url of ['http://connect.stripe.com/x', 'javascript:alert(1)', 'not a url']) {
      expect(PayoutLinkSchema.safeParse({ url }).success).toBe(false);
    }
  });

  it('names every code a payment route answers with', () => {
    expect(PAYMENT_ERROR_CODES).toEqual([
      'PAYMENTS_UNAVAILABLE',
      'PROFILE_REQUIRED',
      'PAYOUTS_NOT_STARTED',
      'PAYMENT_PROVIDER_ERROR',
    ]);
  });
});
