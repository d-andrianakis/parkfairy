import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

import {
  backdateConfirmation,
  HAS_DATABASE,
  publishListing,
  setStay,
  stayIn,
  unpublishListing,
} from '../support/db';
import { waitForEmail } from '../support/email';
import { EMAIL_OUTBOX, WEB_URL, WORKER_URL } from '../support/env';
import {
  expectAccessible,
  ownDriver,
  ownVisitor,
  registerAndSignIn,
  trackCspViolations,
  uniqueEmail,
} from '../support/fixtures';
import { athensDay, athensInstant, listingWithStaff } from '../support/listings';

// Feature: the booking pass, reminders and the calendar file (5A.3). The pass is the booking's reference
// as text and a QR of the reference alone; it can be kept on the device for a car park with no signal,
// and signing out removes it. A reminder goes out before a stay, unless the driver turned them off.

test.use(ownVisitor);

const headers = { origin: WEB_URL };
/** The worker looks for reminders every minute and sends what is due every 30 seconds. */
const WORKER_EMAIL = { timeout: 120_000 };
const REFERENCE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

async function bookingOpen(page: Page, slug: string): Promise<boolean> {
  const response = await page.request.get(`/api/v1/parking/${slug}`);
  return ((await response.json()) as { bookingOpen: boolean }).bookingOpen;
}

