// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import proxy, { config } from './proxy';

const request = (path = '/en/listings', headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3001${path}`, { headers });
const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1];

describe('the staff app’s proxy', () => {
  it('sets a policy on the response, and the same nonce on the request it forwards', () => {
    const response = proxy(request());
    const csp = response.headers.get('content-security-policy') ?? '';
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();
    // How next-intl hands the changed request headers on to rendering.
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  });

  it('uses a new nonce for each request', () => {
    const [a, b] = [proxy(request()), proxy(request())].map((response) =>
      nonceOf(response.headers.get('content-security-policy') ?? ''),
    );
    expect(a).not.toBe(b);
  });

  it('upgrades requests only where https is in use, or said to be by the proxy in front', () => {
    expect(proxy(request()).headers.get('content-security-policy')).not.toContain(
      'upgrade-insecure-requests',
    );
    expect(
      proxy(request('/en/listings', { 'x-forwarded-proto': 'https' })).headers.get(
        'content-security-policy',
      ),
    ).toContain('upgrade-insecure-requests');
    expect(
      proxy(new NextRequest('https://staff.example.gr/en/listings')).headers.get(
        'content-security-policy',
      ),
    ).toContain('upgrade-insecure-requests');
  });

  it('allows no eval outside development', () => {
    expect(proxy(request()).headers.get('content-security-policy')).not.toContain('unsafe-eval');
  });

  it('negotiates the language: the root goes to one, and a locale prefix stays', () => {
    const root = proxy(request('/', { 'accept-language': 'en' }));
    expect(root.status).toBeGreaterThanOrEqual(300);
    expect(root.headers.get('location')).toContain('/en');
    expect(proxy(request('/el/audit')).status).toBe(200);
  });

  it('covers pages, and leaves the API, Next’s own files and static files alone', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const page of ['/', '/en/listings', '/el/audit', '/en/listings/abc']) {
      expect(matcher.test(page), page).toBe(true);
    }
    for (const other of [
      '/api/auth/sign-out',
      '/api/v1/admin/listings',
      '/_next/static/x.js',
      '/a.png',
    ]) {
      expect(matcher.test(other), other).toBe(false);
    }
  });
});
