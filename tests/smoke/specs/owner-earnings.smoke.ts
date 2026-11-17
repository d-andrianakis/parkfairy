import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { addEarnings, HAS_DATABASE, unpublishListing } from '../support/db';
import { EMAIL_OUTBOX, WEB_URL } from '../support/env';
import {
  expectAccessible,
  ownVisitor,
  registerAndSignIn,
  trackCspViolations,
  uniqueEmail,
} from '../support/fixtures';

// Feature: an owner's earnings (5.1, #50, #51, #54): their own part of each booking after the
// commission, what was sent, what is on its way and what is still to come, in real tables, in
// both languages, at a phone's width. Stripe isn't needed: the worker's results go straight in.

test.use(ownVisitor);

test('earnings need an account, and send a stranger to sign in and back', async ({ page }) => {
  await page.goto('/en/owner/earnings');
  await expect(page).toHaveURL(`/en/sign-in?next=${encodeURIComponent('/owner/earnings')}`);
  // Nor is the API's answer for anyone without a session.
  expect((await page.request.get('/api/v1/owner/earnings')).status()).toBe(401);
});

test('an owner sees what was sent, what is on its way and what is to come', async ({ page }) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  test.skip(!HAS_DATABASE, 'The worker’s transfers are put in by hand');
  test.setTimeout(150_000);
  await registerAndSignIn(page, uniqueEmail('owner-earnings'), 'Owner Earnings');
  const csp = await trackCspViolations(page);
  const headers = { origin: WEB_URL };
  const created = await page.request.post('/api/v1/owner/listings', { headers });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const name = `Γκαράζ εσόδων ${randomUUID().slice(0, 6)}`;
  expect(
    (
      await page.request.patch(`/api/v1/owner/listings/${id}/location`, { headers, data: { name } })
    ).ok(),
  ).toBe(true);

  try {
    // From the dashboard; nothing yet.
    await page.goto('/en/owner');
    await page.getByRole('link', { name: 'See your earnings' }).click();
    await expect(page).toHaveURL('/en/owner/earnings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Earnings');
    await expect(page.getByText('Nothing has been sent to you yet.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expectAccessible(page);

    await addEarnings(id, { sent: [252, 150], sending: [108], coming: 2, due: 1 });
    await page.reload();
    await expect(page.getByRole('region', { name: 'Summary' })).toContainText('€4.02');
    await expect(page.getByRole('region', { name: 'Summary' })).toContainText('€1.08');
    const sent = page.getByRole('table', { name: 'Shares sent to you, newest first' });
    await expect(sent.getByRole('row')).toHaveCount(3);
    await expect(sent).toContainText('€2.52');
    await expect(sent).toContainText(name);
    const onItsWay = page.getByRole('table', { name: 'Shares worked out and not sent yet' });
    await expect(onItsWay).toContainText('Waiting: Stripe can’t pay you yet');
    await expect(onItsWay).toContainText('€1.08');
    await expect(
      page.getByRole('table', { name: 'Total sent to you for each listing' }),
    ).toContainText('€4.02');
    await expect(page.getByRole('heading', { level: 2, name: 'Sent by month' })).toBeVisible();
    await expectAccessible(page);

    // One booking is due and Stripe can't pay this owner: said in words, with the way out.
    await expect(
      page.getByText('1 booking is waiting because Stripe can’t pay you yet.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to payouts' })).toHaveAttribute(
      'href',
      '/en/owner/payouts',
    );

    // At a phone's width, in both languages: nothing scrolls sideways, not the page and not a
    // table (a scroll region a keyboard can't reach), and still no violations.
    await page.setViewportSize({ width: 320, height: 800 });
    for (const locale of ['en', 'el']) {
      await page.goto(`/${locale}/owner/earnings`);
      await expect(page.getByRole('table').first()).toBeVisible();
      const overflow = await page.evaluate(() => [
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ...[...document.querySelectorAll('[data-slot="table-container"]')].map(
          (box) => box.scrollWidth - box.clientWidth,
        ),
      ]);
      expect(
        overflow.filter((extra) => extra > 0),
        `${locale} overflow`,
      ).toEqual([]);
      await expectAccessible(page);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // In Greek: the months are named in it, amounts in its format.
    await page.goto('/el/owner/earnings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Έσοδα');
    await expect(page).toHaveTitle(/^Έσοδα/);
    await expect(page.getByRole('region', { name: 'Σύνοψη' })).toContainText('4,02');
    await expect(
      page.getByRole('table', {
        name: 'Ποσό που σας εστάλη σε καθέναν από τους τελευταίους 12 μήνες',
      }),
    ).toBeVisible();
    await expectAccessible(page);

    // A made-up place is refused before it reaches the database, and the page starts over.
    expect((await page.request.get('/api/v1/owner/earnings?after=soon')).status()).toBe(400);
    await page.goto('/en/owner/earnings?after=soon');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Earnings');
    await expect(page.getByRole('heading', { level: 2, name: 'Sent by month' })).toBeVisible();
    expect(await csp()).toEqual([]);
  } finally {
    await unpublishListing(id);
  }
});
