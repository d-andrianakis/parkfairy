import { describe, expect, it } from 'vitest';

import { parseServerEnv } from './server-env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5434/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  ADMIN_URL: 'http://localhost:3001',
};

describe('the staff app’s environment', () => {
  it('accepts a local setup', () => {
    expect(parseServerEnv(base)).toMatchObject({ ADMIN_URL: 'http://localhost:3001' });
  });

  it('wants an origin of its own, not the public site’s', () => {
    expect(() => parseServerEnv({ ...base, ADMIN_URL: 'http://localhost:3000' })).toThrow(
      /origin of its own/,
    );
    expect(() => parseServerEnv({ ...base, ADMIN_URL: 'http://localhost:3000/staff' })).toThrow(
      /origin of its own/,
    );
    expect(() => parseServerEnv({ ...base, ADMIN_URL: '' })).toThrow();
  });

  it('wants a long secret, as every service does', () => {
    expect(() => parseServerEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow();
  });

  it('refuses to run in production without shared rate limits, a proxy list and an API', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://parkfairy.gr',
      ADMIN_URL: 'https://staff.parkfairy.gr',
    };
    expect(() => parseServerEnv(production)).toThrow(/REDIS_URL/);
    const withRedis = { ...production, REDIS_URL: 'redis://r:6379' };
    expect(() => parseServerEnv(withRedis)).toThrow(/TRUSTED_PROXIES/);
    const withProxies = { ...withRedis, TRUSTED_PROXIES: 'none' };
    expect(() => parseServerEnv(withProxies)).toThrow(/API_URL/);
    expect(parseServerEnv({ ...withProxies, API_URL: 'http://api:4000' })).toMatchObject({
      trustedProxies: [],
    });
    expect(() => parseServerEnv({ ...withProxies, API_URL: '' })).toThrow(/API_URL/);
  });

  it('keeps the staff app on a hostname of its own in production, and https, since cookies ignore ports', () => {
    const ready = {
      ...base,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://r:6379',
      TRUSTED_PROXIES: 'none',
      API_URL: 'http://api:4000',
      BETTER_AUTH_URL: 'https://parkfairy.gr',
      ADMIN_URL: 'https://staff.parkfairy.gr',
    };
    expect(parseServerEnv(ready).ADMIN_URL).toBe('https://staff.parkfairy.gr');
    // Another port on the same host shares the cookie jar: refused where it matters.
    expect(() => parseServerEnv({ ...ready, ADMIN_URL: 'https://parkfairy.gr:3001' })).toThrow(
      /hostname of its own/,
    );
    expect(() => parseServerEnv({ ...ready, ADMIN_URL: 'http://staff.parkfairy.gr' })).toThrow(
      /must be https/,
    );
    // On this machine the ports are all there is, a production build included (the smoke suite).
    expect(parseServerEnv(base).ADMIN_URL).toBe('http://localhost:3001');
    expect(
      parseServerEnv({
        ...base,
        NODE_ENV: 'production',
        REDIS_URL: 'redis://r:6379',
        TRUSTED_PROXIES: 'none',
      }).ADMIN_URL,
    ).toBe('http://localhost:3001');
  });

  it('reads the proxy list, and refuses entries Better Auth would drop', () => {
    expect(
      parseServerEnv({ ...base, TRUSTED_PROXIES: '10.0.0.0/8, 192.168.1.1' }).trustedProxies,
    ).toEqual(['10.0.0.0/8', '192.168.1.1']);
    expect(() => parseServerEnv({ ...base, TRUSTED_PROXIES: 'cloudflare' })).toThrow();
    expect(() => parseServerEnv({ ...base, TRUSTED_PROXIES: '10.0.0.0/33' })).toThrow();
  });
});
