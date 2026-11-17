import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { addBookings, HAS_DATABASE, publishListing, unpublishListing } from '../support/db';
import { EMAIL_OUTBOX } from '../support/env';
import {
  expectAccessible,
  ownVisitor,
  registerAndSignIn,
  trackCspViolations,
  uniqueEmail,
} from '../support/fixtures';
import { athensDay, listingWithStaff } from '../support/listings';

// Feature: the owner's calendar (5.1): the confirmed bookings of their listings, a month at a
// time and a day at a time, as a list that reads the same on a phone and to a screen reader, in
// both languages, with a filter that works without scripts.

test.use(ownVisitor);

test('the calendar needs an account, and sends a stranger to sign in and back', async ({
  page,
}) => {
  await page.goto('/en/owner/calendar');
  await expect(page).toHaveURL(`/en/sign-in?next=${encodeURIComponent('/owner/calendar')}`);
  expect((await page.request.get('/api/v1/owner/calendar')).status()).toBe(401);
});

test('an owner finds their bookings by the day they start, month by month', async ({ page }) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  test.skip(!HAS_DATABASE, 'Putting a listing live and booking it are done by hand');
  test.setTimeout(150_000);
  await registerAndSignIn(page, uniqueEmail('owner-calendar'), 'Owner Calendar');
  const csp = await trackCspViolations(page);
  const name = `Γκαράζ ημερολογίου ${randomUUID().slice(0, 6)}`;
  const { id } = await listingWithStaff(page, name, { spaces: ['Α1'], contentLocale: 'en' });
  await publishListing(id);
  await addBookings(id, 2);
  // Tomorrow's month, the first booking starts on.
  const month = athensDay(1).slice(0, 7);

  try {
    await page.goto('/en/owner');
    await page.getByRole('link', { name: 'See your calendar' }).click();
    await expect(page).toHaveURL('/en/owner/calendar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendar');
    await expect(page).toHaveTitle(/^Calendar/);

    await page.goto(`/en/owner/calendar?month=${month}`);
    await expect(
      page.getByRole('heading', { level: 3, name: /^Booking [0-9A-Z]{4}-[0-9A-Z]{4}$/ }).first(),
    ).toBeVisible();
    const day = page.getByRole('heading', { level: 2 }).first();
    await expect(day).toContainText(/\w+day, \w+ \d+/);
    await expect(page.getByText('IKB1234').first()).toBeVisible();
    await expectAccessible(page);

    // The filter is a plain form: choose the listing, and the address carries it.
    await page.getByLabel('Listing').selectOption({ label: name });
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page).toHaveURL(new RegExp(`month=${month}&listing=${id}`));
    await expect(page.getByLabel('Listing')).toHaveValue(id);
    // One listing chosen: each card needn't say which it is.
    await expect(page.getByText('Listing', { exact: true })).toHaveCount(1); // the select's label
    await page.getByRole('link', { name: 'Open this listing’s bookings' }).first().click();
    await expect(page).toHaveURL(`/en/owner/listings/${id}/bookings`);

    // A month with nothing says so, and the months run both ways.
    await page.goto(`/en/owner/calendar?month=${month}`);
    await page.getByRole('link', { name: 'Previous month' }).click();
    await expect(page).toHaveURL(/\/en\/owner\/calendar\?month=\d{4}-\d{2}/);
    await expect(page.getByText('No bookings this month.')).toBeVisible();
    await expectAccessible(page);
    await expect(page.getByRole('link', { name: 'Next month' })).toBeVisible();

    // Anything that isn't a month or a listing starts over on this month, never an error.
    await page.goto('/en/owner/calendar?month=soon&listing=garage');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendar');
    await expect(page.getByRole('combobox', { name: 'Listing' })).toHaveValue('');
    await page.goto('/en/owner/calendar?month=1999-01');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendar');
    await expect(page.getByRole('combobox', { name: 'Listing' })).toBeVisible();

    // At a phone's width, and in Greek.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/el/owner/calendar?month=${month}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ημερολόγιο');
    await expect(page).toHaveTitle(/^Ημερολόγιο/);
    await expect(page.getByRole('navigation', { name: 'Μήνας' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    expect(await csp()).toEqual([]);
  } finally {
    await unpublishListing(id);
  }
});
