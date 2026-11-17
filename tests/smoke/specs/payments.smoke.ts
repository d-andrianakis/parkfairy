import { randomUUID } from 'node:crypto';

import { expect, type Page, request as http, test } from '@playwright/test';

import {
  activatePayouts,
  disputeOf,
  HAS_DATABASE,
  publishListing,
  refundOf,
  unpublishListing,
} from '../support/db';
import { EMAIL_OUTBOX, WEB_URL } from '../support/env';
import { expectAccessible, ownVisitor, registerAndSignIn, uniqueEmail } from '../support/fixtures';
import { athensDay, listingWithStaff } from '../support/listings';

// Feature: payments (Phase 4, round 4.1), in Stripe's test mode (memory.md #46–#49). Owners set up
// payouts in Stripe's Express onboarding; drivers pay in the Payment Element on the booking's page,
// the one page whose CSP lets Stripe in; Stripe's signed webhook settles the booking. Without
// Stripe's keys (#47) owners are told payouts can't be set up, and only a local run books, without
// paying: what runs here until test keys exist. Round 4.2: a paid booking called off is refunded
// at Stripe at once, by its terms, and the ledger has both the charge and the refund. Round 4.3:
// a payment the driver's bank disputes is recorded, its evidence staged for support (#59).

test.use(ownVisitor);

/** Whether this run's API has Stripe: the payouts answer says so. */
async function withStripe(page: Page): Promise<boolean> {
  const response = await page.request.get('/api/v1/owner/payouts');
  return response.ok() && ((await response.json()) as { available: boolean }).available;
}

