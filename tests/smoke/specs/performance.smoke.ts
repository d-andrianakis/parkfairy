import { expect, test, type Page } from '@playwright/test';
import { API_URL, DEMO_DATA, SIGNED_IN_STATE, WEB_URL } from '../support/env';

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

async function expectWithinBudget(page: Page, path: string) {
  const { javascriptBytes, requests } = await measureFirstVisit(page, path);
  test.info().annotations.push({
    type: 'measurement',
    description: `${Math.round(javascriptBytes / 1024)} KiB JS, ${requests} requests`,
  });
  expect(javascriptBytes).toBeLessThan(BUDGETS.javascriptBytes);
  expect(requests).toBeLessThan(BUDGETS.requests);
}

/** Cumulative Layout Shift on a phone until `ready` resolves ("good" is < 0.1). */
async function measureLayoutShift(page: Page, path: string, ready: () => Promise<void>) {
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
  await ready();
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  test.info().annotations.push({ type: 'measurement', description: `CLS ${cls.toFixed(4)}` });
  return cls;
}

const ACCOUNT_PAGES = [
  '/en/sign-in',
  '/en/sign-up',
  '/en/forgot-password',
  '/en/reset-password?token=x',
  '/en/verify-email?token=x',
  '/en/verify-email',
  '/en/two-factor',
];

for (const path of ['/en', ...ACCOUNT_PAGES, ...CATALOGUE]) {
  test(`${path} stays within the first-visit budget`, async ({ page }) => {
    await expectWithinBudget(page, path);
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
    const cls = await measureLayoutShift(page, path, async () => {
      await expect(
        page.getByRole('navigation', { name: accountNav }).getByRole('link'),
      ).toHaveCount(3);
      // Those links are server-rendered. The search form's swap to the picker field comes later.
      if (path !== '/el' && !path.includes('/search')) return;
      await expect(
        page.getByRole('combobox', { name: path.startsWith('/el') ? 'Από' : 'From', exact: true }),
      ).toBeVisible();
    });
    expect(cls).toBeLessThan(BUDGETS.layoutShift);
  });
}

// A reloaded "check your inbox" panel: the server can't read the address, so `SentPlaceholder`
// holds the place until the page hydrates. In both languages, because the Greek text is longer.
for (const path of [
  '/en/sign-up',
  '/el/sign-up',
  '/en/forgot-password',
  '/el/forgot-password',
  '/en/verify-email',
  '/el/verify-email',
]) {
  test(`${path}?sent=1 does not shift while its panel comes back`, async ({ page }) => {
    const address = 'maria@example.gr';
    const pathname = path.slice('/en'.length);
    await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [
      `parkfairy.sent-to:${pathname}`,
      address,
    ] as const);
    const cls = await measureLayoutShift(page, `${path}?sent=1`, () =>
      expect(page.getByText(address)).toBeVisible(),
    );
    expect(cls).toBeLessThan(BUDGETS.layoutShift);
  });
}

// The account page adds the API identity (fetched in the browser) and two-factor settings.
test.describe('signed in', () => {
  test.use({ storageState: SIGNED_IN_STATE });

  test('/en/account stays within the first-visit budget', async ({ page }) => {
    await expectWithinBudget(page, '/en/account');
  });

  for (const path of ['/en/owner', '/en/owner/profile', '/en/owner/tax']) {
    test(`${path} stays within the first-visit budget`, async ({ page }) => {
      await expectWithinBudget(page, path);
    });
  }

  test('/en/owner does not shift while loading, on a phone', async ({ page }) => {
    const cls = await measureLayoutShift(page, '/en/owner', () =>
      expect(page.getByRole('progressbar')).toBeVisible(),
    );
    expect(cls).toBeLessThan(BUDGETS.layoutShift);
  });

  test('the location step keeps the map out of a first visit', async ({ page }) => {
    const headers = { origin: WEB_URL };
    const created = await page.request.post('/api/v1/owner/listings', { headers });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    try {
      const mapbox: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('mapbox')) mapbox.push(request.url());
      });
      await expectWithinBudget(page, `/en/owner/listings/${id}/location`);
      expect(mapbox).toEqual([]);
    } finally {
      await page.request.delete(`/api/v1/owner/listings/${id}`, { headers });
    }
  });

  test('closures and special hours stay within the first-visit budget', async ({ page }) => {
    const headers = { origin: WEB_URL };
    const created = await page.request.post('/api/v1/owner/listings', { headers });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    try {
      await expectWithinBudget(page, `/en/owner/listings/${id}/closures`);
    } finally {
      await page.request.delete(`/api/v1/owner/listings/${id}`, { headers });
    }
  });

  test('/en/account does not shift while the API answers, on a phone', async ({ page }) => {
    const cls = await measureLayoutShift(page, '/en/account', () =>
      expect(page.getByTestId('api-user-id')).toHaveText(/^[0-9a-f-]{36}$/),
    );
    expect(cls).toBeLessThan(BUDGETS.layoutShift);
  });
});

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
