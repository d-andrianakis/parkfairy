import { describe, expect, it } from 'vitest';
import { allowsMaps, allowsPayments, buildContentSecurityPolicy, createNonce } from './csp';

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name ?? '', values];
    }),
  );
}

describe('allowsMaps', () => {
  it('allows Mapbox in the owner area and on the search page, in both languages', () => {
    for (const path of [
      '/el/owner',
      '/en/owner/listings/1/location',
      '/el/search',
      '/en/search/',
    ]) {
      expect(allowsMaps(path)).toBe(true);
    }
  });

  it('nowhere else, however close the path', () => {
    for (const path of [
      '/el',
      '/en/parking/demo',
      '/en/searches',
      '/en/search/x',
      '/el/ownerx',
      '/search',
    ]) {
      expect(allowsMaps(path)).toBe(false);
    }
  });
});

describe('allowsPayments', () => {
  it('allows Stripe on a booking’s page only, in both languages (decision #49)', () => {
    for (const path of ['/el/bookings/6f1c0a52-8c1e-4f0e-9b7a-2d3e4f5a6b7c', '/en/bookings/x/']) {
      expect(allowsPayments(path)).toBe(true);
    }
    for (const path of [
      '/en/bookings',
      '/en/bookings/',
      '/en/bookings/x/y',
      '/en/parking/x',
      '/bookings/x',
      '/el/owner',
    ]) {
      expect(allowsPayments(path)).toBe(false);
    }
  });
});

describe('buildContentSecurityPolicy', () => {
  const production = directives(
    buildContentSecurityPolicy({ nonce: 'abc', isDev: false, upgradeInsecureRequests: true }),
  );

  it('reaches Mapbox only where a page asks for it', () => {
    expect(production.get('connect-src')).toEqual(["'self'"]);
    expect(production.has('worker-src')).toBe(false);

    const maps = directives(
      buildContentSecurityPolicy({
        nonce: 'abc',
        isDev: false,
        upgradeInsecureRequests: true,
        maps: true,
      }),
    );
    expect(maps.get('connect-src')).toEqual([
      "'self'",
      'https://api.mapbox.com',
      'https://events.mapbox.com',
    ]);
    expect(maps.get('worker-src')).toEqual(["'self'"]);
    // The map gains origins to talk to, never a looser way to run code.
    expect(maps.get('script-src')).toEqual(production.get('script-src'));
    expect(maps.get('img-src')).toEqual(production.get('img-src'));
  });

  it('reaches Stripe only where a page pays, and frames nothing else new', () => {
    expect(production.get('frame-src')).toEqual(["'self'"]);
    const paying = directives(
      buildContentSecurityPolicy({
        nonce: 'abc',
        isDev: false,
        upgradeInsecureRequests: true,
        payments: true,
      }),
    );
    expect(paying.get('connect-src')).toEqual([
      "'self'",
      'https://api.stripe.com',
      'https://merchant-ui-api.stripe.com',
    ]);
    expect(paying.get('frame-src')).toEqual([
      "'self'",
      'https://js.stripe.com',
      'https://*.js.stripe.com',
      'https://hooks.stripe.com',
    ]);
    // Still only our nonce'd code runs scripts: Stripe's hosts serve browsers without strict-dynamic.
    expect(paying.get('script-src')).toEqual([
      ...(production.get('script-src') ?? []),
      'https://js.stripe.com',
      'https://*.js.stripe.com',
    ]);
    expect(paying.get('script-src')).toContain("'strict-dynamic'");
    expect(paying.get('script-src')).not.toContain("'unsafe-inline'");
    expect(paying.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('only runs scripts carrying this response nonce', () => {
    expect(production.get('script-src')).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
  });

  it('never allows eval or inline scripts in production', () => {
    const scripts = production.get('script-src') ?? [];
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts).not.toContain("'unsafe-inline'");
  });

  it('blocks framing, plugins and base/form hijacking', () => {
    expect(production.get('frame-ancestors')).toEqual(["'none'"]);
    expect(production.get('object-src')).toEqual(["'none'"]);
    expect(production.get('base-uri')).toEqual(["'self'"]);
    expect(production.get('form-action')).toEqual(["'self'"]);
  });

  it('upgrades insecure requests only when asked (https)', () => {
    expect(production.has('upgrade-insecure-requests')).toBe(true);
    const local = directives(
      buildContentSecurityPolicy({ nonce: 'abc', isDev: false, upgradeInsecureRequests: false }),
    );
    expect(local.has('upgrade-insecure-requests')).toBe(false);
  });

  it('allows eval only for the dev server', () => {
    const dev = directives(
      buildContentSecurityPolicy({ nonce: 'abc', isDev: true, upgradeInsecureRequests: false }),
    );
    expect(dev.get('script-src')).toContain("'unsafe-eval'");
  });
});

describe('createNonce', () => {
  it('produces 128-bit base64 values that differ per call', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(atob(nonce)).toHaveLength(16);
  });
});
