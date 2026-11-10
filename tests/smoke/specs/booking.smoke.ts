import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { addBookings, HAS_DATABASE, publishListing, unpublishListing } from '../support/db';
import { waitForEmail } from '../support/email';
import { EMAIL_OUTBOX, SIGNED_IN_STATE, visitorAddress, WEB_URL } from '../support/env';
import {
  expectAccessible,
  ownDriver,
  ownVisitor,
  registerAndSignIn,
  signIn,
  trackCspViolations,
  uniqueEmail,
} from '../support/fixtures';
import { athensDay, athensInstant, listingWithStaff } from '../support/listings';

// Feature: booking (Phase 3). A driver picks a space for a stay, holds it, gives the car and
// confirms; until payments exist that confirms without one, on a local run only (decision #33).
// The owner sees who is coming in which car, and closing that day is refused until the booking is
// called off (#27). A space another driver takes meanwhile is said so (#9), and a driver cancels by
// the listing's terms (#16). Emails go out from the worker (#36).

test.use(ownVisitor);

/** The worker sends what is due every 30 seconds. */
const WORKER_EMAIL = { timeout: 75_000 };
const REFERENCE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Another person: a browser of their own, at an address of their own. */
async function visitor(browser: Browser) {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': visitorAddress() },
  });
  return { context, page: await context.newPage() };
}

const stayPath = (locale: 'en' | 'el', slug: string, day: string) =>
  `/${locale}/parking/${slug}?startDate=${day}&startTime=10:00&endDate=${day}&endTime=12:00`;
/** The same stay as the listing page writes it back, however the colon is encoded. */
const stayUrl = (locale: 'en' | 'el', slug: string, day: string) =>
  new RegExp(
    `/${locale}/parking/${slug}\\?startDate=${day}&startTime=10(:|%3A)00&endDate=${day}&endTime=12(:|%3A)00$`,
  );

async function bookingOpen(page: Page, slug: string): Promise<boolean> {
  const response = await page.request.get(`/api/v1/parking/${slug}`);
  return ((await response.json()) as { bookingOpen: boolean }).bookingOpen;
}