test('without Stripe, the payouts page says so in both languages, and the webhook isn’t there', async ({
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  await registerAndSignIn(page, uniqueEmail('payouts-owner'), 'Owner Payouts');
  test.skip(await withStripe(page), 'Runs where Stripe isn’t configured');

  await page.goto('/en/owner/payouts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Getting paid');
  await expect(page.getByText('Payouts can’t be set up here yet.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expectAccessible(page);
  await page.goto('/el/owner/payouts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Πώς πληρώνεστε');
  await expect(page).toHaveTitle(/^Πληρωμές προς εσάς/);
  await expectAccessible(page);

  // Nothing to set up from the dashboard either.
  await page.goto('/en/owner');
  await expect(page.getByRole('link', { name: 'Set up payouts' })).toHaveCount(0);

  const event = {
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=0' },
    data: JSON.stringify({ id: 'evt_x', type: 'payment_intent.succeeded' }),
  };
  // With a browser's session cookie and no origin, the CSRF guard refuses it before anything.
  expect((await page.request.post('/api/v1/payments/webhook', event)).status()).toBe(403);
  // As Stripe sends it, without cookies: there is no endpoint without Stripe.
  const stripe = await http.newContext({ baseURL: WEB_URL });
  try {
    expect((await stripe.post('/api/v1/payments/webhook', event)).status()).toBe(404);
  } finally {
    await stripe.dispose();
  }
});

test('only a booking’s page lets Stripe’s scripts and frames in', async ({ page }) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  await registerAndSignIn(page, uniqueEmail('payments-csp'), 'Driver Csp');
  const policyOf = async (path: string) =>
    (await page.request.get(path, { maxRedirects: 0 })).headers()['content-security-policy'] ?? '';

  const paying = await policyOf(`/en/bookings/${randomUUID()}`);
  expect(paying).toContain(
    "frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
  );
  expect(paying).toContain(
    "connect-src 'self' https://api.stripe.com https://merchant-ui-api.stripe.com",
  );
  expect(paying).toMatch(/script-src [^;]*'strict-dynamic'/);
  expect(paying).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  for (const path of ['/en/bookings', '/el/parking/anything', '/en/owner/payouts', '/en']) {
    expect(await policyOf(path), path).not.toContain('stripe.com');
  }
});

test('with Stripe’s test keys: a driver pays, is booked, cancels and is refunded', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
  test.skip(!HAS_DATABASE, 'Putting a listing live is done by hand in the database');
  test.setTimeout(180_000);
  await registerAndSignIn(page, uniqueEmail('paid-owner'), 'Owner Paid');
  test.skip(!(await withStripe(page)), 'Needs Stripe’s test keys (decision #47)');

  const name = `Γκαράζ πληρωμής ${randomUUID().slice(0, 6)}`;
  const { id, slug } = await listingWithStaff(page, name);
  await publishListing(id);
  await activatePayouts(id);
  const day = athensDay(16);
  const context = await browser.newContext();
  const driver = await context.newPage();
  try {
    await registerAndSignIn(driver, uniqueEmail('paying-driver'), 'Driver Paying');
    await driver.goto(
      `/en/parking/${slug}?startDate=${day}&startTime=10:00&endDate=${day}&endTime=12:00`,
    );
    await driver.getByRole('button', { name: 'Book this space' }).click();
    // A page of its own (its CSP lets Stripe in), not a client navigation.
    await expect(driver).toHaveURL(/\/en\/bookings\/[0-9a-f-]{36}$/);
    await driver.getByRole('textbox', { name: 'Number plate' }).fill('IKB1234');
    await driver.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(driver.getByRole('heading', { level: 2, name: 'Payment' })).toBeFocused();
    // Stripe's test card, in Stripe's own frame.
    const card = driver.frameLocator('iframe[title*="payment"]').first();
    await card.getByLabel(/card number/i).fill('4242 4242 4242 4242');
    await card.getByLabel(/expiration/i).fill('12 / 34');
    await card.getByLabel(/security code|cvc/i).fill('123');
    await expectAccessible(driver);
    await driver.getByRole('button', { name: /^Pay / }).click();
    await expect(driver.getByRole('heading', { level: 2, name: 'Booking confirmed' })).toBeFocused({
      timeout: 60_000,
    });
    const bookingId = /bookings\/([0-9a-f-]{36})/.exec(driver.url())?.[1] ?? '';

    // Called off sixteen days ahead: all of it back, sent to Stripe as it is cancelled (4.2).
    await driver.getByRole('button', { name: 'Cancel booking' }).click();
    await driver.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(
      driver.getByRole('heading', { level: 2, name: 'Booking cancelled' }),
    ).toBeFocused();
    const back = driver.getByText(/^You cancelled this booking\. €[\d.]+ comes back to you\.$/);
    await expect(back).toBeVisible();
    const { refundStatus, ledger } = await refundOf(bookingId);
    expect(refundStatus).toBe('sent');
    expect(ledger.refund).toBeGreaterThan(0);
    expect(ledger.refund).toBe(ledger.charge);
    await expect(driver).toHaveTitle(/^Cancelled booking/);
    await expectAccessible(driver);
    // And in Greek, a page of its own.
    await driver.goto(`/el/bookings/${bookingId}`);
    await expect(driver.getByRole('heading', { level: 1 })).toHaveText('Ακυρωμένη κράτηση');
    await expect(
      driver.getByText(/^Ακυρώσατε αυτή την κράτηση\. Θα σας επιστραφεί ποσό \d+,\d{2}\s€\.$/),
    ).toBeVisible();
    await expectAccessible(driver);
  } finally {
    await context.close();
    await unpublishListing(id);
  }
});

test('with Stripe’s test keys: a disputed payment is recorded, its evidence staged (#59)', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
  test.skip(!HAS_DATABASE, 'Putting a listing live is done by hand in the database');
  test.setTimeout(240_000);
  await registerAndSignIn(page, uniqueEmail('disputed-owner'), 'Owner Disputed');
  test.skip(!(await withStripe(page)), 'Needs Stripe’s test keys (decision #47)');

  const { id, slug } = await listingWithStaff(
    page,
    `Γκαράζ αμφισβήτησης ${randomUUID().slice(0, 6)}`,
  );
  await publishListing(id);
  await activatePayouts(id);
  const day = athensDay(17);
  const context = await browser.newContext();
  const driver = await context.newPage();
  try {
    await registerAndSignIn(driver, uniqueEmail('disputing-driver'), 'Driver Disputing');
    await driver.goto(
      `/en/parking/${slug}?startDate=${day}&startTime=10:00&endDate=${day}&endTime=12:00`,
    );
    await driver.getByRole('button', { name: 'Book this space' }).click();
    await expect(driver).toHaveURL(/\/en\/bookings\/[0-9a-f-]{36}$/);
    const bookingId = /bookings\/([0-9a-f-]{36})/.exec(driver.url())?.[1] ?? '';
    await driver.getByRole('textbox', { name: 'Number plate' }).fill('IKB1234');
    await driver.getByRole('button', { name: 'Continue to payment' }).click();
    // Stripe's test card that is paid, then disputed by the bank.
    const card = driver.frameLocator('iframe[title*="payment"]').first();
    await card.getByLabel(/card number/i).fill('4000 0000 0000 0259');
    await card.getByLabel(/expiration/i).fill('12 / 34');
    await card.getByLabel(/security code|cvc/i).fill('123');
    await driver.getByRole('button', { name: /^Pay / }).click();
    await expect(driver.getByRole('heading', { level: 2, name: 'Booking confirmed' })).toBeFocused({
      timeout: 60_000,
    });
    // Stripe's webhook brings the dispute: recorded, the booking's facts staged at Stripe.
    await expect
      .poll(() => disputeOf(bookingId), { timeout: 90_000 })
      .toMatchObject({
        // Open, for support to answer in Stripe (#59): staged, never submitted for them.
        status: 'needs_response',
        evidenceStaged: true,
      });
  } finally {
    await context.close();
    await unpublishListing(id);
  }
});
