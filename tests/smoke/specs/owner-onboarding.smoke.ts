import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { HAS_DATABASE, sendListingBack } from '../support/db';
import { emailLink, emailsTo } from '../support/email';
import { DEMO_DATA, EMAIL_OUTBOX, SIGNED_IN_STATE } from '../support/env';
import {
  expectAccessible,
  ownVisitor,
  registerAndSignIn,
  trackCspViolations,
  uniqueEmail,
} from '../support/fixtures';

// Feature: owner onboarding — an owner goes from nothing to a listing with staff, stopping
// wherever they like: everything is kept, and Continue opens the first unfinished step.

test.use(ownVisitor);

const PHOTO = fileURLToPath(
  new URL('../../../apps/api/seed-assets/photos/skoufa-garage-1.jpg', import.meta.url),
);
const PDF = {
  name: 'lease.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7\n%smoke test document\n'),
};
const VALID_AFM = '094259216';

async function fillAboutYou(page: Page) {
  await page.getByRole('radio', { name: 'An individual' }).check();
  await page.getByLabel('First name').fill('Maria');
  await page.getByLabel('Last name').fill('Papadopoulou');
  await page.getByLabel('Phone').fill('+30 210 123 4567');
  await page.getByLabel('Street and number').fill('Ermou 1');
  await page.getByLabel('City').fill('Athens');
  await page.getByLabel('Postal code').fill('105 63');
}

async function fillLocation(page: Page, name: string) {
  await page.getByLabel('Name of your parking').fill(name);
  await page.getByLabel('Address', { exact: true }).fill('Ermou 45, Athens');
  await page.getByLabel('Latitude').fill('37.9755');
  await page.getByLabel('Longitude').fill('23.7348');
  await page.getByLabel('Longitude').blur();
  // The area follows the pin.
  await expect(page.getByLabel('Area')).toHaveValue('syntagma');
}

async function finishAccount(page: Page) {
  await page.goto('/en/owner/profile');
  await fillAboutYou(page);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL('/en/owner/tax');
  await page.getByLabel('Tax number (ΑΦΜ)').fill(VALID_AFM);
  await page.getByLabel('Date of birth').fill('1980-02-03');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL('/en/owner');
}

