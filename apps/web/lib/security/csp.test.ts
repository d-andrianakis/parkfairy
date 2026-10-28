import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, createNonce } from './csp';

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name ?? '', values];
    }),
  );
}

describe('buildContentSecurityPolicy', () => {
  const production = directives(
    buildContentSecurityPolicy({ nonce: 'abc', isDev: false, upgradeInsecureRequests: true }),
  );

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
