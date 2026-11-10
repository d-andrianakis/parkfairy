import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://app.example.gr',
  S3_BUCKET: 'parkfairy-uploads',
  OWNER_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('loadEnv', () => {
  it('always trusts the auth origin and normalizes extra trusted origins', () => {
    const env = loadEnv({
      ...base,
      TRUSTED_ORIGINS: 'https://admin.example.gr/, https://app.example.gr',
    });
    expect(env.trustedOrigins).toEqual(['https://app.example.gr', 'https://admin.example.gr']);
  });

  it('confirms bookings without payment on this machine only (decision #33)', () => {
    expect(loadEnv({ ...base }).bookingWithoutPayment).toBe(false);
    expect(
      loadEnv({ ...base, BETTER_AUTH_URL: 'http://localhost:3000' }).bookingWithoutPayment,
    ).toBe(true);
    expect(
      loadEnv({ ...base, BETTER_AUTH_URL: 'https://localhost.example.gr' }).bookingWithoutPayment,
    ).toBe(false);
  });

  it('searches addresses with its own Mapbox token, else the public one on this machine only', () => {
    const local = { ...base, BETTER_AUTH_URL: 'http://localhost:3000' };
    expect(loadEnv({ ...base }).mapboxSearchToken).toBeNull();
    expect(loadEnv({ ...local, MAPBOX_PUBLIC_TOKEN: 'pk.public' }).mapboxSearchToken).toBe(
      'pk.public',
    );
    // The public token reaches every browser: never the server's elsewhere, nor the same one.
    expect(loadEnv({ ...base, MAPBOX_PUBLIC_TOKEN: 'pk.public' }).mapboxSearchToken).toBeNull();
    expect(() =>
      loadEnv({ ...base, MAPBOX_PUBLIC_TOKEN: 'pk.same', MAPBOX_SEARCH_TOKEN: 'pk.same' }),
    ).toThrow(/MAPBOX_SEARCH_TOKEN/);
    expect(
      loadEnv({ ...base, MAPBOX_PUBLIC_TOKEN: 'pk.public', MAPBOX_SEARCH_TOKEN: 'sk.server' })
        .mapboxSearchToken,
    ).toBe('sk.server');
    expect(() => loadEnv({ ...base, MAPBOX_SEARCH_TOKEN: 'tk.other' })).toThrow(
      /MAPBOX_SEARCH_TOKEN/,
    );
    expect(loadEnv({ ...base }).MAPBOX_SEARCH_HOURLY_LIMIT).toBe(2000);
    expect(loadEnv({ ...base, MAPBOX_SEARCH_HOURLY_LIMIT: '' }).MAPBOX_SEARCH_HOURLY_LIMIT).toBe(
      2000,
    );
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

  it('keeps uploads on disk on this machine only', () => {
    const local = { ...base, BETTER_AUTH_URL: 'http://localhost:3000' };
    const { S3_BUCKET: _bucket, ...noBucket } = local;
    expect(loadEnv(noBucket).objectStoreDir).toMatch(/\.uploads$/);
    const { S3_BUCKET: _other, ...elsewhere } = base;
    expect(() => loadEnv(elsewhere)).toThrow(/S3_BUCKET/);
  });

  it('needs a real key for tax details anywhere but this machine', () => {
    const { OWNER_DATA_KEY: _key, ...noKey } = base;
    expect(() => loadEnv(noKey)).toThrow(/OWNER_DATA_KEY/);
    expect(() => loadEnv({ ...base, OWNER_DATA_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
    expect(loadEnv({ ...noKey, BETTER_AUTH_URL: 'http://127.0.0.1:3000' }).OWNER_DATA_KEY).toBe(
      undefined,
    );
  });

  it('rejects a short auth secret', () => {
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
