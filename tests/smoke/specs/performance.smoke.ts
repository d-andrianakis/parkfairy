import { expect, test, type Page } from '@playwright/test';
import { API_URL } from '../support/env';

// Feature: performance budgets — catch regressions in what the browser must download
// and in API latency. Budgets are deliberately tight; raise them only with a reason
// recorded in memory.md.

const BUDGETS = {
  /** Compressed JavaScript transferred for a first visit (baseline 2026-10-28: 218–233 KiB). */
  javascriptBytes: 250 * 1024,
  requests: 40,
  apiReadinessMs: 500,
};

async function measureFirstVisit(page: Page, path: string) {
  const scripts: Promise<number>[] = [];
  let requests = 0;
  page.on('requestfinished', (request) => {
    requests++;
    if (request.resourceType() === 'script') {
      scripts.push(request.sizes().then((sizes) => sizes.responseBodySize));
    }
  });
  await page.goto(path, { waitUntil: 'networkidle' });
  const javascriptBytes = (await Promise.all(scripts)).reduce((sum, size) => sum + size, 0);
  return { javascriptBytes, requests };
}

for (const path of ['/en', '/en/sign-in']) {
  test(`${path} stays within the first-visit budget`, async ({ page }) => {
    const { javascriptBytes, requests } = await measureFirstVisit(page, path);
    test.info().annotations.push({
      type: 'measurement',
      description: `${Math.round(javascriptBytes / 1024)} KiB JS, ${requests} requests`,
    });
    expect(javascriptBytes).toBeLessThan(BUDGETS.javascriptBytes);
    expect(requests).toBeLessThan(BUDGETS.requests);
  });
}

test.describe('API', () => {
  test.skip(!API_URL, 'API is not reachable from this runner');

  test('readiness answers within budget', async ({ request }) => {
    await request.get(`${API_URL}/health/ready`); // warm the connection pool
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      expect((await request.get(`${API_URL}/health/ready`)).status()).toBe(200);
      timings.push(performance.now() - started);
    }
    const median = timings.sort((a, b) => a - b)[2] ?? Infinity;
    expect(median).toBeLessThan(BUDGETS.apiReadinessMs);
  });
});
