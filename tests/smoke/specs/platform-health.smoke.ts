import { expect, test } from '@playwright/test';
import { API_URL, WORKER_URL } from '../support/env';

// Feature: platform foundation — every deployable answers its health probes.

test.describe('API', () => {
  test.skip(!API_URL, 'API is not reachable from this runner');

  test('is live and ready with its database', async ({ request }) => {
    const live = await request.get(`${API_URL}/health`);
    expect(live.status()).toBe(200);
    expect(await live.json()).toEqual({ status: 'ok' });

    const ready = await request.get(`${API_URL}/health/ready`);
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ok', checks: { database: 'up' } });
  });

  test('tags every response with a correlation id', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`, {
      headers: { 'x-request-id': 'smoke-correlation-1' },
    });
    expect(response.headers()['x-request-id']).toBe('smoke-correlation-1');
  });
});

test.describe('worker', () => {
  test.skip(!WORKER_URL, 'worker health port is not reachable from this runner');

  test('is live and its queue workers are connected to Redis', async ({ request }) => {
    expect((await request.get(`${WORKER_URL}/health`)).status()).toBe(200);
    expect((await request.get(`${WORKER_URL}/health/ready`)).status()).toBe(200);
  });
});

test('web app serves the localized home page', async ({ page }) => {
  const response = await page.goto('/en');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
