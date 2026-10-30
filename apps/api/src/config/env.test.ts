import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://app.example.gr',
};

describe('loadEnv', () => {
  it('always trusts the auth origin and normalizes extra trusted origins', () => {
    const env = loadEnv({
      ...base,
      TRUSTED_ORIGINS: 'https://admin.example.gr/, https://app.example.gr',
    });
    expect(env.trustedOrigins).toEqual(['https://app.example.gr', 'https://admin.example.gr']);
  });

  it('parses TRUST_PROXY into the forms Express accepts', () => {
    expect(loadEnv({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadEnv({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadEnv({ ...base }).trustProxy).toBe('loopback');
  });

  it('requires Redis in production, so rate limits are shared across instances', () => {
    const production = { ...base, NODE_ENV: 'production', TRUST_PROXY: '10.0.1.0/24' } as const;
    expect(() => loadEnv(production)).toThrow(/REDIS_URL/);
    expect(loadEnv({ ...production, REDIS_URL: 'redis://cache:6379' }).REDIS_URL).toBe(
      'redis://cache:6379',
    );
    expect(loadEnv({ ...base }).REDIS_URL).toBeUndefined();
  });

  it('requires an explicit proxy setting in production (a wrong default lets visitors pick their key)', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://cache:6379',
    } as const;
    expect(() => loadEnv(production)).toThrow(/TRUST_PROXY/);
    expect(() => loadEnv({ ...production, TRUST_PROXY: '' })).toThrow(/TRUST_PROXY/);
    expect(loadEnv({ ...production, TRUST_PROXY: '10.0.1.0/24' }).trustProxy).toBe('10.0.1.0/24');
    // Express would take the left-most X-Forwarded-For entry, which visitors write.
    expect(() => loadEnv({ ...production, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });

  it('rejects a short auth secret', () => {
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
