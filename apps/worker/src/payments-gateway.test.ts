import type { stripeGateway } from '@parkfairy/payments';
import { describe, expect, it, vi } from 'vitest';

import { loadEnv } from './env.js';
import { paymentsGatewayFor } from './payments-gateway.js';

const base = {
  REDIS_URL: 'redis://localhost:6380',
  DATABASE_URL: 'postgres://u:p@localhost:5434/db',
};

describe('the worker’s Stripe', () => {
  it('is there for the payments jobs once a key is set, sending only, one retry a call', () => {
    const gateway = { transfer: vi.fn() };
    const make = vi.fn(() => gateway) as unknown as typeof stripeGateway;
    expect(
      paymentsGatewayFor(loadEnv({ ...base, STRIPE_SECRET_KEY: 'rk_test_abc123' }), make),
    ).toBe(gateway);
    expect(make).toHaveBeenCalledWith({
      secretKey: 'rk_test_abc123',
      webhookSecrets: [],
      maxNetworkRetries: 1,
    });
  });

  it('is none without a key: nothing was paid for', () => {
    const make = vi.fn() as unknown as typeof stripeGateway;
    expect(paymentsGatewayFor(loadEnv(base), make)).toBeNull();
    expect(make).not.toHaveBeenCalled();
  });
});