test('someone new sees what it takes before committing to anything', async ({ page }) => {
  await page.goto('/en/owner');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('parking you already have');
  await expect(page.getByRole('heading', { name: 'What you’ll need' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
  await expectAccessible(page);
});

test('a step’s address sends a stranger to sign in, and back', async ({ page }) => {
  const listing = '/owner/listings/11111111-1111-4111-8111-111111111111/prices';
  for (const path of ['/owner/profile', '/owner/tax', listing]) {
    await page.goto(`/en${path}`);
    await expect(page).toHaveURL(`/en/sign-in?next=${encodeURIComponent(path)}`);
  }
});

test('an owner stops partway, comes back to the right place and sends the listing in', async ({
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  test.setTimeout(180_000);
  const email = uniqueEmail('owner');
  await registerAndSignIn(page, email, 'Owner Smoke');
  const csp = await trackCspViolations(page);

  // From the header, into the first step.
  await page.getByRole('link', { name: 'List parking' }).click();
  await expect(page).toHaveURL('/en/owner');
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL('/en/owner/profile');
  await expectAccessible(page);

  // Half a form, then away. What was typed is there on return, without pressing anything.
  await page.getByRole('radio', { name: 'An individual' }).check();
  await page.getByLabel('First name').fill('Maria');
  await page.getByLabel('Last name').focus();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('First name')).toHaveValue('Maria');
  await expect(page.getByRole('radio', { name: 'An individual' })).toBeChecked();

  // The dashboard knows where they stopped.
  await page.goto('/en/owner');
  await expect(page.getByText('1 of 10 steps done')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue: About you' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Continue: About you' }).click();
  await expect(page).toHaveURL('/en/owner/profile');

  // Refused until it's right, with the reason beside the field.
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByLabel('Phone')).toHaveAttribute('aria-invalid', 'true');
  await fillAboutYou(page);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page).toHaveURL('/en/owner/tax');
  await expectAccessible(page);
  await page.getByLabel('Tax number (ΑΦΜ)').fill('123456789');
  await page.getByLabel('Date of birth').fill('1980-02-03');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByLabel('Tax number (ΑΦΜ)')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Tax number (ΑΦΜ)').fill(VALID_AFM);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL('/en/owner');

  // Saved tax details never come back: only their last digits.
  await page.goto('/en/owner/tax');
  await expect(page.getByText('Saved, ending 216.')).toBeVisible();
  await expect(page.getByLabel('Tax number (ΑΦΜ)')).toHaveValue('');
  expect(await page.content()).not.toContain(VALID_AFM);

  await page.goto('/en/owner');
  await expect(page.getByRole('heading', { name: /Add your parking/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add your parking' }).click();
  await expect(page).toHaveURL(/\/location$/);
  const listingUrl = page.url().replace(/\/location$/, '');
  await expectAccessible(page);
  await fillLocation(page, 'Smoke garage');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/spaces$/);

  // Stop here. Continue opens spaces, the first step not done.
  await page.goto('/en/owner');
  await page.getByRole('link', { name: 'Continue: Spaces' }).click();
  await expect(page).toHaveURL(`${listingUrl}/spaces`);
  await expectAccessible(page);

  await page.getByLabel('Prefix').fill('A');
  await page.getByLabel('How many').fill('3');
  await page.getByRole('button', { name: 'Add spaces' }).click();
  await expect(page.getByRole('heading', { name: '3 spaces' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove A3' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page).toHaveURL(/\/hours$/);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Open all day, every day' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page).toHaveURL(/\/prices$/);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByLabel('Hourly rate (€)', { exact: true })).toBeFocused();
  await page.getByLabel('Hourly rate (€)', { exact: true }).fill('3,50');
  await page.getByLabel('Daily maximum (€)').fill('20');
  await page.getByRole('radio', { name: 'Moderate' }).check();
  await page.getByLabel('A different price at the weekend').check();
  await page.getByLabel('Weekend hourly rate (€)').fill('5');
  await page.getByRole('button', { name: 'Add a discount' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page).toHaveURL(/\/photos$/);
  await expectAccessible(page);
  await expect(page.getByRole('link', { name: 'Continue' })).toBeHidden();
  await page.getByLabel('Choose photos').setInputFiles({
    name: 'not-a-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'can’t read this file as a photo' }),
  ).toBeVisible();
  await page.getByLabel('Choose photos').setInputFiles(PHOTO);
  await expect(page.getByRole('img', { name: 'Photo 1 of your parking' })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole('img', { name: 'Photo 1 of your parking' })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByLabel('What photo 1 shows').fill('Η είσοδος');
  await page.getByLabel('What photo 1 shows').blur();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Continue' }).click();

  await expect(page).toHaveURL(/\/proof$/);
  await expectAccessible(page);
  await page.getByLabel('Choose a file').setInputFiles(PDF);
  const proof = page.getByRole('link', { name: 'Download lease.pdf' });
  const download = page.waitForEvent('download');
  await proof.click();
  expect((await download).suggestedFilename()).toBe('lease.pdf');
  // Private, and never something a browser would open as a page of ours.
  const stored = await page.request.get((await proof.getAttribute('href')) ?? '');
  expect(stored.status()).toBe(200);
  expect(stored.headers()['content-disposition']).toMatch(/^attachment/);
  expect(stored.headers()['x-content-type-options']).toBe('nosniff');
  expect(stored.headers()['cache-control']).toContain('no-store');
  expect(stored.headers()['content-security-policy']).toContain('sandbox');
  await page.getByRole('link', { name: 'Continue' }).click();

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText('Smoke garage')).toBeVisible();
  await expect(page.getByText('2 spaces')).toBeVisible();
  await expect(page.getByText('€3.50 an hour', { exact: true })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByLabel('This information is correct')).toBeFocused();
  await page.getByLabel('This information is correct').check();
  await page.getByRole('button', { name: 'Send for review' }).click();

  await expect(page).toHaveURL('/en/owner');
  await expect(page.getByText('We’re checking it now')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'You’re all caught up' })).toBeVisible();

  // It can no longer be changed, and the API agrees with the page.
  await page.goto(`${listingUrl}/prices`);
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeHidden();
  await expect(page.getByText('You can’t change this listing')).toBeVisible();
  expect(
    (
      await page.request.patch(`/api/v1/owner/listings/${listingUrl.split('/').pop()}/location`, {
        data: { name: 'Changed' },
        headers: { origin: new URL(page.url()).origin },
      })
    ).status(),
  ).toBe(409);

  // The worker tells the owner, by real email, in the language of the account.
  await expect
    .poll(async () => (await emailsTo(email)).map((sent) => sent.subject), {
      timeout: 100_000,
      intervals: [2000],
    })
    .toContain('We’ve received your listing');
  const sent = (await emailsTo(email)).findLast((e) => e.subject.includes('received'));
  expect(sent?.text).toContain('Smoke garage');
  expect(sent && emailLink(sent)).toMatch(/\/en\/owner$/);

  // Staff send it back. The note comes first, Continue opens the review, and a fix goes in
  // without starting again.
  if (HAS_DATABASE) {
    await sendListingBack(listingUrl.split('/').pop() ?? '', 'Η φωτογραφία είναι σκοτεινή');
    await page.goto('/en/owner');
    await expect(page.getByText('What needs changing')).toBeVisible();
    await expect(page.getByText('Η φωτογραφία είναι σκοτεινή')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Continue: Review and send' }).click();
    await expect(page).toHaveURL(`${listingUrl}/review`);

    await page.goto(`${listingUrl}/prices`);
    await page.getByLabel('Hourly rate (€)', { exact: true }).fill('4');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    // Nothing else is open, so the next unfinished step is the review.
    await expect(page).toHaveURL(`${listingUrl}/review`);
    await expect(page.getByText('€4.00 an hour', { exact: true })).toBeVisible();
    await page.getByLabel('This information is correct').check();
    await page.getByRole('button', { name: 'Send it again' }).click();
    await expect(page).toHaveURL('/en/owner');
    await expect(page.getByText('We’re checking it now')).toBeVisible();
    await expect(page.getByText('Η φωτογραφία είναι σκοτεινή')).toBeHidden();
  }

  expect(await csp()).toEqual([]);
});

test('the location step brings the map’s policy, even for an owner who arrived from elsewhere', async ({
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  test.setTimeout(60_000);
  await registerAndSignIn(page, uniqueEmail('owner-arrival'), 'Owner Arrival');
  await finishAccount(page);
  await page.getByRole('button', { name: 'Add your parking' }).click();
  await expect(page).toHaveURL(/\/location$/);

  // A client-side change of page keeps the document, and so the policy, of the home page.
  await page.goto('/en');
  await page.getByRole('link', { name: 'List parking' }).click();
  await expect(page).toHaveURL('/en/owner');

  const arrival = page.waitForResponse(
    (response) => response.request().isNavigationRequest() && response.url().endsWith('/location'),
  );
  await page.getByRole('link', { name: 'Continue: Location' }).click();
  expect((await arrival).headers()['content-security-policy']).toContain('https://api.mapbox.com');
});

test('another owner’s listing does not exist, as far as anyone else can tell', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  test.setTimeout(60_000);
  await registerAndSignIn(page, uniqueEmail('owner-a'), 'Owner A');
  await finishAccount(page);
  await page.getByRole('button', { name: 'Add your parking' }).click();
  await expect(page).toHaveURL(/\/location$/);
  const id = /listings\/([0-9a-f-]+)\//.exec(page.url())?.[1];

  const context = await browser.newContext({ storageState: SIGNED_IN_STATE });
  const stranger = await context.newPage();
  const response = await stranger.goto(`/en/owner/listings/${id}/location`);
  expect(response?.status()).toBe(404);
  const api = await stranger.request.get(`/api/v1/owner/listings/${id}`);
  expect(api.status()).toBe(404);
  await context.close();

  expect((await page.goto(`/en/owner/listings/${id}/nonsense`))?.status()).toBe(404);
});

test('a Greek owner on a phone can reach every step without sideways scrolling', async ({
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  test.setTimeout(90_000);
  await registerAndSignIn(page, uniqueEmail('owner-phone'), 'Owner Phone');
  await finishAccount(page);
  await page.getByRole('button', { name: 'Add your parking' }).click();
  await expect(page).toHaveURL(/\/location$/);
  const base = page
    .url()
    .replace('/en/', '/el/')
    .replace(/\/location$/, '');
  await page.setViewportSize({ width: 320, height: 640 });

  for (const step of ['location', 'spaces', 'hours', 'prices', 'photos', 'proof', 'review']) {
    await page.goto(`${base}/${step}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, step).toBeLessThanOrEqual(0);
    await expectAccessible(page);
  }
  await page.goto('/el/owner');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Οι χώροι σας');
  await expectAccessible(page);
});

test('the map’s origins are allowed in the owner area and nowhere else', async ({ request }) => {
  const policy = async (path: string) =>
    (await request.get(path, { maxRedirects: 0 })).headers()['content-security-policy'] ?? '';
  expect(await policy('/en/owner')).toContain('https://api.mapbox.com');
  expect(await policy('/en/owner')).toContain("worker-src 'self'");
  for (const path of ['/en', '/en/sign-in', '/en/search']) {
    const csp = await policy(path);
    expect(csp, path).not.toContain('mapbox');
    expect(csp, path).not.toContain('worker-src');
  }
});

test('the map’s worker comes from this site, which is all the policy allows', async ({
  request,
}) => {
  // Named for the library's version, as the web app installs it.
  const { version } = createRequire(
    fileURLToPath(new URL('../../../apps/web/package.json', import.meta.url)),
  )('mapbox-gl/package.json') as { version: string };
  const worker = await request.get(`/vendor/mapbox-gl-csp-worker-${version}.js`);
  expect(worker.status()).toBe(200);
  expect(worker.headers()['content-type']).toContain('javascript');
  // The name changes with the version, so the file can be kept for a year.
  expect(worker.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  // No unversioned copy is left to go stale.
  expect((await request.get('/vendor/mapbox-gl-csp-worker.js')).status()).toBe(404);
  // A version not shipped yet is a 404 no cache may keep, or it would outlive the upgrade.
  const next = await request.get('/vendor/mapbox-gl-csp-worker-99.0.0.js');
  expect(next.status()).toBe(404);
  expect(next.headers()['cache-control'] ?? '').not.toContain('immutable');
});

test('demo listings show their photos, with words for those who can’t see them', async ({
  page,
}) => {
  test.skip(!DEMO_DATA, 'Needs the demo listings');
  await page.goto('/el/parking/syntagma-square-garage');
  const photo = page.getByRole('img', { name: /Υπόγειο γκαράζ/ });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(photo).toHaveAttribute('lang', 'el');
  await expect(page.getByRole('main').getByRole('img')).toHaveCount(2);
});

test('a listing whose spaces differ reads “from”, and shows each space’s price', async ({
  page,
}) => {
  test.skip(!DEMO_DATA, 'Needs the demo listings');
  await page.goto('/en/parking/athens-airport-park-and-fly');
  await expect(page.getByText('From €2.50 an hour')).toBeVisible();
  await expect(page.getByText('€3.00 an hour').first()).toBeVisible();
  await expect(page.getByText('10% off stays of 7 days or more')).toBeVisible();
});
