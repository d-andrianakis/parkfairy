import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  addBookingHistory,
  addBookings,
  HAS_DATABASE,
  publishListing,
  unpublishListing,
} from '../support/db';
import { EMAIL_OUTBOX } from '../support/env';
import {
  expectAccessible,
  ownVisitor,
  registerAndSignIn,
  trackCspViolations,
  uniqueEmail,
} from '../support/fixtures';
import { athensDay, listingWithStaff } from '../support/listings';

// Feature: the owner's list of bookings across listings (5.1): what is coming up, over and
// cancelled, by listing and by the days stays start on, in both languages, a form that works
// without scripts, and a page that reads the same on a phone and to a screen reader.

test.use(ownVisitor);

test('the list needs an account, and sends a stranger to sign in and back', async ({ page }) => {
  await page.goto('/en/owner/bookings');
  await expect(page).toHaveURL(`/en/sign-in?next=${encodeURIComponent('/owner/bookings')}`);
  expect((await page.request.get('/api/v1/owner/bookings')).status()).toBe(401);
});

test('an owner finds their bookings by group, listing and days', async ({ page }) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  test.skip(!HAS_DATABASE, 'Putting a listing live and booking it are done by hand');
  test.setTimeout(150_000);
  await registerAndSignIn(page, uniqueEmail('owner-bookings'), 'Owner Bookings');
  const csp = await trackCspViolations(page);
  const name = `Γκαράζ κρατήσεων ${randomUUID().slice(0, 6)}`;
  const { id } = await listingWithStaff(page, name, { spaces: ['Α1'], contentLocale: 'en' });
  await publishListing(id);
  await addBookings(id, 2);
  await addBookingHistory(id, { past: 3, cancelled: 2 });
  const card = page.getByRole('heading', { level: 3, name: /^Booking [0-9A-Z]{4}-[0-9A-Z]{4}$/ });

  try {
    // From the dashboard: what is coming up, and nothing else.
    await page.goto('/en/owner');
    await page.getByRole('link', { name: 'See all bookings' }).click();
    await expect(page).toHaveURL('/en/owner/bookings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('All bookings');
    await expect(page).toHaveTitle(/^Upcoming bookings/);
    await expect(card).toHaveCount(2);
    await expect(page.getByText('IKB1234').first()).toBeVisible();
    await expect(page.getByText('Upcoming', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Which bookings' }).getByRole('link', {
        name: 'Upcoming',
      }),
    ).toHaveAttribute('aria-current', 'page');
    await expectAccessible(page);

    // Over: the last 90 days, says so, and every stay says it is over.
    await page.getByRole('link', { name: 'Past' }).click();
    await expect(page).toHaveTitle(/^Past bookings/);
    await expect(page).toHaveURL('/en/owner/bookings?status=past');
    await expect(card).toHaveCount(3);
    await expect(
      page.getByText(/^Showing bookings whose stay starts from .+ to .+\.$/),
    ).toBeVisible();
    await expect(page.getByText('Ended', { exact: true })).toHaveCount(3);
    // Axe at once can catch the tab's fill mid-transition (memory.md).
    await page.evaluate(() =>
      Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
    );
    await expectAccessible(page);

    // Days: a plain form, one day, and the address carries it.
    const yesterday = athensDay(-1);
    await page.getByLabel('First day').fill(yesterday);
    await page.getByLabel('Last day').fill(yesterday);
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page).toHaveURL(new RegExp(`status=past.*from=${yesterday}.*to=${yesterday}`));
    await expect(card).toHaveCount(1);
    await expect(page.getByLabel('First day')).toHaveValue(yesterday);

    // Days the wrong way round are told so and kept to correct, not turned into an error page.
    await page.goto(`/en/owner/bookings?status=past&from=${athensDay(-1)}&to=${athensDay(-5)}`);
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'The last day is before the first day',
    );
    await expect(page).toHaveTitle(/^Error: Past bookings/);
    // The reason links to the field to change, and the last day carries it.
    await expect(
      page.getByRole('main').getByRole('link', { name: /^The last day is before/ }),
    ).toHaveAttribute('href', '#booking-list-to');
    await expect(page.getByLabel('Last day')).toHaveAccessibleDescription(
      /^The last day is before the first day/,
    );
    await expect(page.getByLabel('First day')).toHaveValue(athensDay(-1));
    await expect(card).toHaveCount(0);
    await expectAccessible(page);

    // Cancelled: who did it, and the one still to come is first.
    await page.goto('/en/owner/bookings');
    await page.getByRole('link', { name: 'Cancelled' }).click();
    await expect(page).toHaveURL('/en/owner/bookings?status=cancelled');
    await expect(page).toHaveTitle(/^Cancelled bookings/);
    await expect(card).toHaveCount(2);
    await expect(page.getByText('The driver').first()).toBeVisible();
    await expect(page.getByText('Cancelled by').first()).toBeVisible();
    await expectAccessible(page);

    // One listing: the filter is a plain form and the address carries the choice.
    await page.getByLabel('Listing').selectOption({ label: name });
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page).toHaveURL(new RegExp(`status=cancelled.*listing=${id}`));
    await expect(page.getByLabel('Listing')).toHaveValue(id);
    await expect(card).toHaveCount(2);
    // A coming booking leads on to where it can be called off.
    await page.getByRole('link', { name: 'Upcoming' }).click();
    await page
      .getByRole('link', { name: /^Open this listing’s bookings/ })
      .first()
      .click();
    await expect(page).toHaveURL(`/en/owner/listings/${id}/bookings`);

    // Anything that isn't a group, a listing, a day or a place starts over, never an error.
    await page.goto('/en/owner/bookings?status=all&listing=garage&from=soon&after=next');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('All bookings');
    await expect(page.getByRole('combobox', { name: 'Listing' })).toHaveValue('');
    await expect(card).toHaveCount(2);

    // At a phone's width, and in Greek.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/el/owner/bookings?status=cancelled');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Όλες οι κρατήσεις');
    await expect(page).toHaveTitle(/^Ακυρωμένες κρατήσεις/);
    await expect(page.getByRole('navigation', { name: 'Ποιες κρατήσεις' })).toBeVisible();
    await expect(page.getByText('Ποιος ακύρωσε').first()).toBeVisible();
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
