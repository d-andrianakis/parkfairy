import { expect, test } from '@playwright/test';
import { SIGNED_IN_STATE } from '../support/env';

// Feature: API session verification — the browser reaches the NestJS API same-origin
// through /api/v1 and the API trusts only Better Auth sessions.

test('anonymous requests to protected endpoints are rejected', async ({ request }) => {
  const response = await request.get('/api/v1/me');
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ statusCode: 401 });
});

test('a forged session cookie is rejected', async ({ request }) => {
  const response = await request.get('/api/v1/me', {
    headers: { cookie: 'parkfairy.session_token=forged.signature' },
  });
  expect(response.status()).toBe(401);
});

test.describe('signed in', () => {
  test.use({ storageState: SIGNED_IN_STATE });

  test('the API returns exactly the public user contract', async ({ page }) => {
    await page.goto('/el');
    const response = await page.request.get('/api/v1/me');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-request-id']).toBeTruthy();

    const me = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(me).sort()).toEqual(
      [
        'createdAt',
        'email',
        'emailVerified',
        'id',
        'locale',
        'name',
        'role',
        'twoFactorEnabled',
      ].sort(),
    );
    expect(me.role).toBe('user');
  });
});