test('a driver opens the pass, keeps it for no signal, takes the calendar file and is reminded', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
  test.skip(!HAS_DATABASE, 'Putting a listing live is done by hand in the database');
  test.setTimeout(420_000);

  await registerAndSignIn(page, uniqueEmail('pass-owner'), 'Owner Pass');
  const name = `Γκαράζ κάρτας ${randomUUID().slice(0, 6)}`;
  const gate = `Κωδικός πύλης ${randomUUID().slice(0, 6)}`;
  const { id, slug } = await listingWithStaff(page, name, { arrivalInstructions: gate });
  await publishListing(id);
  const { context, page: driver } = await ownDriver(browser, 'pass-driver');
  const other = await ownDriver(browser, 'pass-other');
  const csp = await trackCspViolations(driver);

  try {
    test.skip(
      !(await bookingOpen(driver, slug)),
      'Bookings are confirmed without payment locally only',
    );
    // A booking made as a driver does, through the API: held, then confirmed with a plate.
    const day = athensDay(21);
    const start = athensInstant(day, '10:00');
    const end = athensInstant(day, '12:00');
    const detail = (await (
      await driver.request.get(`/api/v1/parking/${slug}`, { params: { start, end } })
    ).json()) as { spaces: { id: string }[] };
    const held = await driver.request.post('/api/v1/bookings', {
      headers,
      data: { listing: slug, spaceId: detail.spaces[0]?.id, start, end },
    });
    expect(held.status()).toBe(201);
    const { id: bookingId } = (await held.json()) as { id: string };
    const confirmed = await driver.request.post(`/api/v1/bookings/${bookingId}/confirm`, {
      headers,
      data: { vehiclePlate: 'ΙΚΒ-1234' },
    });
    expect(confirmed.status()).toBe(200);
    const { reference } = (await confirmed.json()) as { reference: string };
    expect(reference).toMatch(REFERENCE);
    const passUrl = `/en/bookings/${bookingId}/pass`;

    // From the booking, as a page load: the pass's own policy lets it register its worker.
    await driver.goto(`/en/bookings/${bookingId}`);
    await driver.getByRole('link', { name: 'Open the booking pass' }).click();
    await expect(driver).toHaveURL(passUrl);
    await expect(driver.getByRole('heading', { level: 1 })).toHaveText('Your booking pass');
    await expect(driver.getByTestId('pass-reference')).toHaveText(reference);
    await expect(
      driver.getByRole('img', { name: `QR code of the booking reference ${reference}` }),
    ).toBeVisible();
    // Far ahead, so the way in waits; the pass says when, and shows no code.
    await expect(driver.getByText(/Shown here from /)).toBeVisible();
    await expect(driver.getByText(gate)).toHaveCount(0);
    await expectAccessible(driver);
    // In Greek, on a phone: nothing runs off the screen.
    await driver.setViewportSize({ width: 320, height: 800 });
    await driver.goto(`/el/bookings/${bookingId}/pass`);
    await expect(driver.getByRole('heading', { level: 1 })).toHaveText('Η κάρτα κράτησής σας');
    expect(
      await driver.evaluate(() => document.documentElement.scrollWidth - document.body.clientWidth),
    ).toBeLessThanOrEqual(0);
    await expectAccessible(driver);
    await driver.setViewportSize({ width: 1280, height: 800 });
    await driver.goto(passUrl);

    // The calendar file: the place, the space and the reference, and nothing private.
    const download = driver.waitForEvent('download');
    await driver.getByRole('link', { name: 'Add to calendar' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`parkfairy-${reference}.ics`);
    const text = (await readFile((await file.path()) ?? '', 'utf8')).replaceAll('\r\n ', '');
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain(`UID:booking-${bookingId}@parkfairy`);
    expect(text).toContain(`Booking reference ${reference}`);
    expect(text).toContain('LOCATION:Οδός Δοκιμής 1\\, Ηράκλειο');
    expect(text).not.toMatch(/IKB1234/);
    expect(text).not.toContain(gate);

    // Nobody else reaches the pass or its file.
    expect((await other.page.goto(passUrl))?.status()).toBe(404);
    expect((await other.page.request.get(`/api/v1/bookings/${bookingId}/calendar`)).status()).toBe(
      404,
    );

    // Kept on the device: the page opens with no network, drawn with its styles.
    await expect(driver.getByRole('button', { name: 'Keep this pass offline' })).toBeVisible();
    await driver.getByRole('button', { name: 'Keep this pass offline' }).click();
    await expect(driver.getByRole('button', { name: 'Remove from this device' })).toBeFocused();
    await expect(driver.getByText(/Kept on this device until/).first()).toBeVisible();
    await driver.reload();
    await expect(driver.getByRole('button', { name: 'Remove from this device' })).toBeVisible();
    await context.setOffline(true);
    await driver.reload();
    await expect(driver.getByTestId('pass-reference')).toHaveText(reference);
    // The stylesheet came from the kept copy too: the reference is set in the monospace face.
    expect(
      await driver
        .getByTestId('pass-reference')
        .evaluate((element) => getComputedStyle(element).fontFamily),
    ).toMatch(/mono/i);
    // A page that was not kept is the browser's own offline page, not this one.
    await driver.goto(`/en/bookings/${bookingId}`).catch(() => undefined);
    await expect(driver.getByText('Your booking pass')).toHaveCount(0);
    await context.setOffline(false);

    // Taken away, it is gone offline.
    await driver.goto(passUrl);
    await driver.getByRole('button', { name: 'Remove from this device' }).click();
    await expect(driver.getByRole('button', { name: 'Keep this pass offline' })).toBeFocused();
    await context.setOffline(true);
    await driver.reload().catch(() => undefined);
    await expect(driver.getByTestId('pass-reference')).toHaveCount(0);
    await context.setOffline(false);

    // A session that ends without the button (here: the cookies go) takes them off at the next page
    // load that has a network: no one is signed in, so no one's pass may stay.
    await driver.goto(passUrl);
    await driver.getByRole('button', { name: 'Keep this pass offline' }).click();
    await expect(driver.getByRole('button', { name: 'Remove from this device' })).toBeFocused();
    const signedIn = await context.cookies();
    await context.clearCookies();
    await driver.goto('/en');
    const keptCount = () =>
      driver.evaluate(async () => {
        const kept = await Promise.all(
          (await caches.keys()).map(
            async (name) => (await (await caches.open(name)).keys()).length,
          ),
        );
        return kept.reduce((total, count) => total + count, 0);
      });
    await expect.poll(keptCount).toBe(0);
    await expect
      .poll(() =>
        driver.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      )
      .toBe(0);
    // Signed in again (the session was never ended on the server) for the rest.
    await context.addCookies(signedIn);

    // Signing out takes every kept pass off the device.
    await driver.goto(passUrl);
    await driver.getByRole('button', { name: 'Keep this pass offline' }).click();
    await expect(driver.getByRole('button', { name: 'Remove from this device' })).toBeFocused();
    await driver.goto('/en/account');
    await driver.getByRole('button', { name: 'Sign out' }).click();
    await expect(driver).toHaveURL(/\/en\/?$/);
    // Nothing kept: no cache, or an empty one the worker has since made.
    expect(await keptCount()).toBe(0);

    expect(await csp()).toEqual([]);
  } finally {
    await other.context.close();
    await context.close();
    await unpublishListing(id);
  }
});

