// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { parseServerEnv } = await import('./auth');

const base = {
  DATABASE_URL: 'postgres://parkfairy@localhost:5434/parkfairy',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://parkfairy.example',
};

describe('parseServerEnv', () => {
  it('treats an empty REDIS_URL as unset (counting per instance) outside production', () => {
    const env = parseServerEnv({ ...base, NODE_ENV: 'development', REDIS_URL: '' });
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.trustedProxies).toEqual([]);
  });

  it('splits and trims the trusted proxy list; "none" means none', () => {
    expect(
      parseServerEnv({ ...base, TRUSTED_PROXIES: ' 10.0.0.0/8, 192.0.2.10 ' }).trustedProxies,
    ).toEqual(['10.0.0.0/8', '192.0.2.10']);
    expect(parseServerEnv({ ...base, TRUSTED_PROXIES: 'none' }).trustedProxies).toEqual([]);
  });

  it('refuses to start in production without shared counters or an explicit proxy setting', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis.internal:6379',
      TRUSTED_PROXIES: 'none',
    };
    expect(() => parseServerEnv(production)).not.toThrow();
    expect(() => parseServerEnv({ ...production, REDIS_URL: '' })).toThrow(/REDIS_URL/);
    expect(() => parseServerEnv({ ...production, TRUSTED_PROXIES: '' })).toThrow(/TRUSTED_PROXIES/);
  });
});
