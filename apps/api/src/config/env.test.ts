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

  it('rejects a short auth secret', () => {
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
