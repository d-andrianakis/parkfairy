import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { SIGNED_IN_STATE, WEB_URL } from '../support/env';

// Feature: the admin API (5.2a: #66–#68), on a running system. Its screens come with the admin app
// (5.2b), and an admin needs a second factor, which the suite doesn't make an account for: so this
// is what any ordinary visitor meets. Staff's own paths are in the API's integration tests.

const READS = [
  '/api/v1/admin/listings',
  `/api/v1/admin/listings/${randomUUID()}`,
  `/api/v1/admin/listings/${randomUUID()}/proofs/${randomUUID()}`,
  '/api/v1/admin/audit',
];
const WRITES = [
  `/api/v1/admin/listings/${randomUUID()}/approve`,
  `/api/v1/admin/listings/${randomUUID()}/request-changes`,
];

test('without an account, no admin route answers anything but "sign in"', async ({ request }) => {
  for (const path of READS) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
  for (const path of WRITES) {
    const response = await request.post(path, {
      headers: { origin: WEB_URL },
      data: { note: 'x' },
    });
    expect(response.status(), path).toBe(401);
  }
});

test.describe('signed in as an ordinary account', () => {
  test.use({ storageState: SIGNED_IN_STATE });

  test('no admin route is theirs: refused, not "not found"', async ({ page }) => {
    await page.goto('/en');
    for (const path of READS) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(403);
    }
    for (const path of WRITES) {
      const response = await page.request.post(path, {
        headers: { origin: WEB_URL },
        data: { note: 'x' },
      });
      expect(response.status(), path).toBe(403);
    }
  });

  test('a write from another site is refused on its origin before anything else is asked', async ({
    page,
  }) => {
    await page.goto('/en');
    for (const path of WRITES) {
      const response = await page.request.post(path, {
        headers: { origin: 'https://evil.example' },
        data: { note: 'x' },
      });
      expect(response.status(), path).toBe(403);
      expect(await response.json(), path).toMatchObject({ code: 'INVALID_ORIGIN' });
    }
  });
});