test('a driver books a space, the owner sees who is coming, and closing that day waits for a cancel', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
  test.skip(!HAS_DATABASE, 'Putting a listing live is done by hand in the database');
  test.setTimeout(300_000);

  const ownerEmail = uniqueEmail('booking-owner');
  await registerAndSignIn(page, ownerEmail, 'Owner Booking');
  const name = `Γκαράζ κρατήσεων ${randomUUID().slice(0, 6)}`;
  const { id, slug } = await listingWithStaff(page, name);
  await publishListing(id);
  const day = athensDay(15);

  // The driver made an account in a browser of their own, and arrives here signed out.
  const driverEmail = uniqueEmail('booking-driver');
  const signup = await visitor(browser);
  await registerAndSignIn(signup.page, driverEmail, 'Δήμητρα Οδηγού');
  await signup.context.close();
  const { context, page: driver } = await visitor(browser);
  const csp = await trackCspViolations(driver);

  try {
    test.skip(
      !(await bookingOpen(driver, slug)),
      'Bookings are confirmed without payment locally only',
    );

    // Booking needs an account (#8): asked to sign in, and brought back to the same stay.
    await driver.goto(stayPath('en', slug, day));
    await expect(
      driver.getByRole('heading', { level: 2, name: 'Choose your space' }),
    ).toBeVisible();
    await expect(driver.getByRole('radio')).toHaveCount(0);
    await driver.getByRole('link', { name: 'Sign in to book' }).click();
    await expect(driver).toHaveURL(/\/en\/sign-in\?next=/);
    await signIn(driver, driverEmail);
    await expect(driver).toHaveURL(stayUrl('en', slug, day));
    await expect(driver.getByText('The space is free for your stay.')).toBeVisible();
    await expectAccessible(driver);

    // One press holds the space; the booking's page asks for the car.
    await expect(driver.getByRole('radio', { name: 'K1' })).toBeChecked();
    await driver.getByRole('button', { name: 'Book this space' }).click();
    await expect(driver).toHaveURL(/\/en\/bookings\/[0-9a-f-]{36}$/);
    const bookingUrl = new URL(driver.url()).pathname;
    await expect(driver.getByRole('heading', { level: 1 })).toHaveText('Confirm your booking');
    await expect(driver.getByText(/We’re keeping space K1 for you until/)).toBeVisible();
    await expectAccessible(driver);
    // More time, at a press (WCAG 2.2.1): confirming works only while the hold runs (#37).
    await driver.getByRole('button', { name: 'Keep it for 10 more minutes' }).click();
    await expect(
      driver.getByRole('status').filter({ hasText: 'Kept for you until' }),
    ).toBeAttached();

    const plate = driver.getByRole('textbox', { name: 'Number plate' });
    await driver.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(plate).toBeFocused();
    await expect(plate).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(driver);
    await plate.fill('ικβ-1234');
    await driver.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(driver).toHaveURL(`${bookingUrl}?done=confirmed`);
    await expect(
      driver.getByRole('heading', { level: 2, name: 'Booking confirmed' }),
    ).toBeFocused();
    await expect(driver.getByText('IKB1234')).toBeVisible();
    const reference = (await driver.getByText(REFERENCE).textContent())?.trim() ?? '';
    expect(reference).toMatch(REFERENCE);
    await expectAccessible(driver);

    // Both sides hear of it, from the worker.
    await waitForEmail(driverEmail, `Your parking is booked (${reference})`, WORKER_EMAIL);
    await waitForEmail(ownerEmail, `New booking for “${name}”`, WORKER_EMAIL);

    // The driver's own list has it.
    await driver.goto('/en/bookings');
    await driver.getByRole('link', { name }).click();
    await expect(driver).toHaveURL(bookingUrl);

    // The owner sees who is coming, in which car (#35).
    await page.goto('/en/owner');
    await page.getByRole('link', { name: `Bookings for “${name}”` }).click();
    await expect(page).toHaveURL(`/en/owner/listings/${id}/bookings`);
    const card = page.getByRole('listitem').filter({ hasText: reference });
    await expect(card.getByText('Δήμητρα Οδηγού')).toBeVisible();
    await expect(card.getByText('IKB1234')).toBeVisible();
    await expectAccessible(page);

    // Closing that day is refused until the booking is called off (#27), with the way there.
    const closeTheDay = async () => {
      await page.goto(`/en/owner/listings/${id}/closures`);
      await page.getByRole('button', { name: 'Add dates' }).click();
      await page.getByRole('group', { name: 'Period 1' }).getByLabel('First day').fill(day);
      await page.getByRole('button', { name: 'Save' }).click();
    };
    await closeTheDay();
    const refused = page.getByRole('alert').filter({ hasText: 'A booking falls' });
    await expect(refused).toBeVisible();
    await expectAccessible(page);
    await refused.getByRole('link', { name: 'See the bookings' }).click();
    await expect(page).toHaveURL(`/en/owner/listings/${id}/bookings`);
    await page.getByRole('button', { name: `Cancel booking ${reference}` }).click();
    await expect(page.getByText(/The driver gets the full amount back/)).toBeFocused();
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    // The page comes back without the card; its notice takes the focus and names the booking.
    await expect(
      page.getByRole('heading', { level: 2, name: `Booking ${reference} cancelled` }),
    ).toBeFocused();
    await expect(page.getByText('There are no bookings yet.')).toBeVisible();
    await expectAccessible(page);
    // A place in the list with nothing after it any more, or a page number from before places,
    // comes to the first page (keyset paging, 3.4), the notice of the cancel kept and focused.
    await page.goto(
      `/en/owner/listings/${id}/bookings?after=4102444800000_00000000-0000-4000-8000-000000000000&cancelled=${reference}`,
    );
    await expect(page).toHaveURL(`/en/owner/listings/${id}/bookings?cancelled=${reference}`);
    await expect(
      page.getByRole('heading', { level: 2, name: `Booking ${reference} cancelled` }),
    ).toBeFocused();
    await page.goto(`/en/owner/listings/${id}/bookings?page=3`);
    await expect(page.getByText('There are no bookings yet.')).toBeVisible();
    // The same page in Greek, on a phone.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/el/owner/listings/${id}/bookings`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Κρατήσεις');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await expectAccessible(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    // Back to the closures from there: the day typed before the refusal is still in the form (3.3).
    await page.goto(`/en/owner/listings/${id}/bookings`);
    await page.getByRole('link', { name: 'Closures and special hours' }).click();
    await expect(page.getByText(/Your changes from before you left are back/)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Period 1' }).getByLabel('First day')).toHaveValue(
      day,
    );
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

    // The driver is told, and refunded in full.
    await driver.goto(bookingUrl);
    await expect(driver.getByRole('heading', { level: 1 })).toHaveText('Cancelled booking');
    await expect(
      driver.getByText('The owner had to cancel this booking. You get the full €4.00 back.'),
    ).toBeVisible();
    await waitForEmail(driverEmail, `Your booking is cancelled (${reference})`, WORKER_EMAIL);

    // Nobody else reaches the booking, or the listing's bookings.
    const strangers = await browser.newContext({ storageState: SIGNED_IN_STATE });
    const stranger = await strangers.newPage();
    expect((await stranger.goto(bookingUrl))?.status()).toBe(404);
    expect((await stranger.goto(`/en/owner/listings/${id}/bookings`))?.status()).toBe(404);
    const theirs = bookingUrl.split('/').pop() ?? '';
    const cancel = await stranger.request.post(`/api/v1/bookings/${theirs}/cancel`, {
      headers: { origin: WEB_URL },
    });
    expect(cancel.status()).toBe(404);
    await strangers.close();

    expect(await csp()).toEqual([]);
  } finally {
    await context.close();
    await unpublishListing(id);
  }
});

