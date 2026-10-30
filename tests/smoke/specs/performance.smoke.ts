import { expect, test, type Page } from '@playwright/test';
import { API_URL, DEMO_DATA } from '../support/env';

// Feature: performance budgets — catch regressions in what the browser must download
// and in API latency. Budgets are deliberately tight; raise them only with a reason
// recorded in memory.md.

const BUDGETS = {
  /** Compressed JavaScript transferred for a first visit (baseline 2026-10-28: 218–233 KiB). */
  javascriptBytes: 250 * 1024,
  requests: 40,
  apiReadinessMs: 500,
  /** Median of a public catalogue read (search, listing) on the API. */
  apiCatalogueMs: 300,
  /** Layout shift of the page shell while it loads; pages add their own content later. */
  layoutShift: 0.01,
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

const CATALOGUE = DEMO_DATA
  ? ['/en/search?area=syntagma', '/en/parking/syntagma-square-garage']
  : [];

for (const path of ['/en', '/en/sign-in', ...CATALOGUE]) {
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

// Header and catalogue pages render on the server; nothing may push the page down while they
// load on a phone (Cumulative Layout Shift; "good" is < 0.1 for the whole page).
for (const [path, accountNav] of [
  ['/el', 'Λογαριασμός'],
  ['/en/sign-in', 'Account'],
  ...CATALOGUE.map((catalogue) => [catalogue, 'Account'] as const),
] as const) {
  test(`${path} does not shift while loading on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.getByRole('navigation', { name: accountNav }).getByRole('link')).toHaveCount(
      2,
    );
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    test.info().annotations.push({ type: 'measurement', description: `CLS ${cls.toFixed(4)}` });
    expect(cls).toBeLessThan(BUDGETS.layoutShift);
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

  test.describe('catalogue reads', () => {
    test.skip(!DEMO_DATA, 'needs the demo listings (pnpm db:seed)');

    // Two days ahead, 08:00–10:00 UTC: on the half hour, in the future, inside opening hours.
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const reads = {
      search: `/v1/parking/search?area=syntagma&start=${day}T08:00:00.000Z&end=${day}T10:00:00.000Z`,
      listing: '/v1/parking/syntagma-square-garage',
    };

    for (const [name, path] of Object.entries(reads)) {
      test(`${name} answers within budget`, async ({ request }) => {
        await request.get(`${API_URL}${path}`); // warm up
        const timings: number[] = [];
        // Few samples: the whole suite shares one client address, and one rate-limit bucket.
        for (let i = 0; i < 3; i++) {
          const started = performance.now();
          expect((await request.get(`${API_URL}${path}`)).status()).toBe(200);
          timings.push(performance.now() - started);
        }
        const median = timings.sort((a, b) => a - b)[1] ?? Infinity;
        test.info().annotations.push({
          type: 'measurement',
          description: `${Math.round(median)} ms`,
        });
        expect(median).toBeLessThan(BUDGETS.apiCatalogueMs);
      });
    }
  });
});
