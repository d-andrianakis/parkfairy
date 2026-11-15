import type { Page } from '@playwright/test';

/** What a first visit may download (baseline 2026-10-28: 218–233 KiB on the public site). */
export const FIRST_VISIT = {
  /** Compressed JavaScript transferred. Raise it only with a reason recorded in memory.md. */
  javascriptBytes: 250 * 1024,
  requests: 40,
};

/** Loads a page cold and counts the compressed script bytes and requests it took. */
export async function measureFirstVisit(page: Page, url: string) {
  const scripts: Promise<number>[] = [];
  let requests = 0;
  page.on('requestfinished', (request) => {
    requests++;
    if (request.resourceType() === 'script') {
      scripts.push(request.sizes().then((sizes) => sizes.responseBodySize));
    }
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  const javascriptBytes = (await Promise.all(scripts)).reduce((sum, size) => sum + size, 0);
  return { javascriptBytes, requests };
}