test('a space taken meanwhile is said so, a driver cancels by the terms, and Greek fits a phone', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
  test.skip(!HAS_DATABASE, 'Putting a listing live is done by hand in the database');
  test.setTimeout(240_000);

  await registerAndSignIn(page, uniqueEmail('booking-owner'), 'Owner Booking');
  const name = `Γκαράζ μίας θέσης ${randomUUID().slice(0, 6)}`;
  const { id, slug } = await listingWithStaff(page, name);
  await publishListing(id);
  const day = athensDay(16);
  // Two drivers of the test's own: one hold each at a time, so never the shared account.
  const { context: slowContext, page: slow } = await ownDriver(browser, 'booking-slow');
  const fast = await ownDriver(browser, 'booking-fast');
  const quick = fast.page;
  const headers = { origin: WEB_URL };

  try {
    test.skip(
      !(await bookingOpen(slow, slug)),
      'Bookings are confirmed without payment locally only',
    );

    // The slower driver opens the listing while K1 is free...
    await slow.goto(stayPath('en', slug, day));
    await expect(slow.getByRole('radio', { name: 'K1' })).toBeChecked();

    // ...the quicker one books it first, through the API as their page would.
    const start = athensInstant(day, '10:00');
    const end = athensInstant(day, '12:00');
    const detail = (await (
      await quick.request.get(`/api/v1/parking/${slug}`, { params: { start, end } })
    ).json()) as { spaces: { id: string }[] };
    const held = await quick.request.post('/api/v1/bookings', {
      headers,
      data: { listing: slug, spaceId: detail.spaces[0]?.id, start, end },
    });
    expect(held.status()).toBe(201);
    const { id: bookingId } = (await held.json()) as { id: string };
    const confirmed = await quick.request.post(`/api/v1/bookings/${bookingId}/confirm`, {
      headers,
      data: { vehiclePlate: 'YXA-9876' },
    });
    expect(confirmed.status()).toBe(200);

    // The slower press is told so (#9), and the page, read again, has nothing free.
    await slow.getByRole('button', { name: 'Book this space' }).click();
    // The page, read again, has nothing free: the alert says the last one went, where the focus is.
    await expect(slow.getByText('The space isn’t free for your stay.')).toBeVisible();
    await expect(slow.getByRole('radio')).toHaveCount(0);
    await expect(
      slow
        .getByRole('alert')
        .filter({ hasText: 'Someone else has just booked the last free space' }),
    ).toBeVisible();
    await expect(slow.getByRole('heading', { level: 2, name: 'Choose your space' })).toBeFocused();
    await expectAccessible(slow);

    // The quicker driver cancels by the listing's terms: days ahead, all of it back.
    await quick.goto(`/en/bookings/${bookingId}`);
    await quick.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(quick.getByText('Cancel this booking? You’ll get €4.00 back.')).toBeFocused();
    await expectAccessible(quick);
    await quick.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(quick.getByRole('heading', { level: 2, name: 'Booking cancelled' })).toBeFocused();
    await expect(
      quick.getByText('You cancelled this booking. €4.00 comes back to you.'),
    ).toBeVisible();
    await quick.goto('/en/bookings?when=past');
    await expect(quick.getByRole('link', { name })).toBeVisible();
    await expectAccessible(quick);

    // Free again: the slower driver holds it in Greek, on a phone, and lets it go.
    await slow.setViewportSize({ width: 320, height: 800 });
    await slow.goto(stayPath('el', slug, day));
    await expect(slow.getByRole('heading', { level: 2, name: 'Επιλέξτε θέση' })).toBeVisible();
    await expect(slow.getByRole('radio', { name: 'K1' })).toBeChecked();
    expect(await slow.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await expectAccessible(slow);
    await slow.getByRole('button', { name: 'Κράτηση αυτής της θέσης' }).click();
    await expect(slow).toHaveURL(/\/el\/bookings\/[0-9a-f-]{36}$/);
    await expect(slow.getByRole('heading', { level: 1 })).toHaveText(
      'Επιβεβαιώστε την κράτησή σας',
    );
    expect(await slow.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await expectAccessible(slow);
    // Letting it go asks first, in place, and the listing says it went (3.3).
    await slow.getByRole('button', { name: 'Αποδέσμευση της θέσης' }).click();
    await expect(slow.getByText(/Να αποδεσμευτεί η θέση K1;/)).toBeFocused();
    await expectAccessible(slow);
    await slow.getByRole('button', { name: 'Ναι, αποδέσμευση' }).click();
    await expect(slow).toHaveURL(
      new RegExp(`/el/parking/${slug}\\?startDate=${day}&.*&released=1$`),
    );
    await expect(
      slow.getByRole('heading', { level: 2, name: 'Αποδεσμεύσατε τη θέση' }),
    ).toBeFocused();
    await expect(slow.getByRole('radio', { name: 'K1' })).toBeChecked();
    expect(await slow.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await expectAccessible(slow);
  } finally {
    await slowContext.close();
    await fast.context.close();
    await unpublishListing(id);
  }
});

test('an owner pages through a busy listing, and a cancel on a later page comes back to it', async ({
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  test.skip(!HAS_DATABASE, 'Putting a listing live, and its bookings, are done in the database');
  test.setTimeout(120_000);

  await registerAndSignIn(page, uniqueEmail('busy-owner'), 'Owner Busy');
  const { id } = await listingWithStaff(
    page,
    `Γκαράζ πολλών κρατήσεων ${randomUUID().slice(0, 6)}`,
  );
  await publishListing(id);
  await addBookings(id, 25);
  const cards = page.getByRole('heading', { level: 2, name: /^Booking [0-9A-Z]{4}-[0-9A-Z]{4}$/ });
  const pages = page.getByRole('navigation', { name: 'Pages' });

  try {
    await page.goto(`/en/owner/listings/${id}/bookings`);
    await expect(cards).toHaveCount(20);
    await expect(pages.getByRole('link', { name: 'Previous page' })).toHaveCount(0);
    await pages.getByRole('link', { name: 'Next page' }).click();
    await expect(page).toHaveURL(/\?after=\d+_[0-9a-f-]{36}$/);
    const second = new URL(page.url()).search;
    await expect(cards).toHaveCount(5);
    await expect(pages.getByRole('link', { name: 'Next page' })).toHaveCount(0);
    // A client navigation swaps the <title> after the content: axe would otherwise catch none.
    await expect(page).toHaveTitle(/^Bookings for /);
    await expectAccessible(page);

    // A cancel here comes back here, its notice focused, the page as it was less that booking.
    const reference = ((await cards.first().textContent()) ?? '').replace('Booking ', '');
    await page.getByRole('button', { name: `Cancel booking ${reference}` }).click();
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: `Booking ${reference} cancelled` }),
    ).toBeFocused();
    await expect(page).toHaveURL(
      `/en/owner/listings/${id}/bookings${second}&cancelled=${reference}`,
    );
    await expect(cards).toHaveCount(4);
    await expect(page).toHaveTitle(/^Bookings for /);
    await expectAccessible(page);

    await pages.getByRole('link', { name: 'Previous page' }).click();
    await expect(page).toHaveURL(/\?before=\d+_[0-9a-f-]{36}$/);
    await expect(cards).toHaveCount(20);
    await expect(pages.getByRole('link', { name: 'Previous page' })).toHaveCount(0);

    // In Greek, a place with nothing after it lands on the first page, still in Greek.
    await page.goto(
      `/el/owner/listings/${id}/bookings?after=4102444800000_00000000-0000-4000-8000-000000000000`,
    );
    await expect(page).toHaveURL(`/el/owner/listings/${id}/bookings`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Κρατήσεις');
    await expect(page.getByRole('navigation', { name: 'Σελίδες' })).toBeVisible();
  } finally {
    await unpublishListing(id);
  }
});
