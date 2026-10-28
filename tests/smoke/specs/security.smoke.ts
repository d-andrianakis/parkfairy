import { expect, test } from '@playwright/test';
import { API_URL, SIGNED_IN_STATE, WEB_URL } from '../support/env';
import { trackCspViolations } from '../support/fixtures';

// Feature: security baseline — headers, CSP nonces, cookie flags, CSRF and redirects.

test('pages send a strict, per-request nonce CSP and hardening headers', async ({ request }) => {
  const first = await request.get('/en');
  const second = await request.get('/en');
  const headers = first.headers();
  const csp = headers['content-security-policy'] ?? '';

  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  expect(second.headers()['content-security-policy']).not.toBe(csp);

  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['strict-transport-security']).toContain('max-age=');
  expect(headers['x-powered-by']).toBeUndefined();
});

test('every script on the page carries the response nonce', async ({ request }) => {
  const response = await request.get('/en/sign-in');
  const nonce = /'nonce-([^']+)'/.exec(response.headers()['content-security-policy'] ?? '')?.[1];
  const html = await response.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];

  expect(nonce).toBeTruthy();
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
});

test('the app runs without CSP violations', async ({ page }) => {
  const violations = await trackCspViolations(page);
  await page.goto('/en/sign-in');
  // Client-side validation proves the hydrated JavaScript executed under the policy.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  expect(await violations()).toEqual([]);
});

test.describe('API', () => {
  test.skip(!API_URL, 'API is not reachable from this runner');

  test('sends hardening headers', async ({ request }) => {
    const headers = (await request.get(`${API_URL}/health`)).headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['x-powered-by']).toBeUndefined();
  });
});

test.describe('signed in', () => {
  test.use({ storageState: SIGNED_IN_STATE });

  test('the session cookie is HttpOnly and SameSite=Lax (Secure on https)', async ({ page }) => {
    await page.goto('/en');
    const cookie = (await page.context().cookies()).find((c) => c.name.endsWith('session_token'));
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.secure).toBe(WEB_URL.startsWith('https://'));
  });

  test('cookie-authenticated writes from another site are refused (CSRF)', async ({ page }) => {
    await page.goto('/en');
    // page.request carries the real session cookie, exactly as a cross-site form post would.
    const response = await page.request.post('/api/auth/update-user', {
      headers: { origin: 'https://evil.example' },
      data: { name: 'Hijacked' },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'INVALID_ORIGIN' });
  });

  test('sign-in ignores off-site return URLs', async ({ page }) => {
    await page.goto('/en/sign-in?next=//evil.example/phish');
    await expect(page).toHaveURL('/en/account');
  });
});