test('a reminder goes out before a stay, linking to the pass, and the account can turn them off', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
  test.skip(!HAS_DATABASE, 'Putting a listing live is done by hand in the database');
  test.skip(!WORKER_URL, 'The reminders are sent by the worker, which this runner cannot reach');
  test.setTimeout(420_000);

  await registerAndSignIn(page, uniqueEmail('remind-owner'), 'Owner Remind');
  const name = `Γκαράζ υπενθυμίσεων ${randomUUID().slice(0, 6)}`;
  const { id, slug } = await listingWithStaff(page, name);
  await publishListing(id);
  const { context, page: driver } = await ownDriver(browser, 'remind-driver');

  try {
    test.skip(
      !(await bookingOpen(driver, slug)),
      'Bookings are confirmed without payment locally only',
    );
    // The switch on the account page: on to begin with, kept as it is pressed, and said.
    await driver.goto('/en/account');
    const box = driver.getByRole('checkbox', { name: /Email me before a stay starts/ });
    await expect(box).toBeChecked();
    await expectAccessible(driver);
    await box.click();
    await expect(box).not.toBeChecked();
    // Pressed from the keyboard's place: the focus stays on the box while it saves.
    await expect(box).toBeFocused();
    await expect
      .poll(() => driver.getByRole('status').allTextContents())
      .toContain('Reminders are off.');
    await driver.reload();
    await expect(
      driver.getByRole('checkbox', { name: /Email me before a stay starts/ }),
    ).not.toBeChecked();
    expect(
      (
        (await (await driver.request.get('/api/v1/me/reminders')).json()) as {
          reminderEmails: boolean;
        }
      ).reminderEmails,
    ).toBe(false);
    await driver.getByRole('checkbox', { name: /Email me before a stay starts/ }).click();
    await expect
      .poll(() => driver.getByRole('status').allTextContents())
      .toContain('Reminders are on.');
    // A foreign origin can't change it.
    const forged = await driver.request.put('/api/v1/me/reminders', {
      headers: { origin: 'https://evil.example' },
      data: { reminderEmails: false },
    });
    expect(forged.status()).toBe(403);

    // A stay confirmed long ago that starts in an hour and a half gets its reminder.
    const day = athensDay(22);
    const start = athensInstant(day, '10:00');
    const end = athensInstant(day, '12:00');
    const detail = (await (
      await driver.request.get(`/api/v1/parking/${slug}`, { params: { start, end } })
    ).json()) as { spaces: { id: string }[] };
    const held = await driver.request.post('/api/v1/bookings', {
      headers,
      data: { listing: slug, spaceId: detail.spaces[0]?.id, start, end },
    });
    const { id: bookingId } = (await held.json()) as { id: string };
    const confirmed = await driver.request.post(`/api/v1/bookings/${bookingId}/confirm`, {
      headers,
      data: { vehiclePlate: 'YXA-9876' },
    });
    expect(confirmed.status()).toBe(200);
    const { reference } = (await confirmed.json()) as { reference: string };
    await backdateConfirmation(reference);
    await setStay(reference, stayIn(1.5));

    // The address of this account: the sign-up used a generated one, which the outbox names.
    const sent = await waitForEmail(
      ((await (await driver.request.get('/api/v1/me')).json()) as { email: string }).email,
      `Your parking starts soon (${reference})`,
      WORKER_EMAIL,
    );
    expect(sent.html).toContain(`/en/bookings/${bookingId}/pass`);
    expect(sent.html).toContain(name);
    // What an email about a booking may say: no plate, no way in.
    expect(sent.html).not.toContain('YXA9876');
    expect(sent.text).toContain(reference);
  } finally {
    await context.close();
    await unpublishListing(id);
  }
});
