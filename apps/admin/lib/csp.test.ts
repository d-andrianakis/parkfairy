import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy, createNonce } from './csp';

const build = (options: Partial<Parameters<typeof buildContentSecurityPolicy>[0]> = {}) =>
  buildContentSecurityPolicy({
    nonce: 'abc',
    isDev: false,
    upgradeInsecureRequests: false,
    ...options,
  });

/** The policy as a map of directive to its sources, so a test says exactly what is allowed. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split('; ').map((part) => {
      const [name = '', ...sources] = part.split(' ');
      return [name, sources];
    }),
  );
}

describe('the staff app’s content security policy', () => {
  it('is exactly this in production: nothing from outside, scripts by nonce alone', () => {
    expect(directives(build())).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", "'nonce-abc'", "'strict-dynamic'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'frame-src': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
    });
  });

  it('lets scripts alone use eval, and only in development', () => {
    expect(directives(build({ isDev: true }))['script-src']).toEqual([
      "'self'",
      "'nonce-abc'",
      "'strict-dynamic'",
      "'unsafe-eval'",
    ]);
    expect(build({ isDev: true }).match(/unsafe-eval/g)).toHaveLength(1);
  });

  it('upgrades insecure requests only when asked', () => {
    expect(directives(build())).not.toHaveProperty('upgrade-insecure-requests');
    expect(directives(build({ upgradeInsecureRequests: true }))).toHaveProperty(
      'upgrade-insecure-requests',
    );
  });

  it('makes a fresh nonce each time', () => {
    expect(createNonce()).not.toBe(createNonce());
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
