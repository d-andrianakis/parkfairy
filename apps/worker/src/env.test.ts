import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

const base = {
  REDIS_URL: 'redis://localhost:6380',
  DATABASE_URL: 'postgres://u:p@localhost:5434/db',
};

describe('worker loadEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(loadEnv(base)).toMatchObject({
      WORKER_HEALTH_PORT: 4100,
      LOG_LEVEL: 'info',
      EMAIL_SENDS_PER_SECOND: 1,
    });
  });

  it('sends as fast as it is told, within reason', () => {
    expect(loadEnv({ ...base, EMAIL_SENDS_PER_SECOND: '8' }).EMAIL_SENDS_PER_SECOND).toBe(8);
    expect(loadEnv({ ...base, EMAIL_SENDS_PER_SECOND: '' }).EMAIL_SENDS_PER_SECOND).toBe(1);
    // One send in a run's 25 s, the least that sends anything.
    expect(loadEnv({ ...base, EMAIL_SENDS_PER_SECOND: '0.04' }).EMAIL_SENDS_PER_SECOND).toBe(0.04);
    for (const pace of ['0', '0.03', '-1', '1000', 'fast']) {
      expect(() => loadEnv({ ...base, EMAIL_SENDS_PER_SECOND: pace }), pace).toThrow(
        /EMAIL_SENDS_PER_SECOND/,
      );
    }
  });

  it('moves money only with a Stripe test key, and none by default (memory.md #46)', () => {
    expect(loadEnv(base).stripe).toBeNull();
    expect(loadEnv({ ...base, STRIPE_SECRET_KEY: '' }).stripe).toBeNull();
    for (const key of ['sk_test_abc123', 'rk_test_abc123']) {
      expect(loadEnv({ ...base, STRIPE_SECRET_KEY: key }).stripe).toEqual({ secretKey: key });
    }
    for (const key of ['sk_live_abc123', 'rk_live_abc123']) {
      expect(() => loadEnv({ ...base, STRIPE_SECRET_KEY: key }), key).toThrow(
        /Live Stripe keys are refused/,
      );
    }
    for (const key of ['pk_test_abc123', 'whsec_abc', 'sk_test_']) {
      expect(() => loadEnv({ ...base, STRIPE_SECRET_KEY: key }), key).toThrow(/STRIPE_SECRET_KEY/);
    }
  });

  it('points links at this machine by default', () => {
    expect(loadEnv(base).webUrl).toBe('http://localhost:3000');
    expect(
      loadEnv({
        ...base,
        BETTER_AUTH_URL: 'https://parkfairy.gr',
        RESEND_API_KEY: 'k',
        EMAIL_FROM: 'a@b.gr',
      }).webUrl,
    ).toBe('https://parkfairy.gr');
  });

  it('refuses to write emails to disk anywhere but this machine', () => {
    expect(() => loadEnv({ ...base, BETTER_AUTH_URL: 'https://parkfairy.gr' })).toThrow(
      /RESEND_API_KEY/,
    );
  });

  it('needs a sender with a key', () => {
    expect(() => loadEnv({ ...base, RESEND_API_KEY: 'k' })).toThrow(/EMAIL_FROM/);
  });

  it('needs the real origin in production, for links in emails', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      RESEND_API_KEY: 'k',
      EMAIL_FROM: 'a@b.gr',
    };
    expect(() => loadEnv(production)).toThrow(/BETTER_AUTH_URL/);
  });

  it('refuses to start without Redis', () => {
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/REDIS_URL/);
  });
});
