import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { HAS_DATABASE, publishListing, unpublishListing } from '../support/db';
import { EMAIL_OUTBOX, SIGNED_IN_STATE, WEB_URL } from '../support/env';
import {
  expectAccessible,
  ownVisitor,
  registerAndSignIn,
  trackCspViolations,
  uniqueEmail,
} from '../support/fixtures';

// Feature: closures and special hours — an owner closes a live listing for a day, opens it
// shorter on another and closes it for part of a third, with no new review, then copies the
// dates to another listing of theirs. Drivers see the dates and hours, never the owner's note,
// and a stay in closed time is refused. Also the weekly hours' break (decision #28).

test.use(ownVisitor);

const PHOTO = readFileSync(
  fileURLToPath(
    new URL('../../../apps/api/seed-assets/photos/ermou-parking-2.jpg', import.meta.url),
  ),
);
const WEEK = [1, 2, 3, 4, 5, 6, 7];

/** A calendar day in Athens, `days` from today. */
function athensDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
  const [year = 0, month = 1, day = 1] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** An Athens wall-clock time as an instant, whichever side of a clock change it falls. */
function athensInstant(day: string, time: string): string {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (const offset of [2, 3]) {
    const guess = new Date(Date.parse(`${day}T${time}:00Z`) - offset * 3_600_000);
    if (local.format(guess) === `${day}, ${time}`) return guess.toISOString();
  }
  throw new Error(`No ${time} on ${day} in Athens`);
}

/**
 * Everything up to staff, through the API: the steps have their own smoke test. Far from the demo
 * areas, so no other test's search meets it.
 */
async function listingWithStaff(page: Page, name: string): Promise<{ id: string; slug: string }> {
  const headers = { origin: WEB_URL };
  const call = async (method: 'patch' | 'put' | 'post', path: string, data: unknown) => {
    const response = await page.request[method](`/api/v1/owner${path}`, { headers, data });
    expect(response.ok(), `${method} ${path}`).toBe(true);
    return response;
  };
  await call('patch', '/profile', {
    kind: 'individual',
    firstName: 'Ελένη',
    lastName: 'Κλειδαριά',
    phone: '+30 210 123 4567',
    addressLine: 'Ερμού 1',
    city: 'Αθήνα',
    postalCode: '105 63',
    country: 'GR',
  });
  await call('put', '/profile/tax', {
    taxCountry: 'GR',
    taxId: '094259216',
    birthDate: '1980-02-03',
  });
  const { id } = (await (await call('post', '/listings', undefined)).json()) as { id: string };
  await call('patch', `/listings/${id}/location`, {
    name,
    address: 'Οδός Δοκιμής 1, Ηράκλειο',
    areaId: 'syntagma',
    latitude: 35.3387,
    longitude: 25.1442,
    contentLocale: 'el',
  });
  await call('put', `/listings/${id}/spaces`, {
    spaces: [{ label: 'K1', features: [], hourlyRateMinor: null }],
  });
  await call('put', `/listings/${id}/hours`, {
    periods: WEEK.map((weekday) => ({ weekday, opens: '00:00', closes: '24:00' })),
  });
  await call('put', `/listings/${id}/prices`, {
    hourlyRateMinor: 200,
    dailyMaxMinor: null,
    bookingGapMinutes: 0,
    cancellationPolicy: 'oneDay',
    weekendRateMinor: null,
    night: null,
    datedPrices: [],
    longStayDiscounts: [],
  });
  const photo = await page.request.post(`/api/v1/owner/listings/${id}/photos`, {
    headers: { ...headers, 'content-type': 'image/jpeg' },
    data: PHOTO,
  });
  expect(photo.status()).toBe(201);
  const proof = await page.request.post(`/api/v1/owner/listings/${id}/proofs?kind=lease`, {
    headers: { ...headers, 'content-type': 'application/pdf', 'x-file-name': 'lease.pdf' },
    data: Buffer.from('%PDF-1.7\n%smoke test document\n'),
  });
  expect(proof.status()).toBe(201);
  const submitted = await call('post', `/listings/${id}/submit`, { confirmed: true });
  return { id, slug: ((await submitted.json()) as { slug: string }).slug };
}

/** A second listing of the same owner, named and nothing more. */
async function draftListing(page: Page, name: string): Promise<string> {
  const headers = { origin: WEB_URL };
  const created = await page.request.post('/api/v1/owner/listings', { headers });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const named = await page.request.patch(`/api/v1/owner/listings/${id}/location`, {
    headers,
    data: { name },
  });
  expect(named.ok()).toBe(true);
  return id;
}

test('an owner closes a live listing for a day, and drivers find it closed', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  test.skip(!HAS_DATABASE, 'Putting a listing live is done by hand in the database');
  test.setTimeout(150_000);
  await registerAndSignIn(page, uniqueEmail('owner-closures'), 'Owner Closures');
  const csp = await trackCspViolations(page);
  const name = `Γκαράζ κλειστό ${randomUUID().slice(0, 6)}`;
  const { id, slug } = await listingWithStaff(page, name);
  await publishListing(id);
  const otherName = `Δεύτερο γκαράζ ${randomUUID().slice(0, 6)}`;
  const otherId = await draftListing(page, otherName);
  const thirdName = `Τρίτο γκαράζ ${randomUUID().slice(0, 6)}`;
  const thirdId = await draftListing(page, thirdName);
  const shut = athensDay(20);
  const short = athensDay(21);
  const cleaning = athensDay(22);

  try {
    // From the dashboard, on a listing whose steps are locked.
    await page.goto('/en/owner');
    await page.getByRole('link', { name: `Closures and special hours for “${name}”` }).click();
    await expect(page).toHaveURL(`/en/owner/listings/${id}/closures`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Closures and special hours');
    await expect(page.getByText('No closures or special hours yet.')).toBeVisible();
    await expectAccessible(page);

    // A closed day: the last day follows the first.
    await page.getByRole('button', { name: 'Add dates' }).click();
    const first = page.getByRole('group', { name: 'Period 1' });
    await expect(first.getByLabel('First day')).toBeFocused();
    await first.getByLabel('First day').fill(shut);
    await expect(first.getByLabel('Last day')).toHaveValue(shut);
    await first.getByLabel('Your note for period 1 (optional)').fill('Απογραφή');

    // Shorter hours the next day.
    await page.getByRole('button', { name: 'Add dates' }).click();
    const second = page.getByRole('group', { name: 'Period 2' });
    await second.getByLabel('First day').fill(short);
    await second.getByRole('radio', { name: 'Open at other hours' }).check();
    await second.getByLabel('Opens').selectOption('08:00');
    await second.getByLabel('Closes').selectOption('14:00');

    // Closed for part of a day, the weekly hours around it.
    await page.getByRole('button', { name: 'Add dates' }).click();
    const third = page.getByRole('group', { name: 'Period 3' });
    await third.getByLabel('First day').fill(cleaning);
    await third.getByRole('radio', { name: 'Closed for part of the day' }).check();
    await third.getByLabel('Closed from').selectOption('10:00');
    await third.getByLabel('Closed until').selectOption('14:00');

    // An overlap is refused at the field, and nothing is saved.
    await page.getByRole('button', { name: 'Add dates' }).click();
    await page.getByRole('group', { name: 'Period 4' }).getByLabel('First day').fill(shut);
    await page.getByRole('button', { name: 'Save' }).click();
    const clash = page.getByRole('group', { name: 'Period 4' }).getByLabel('First day');
    await expect(clash).toBeFocused();
    await expect(clash).toHaveAccessibleDescription(/These dates overlap period 1$/);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Remove period 4' }).click();
    await expect(page.getByRole('button', { name: 'Add dates' })).toBeFocused();

    // Saved with Enter from a field: the owner stays where they were.
    const note = first.getByLabel('Your note for period 1 (optional)');
    await note.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await expect(note).toBeFocused();
    await page.reload();
    await expect(page.getByRole('group', { name: 'Period 1' }).getByLabel('First day')).toHaveValue(
      shut,
    );
    await expect(
      page
        .getByRole('group', { name: 'Period 2' })
        .getByRole('radio', { name: 'Open at other hours' }),
    ).toBeChecked();

    // Copied to the owner's other listing, which then has them too.
    await page.getByRole('checkbox', { name: otherName }).check();
    await page.getByRole('button', { name: 'Copy dates' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Dates copied to 1 listing' }),
    ).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/en/owner/listings/${otherId}/closures`);
    await expect(page.getByRole('group', { name: /^Period \d+$/ })).toHaveCount(3);
    await expect(
      page.getByRole('group', { name: 'Period 3' }).getByLabel('Closed until'),
    ).toHaveValue('14:00');

    // The weekly hours take a break on a day, too.
    await page.goto(`/en/owner/listings/${otherId}/hours`);
    await page.getByRole('button', { name: 'Monday to Friday, 08:00–20:00' }).click();
    await page.getByRole('checkbox', { name: 'Closed for part of the day, Monday' }).check();
    await page.getByLabel('Closed until, Monday').selectOption('16:00');
    await expectAccessible(page);

    // And the week goes to another draft, saved here first. The live listing isn't offered.
    const copyHours = page.getByRole('region', { name: 'Copy these hours to other listings' });
    await expect(copyHours.getByRole('checkbox', { name: name })).toHaveCount(0);
    await copyHours.getByRole('checkbox', { name: thirdName }).check();
    await copyHours.getByRole('button', { name: 'Copy hours' }).click();
    await expect(copyHours.getByText('Hours saved and copied to 1 listing')).toBeVisible();
    await expect(page).toHaveURL(`/en/owner/listings/${otherId}/hours`);
    await expectAccessible(page);
    const mondayOf = async (listingId: string) => {
      const listing = (await (
        await page.request.get(`/api/v1/owner/listings/${listingId}`)
      ).json()) as {
        openingHours: { weekday: number; opens: string; closes: string }[];
      };
      return listing.openingHours.filter((period) => period.weekday === 1);
    };
    const monday = [
      { weekday: 1, opens: '08:00', closes: '14:00' },
      { weekday: 1, opens: '16:00', closes: '20:00' },
    ];
    expect(await mondayOf(otherId)).toEqual(monday);
    expect(await mondayOf(thirdId)).toEqual(monday);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page).toHaveURL(/\/(location|prices)$/);

    // The offer in Greek, on a phone: it reads and fits.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/el/owner/listings/${otherId}/hours`);
    await expect(
      page.getByRole('region', { name: 'Ίδιο ωράριο και σε άλλους χώρους σας' }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await expectAccessible(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // No new review: the listing is still live.
    await page.goto('/en/owner');
    await expect(page.getByText('Live', { exact: true })).toBeVisible();

    // In Greek, and on a phone, it reads and fits.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/el/owner/listings/${id}/closures`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Κλειστές ημέρες και ειδικό ωράριο',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await expectAccessible(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // What drivers see: dates and hours, not the note.
    await page.goto(`/en/parking/${slug}`);
    const table = page.getByRole('table', { name: 'Closures and special hours' });
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table.getByRole('row').first().getByRole('cell')).toHaveText('Closed');
    await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText(
      /^8:00\s?AM.*2:00\s?PM$/,
    );
    await expect(table.getByRole('row').nth(2).getByRole('cell')).toHaveText(
      /^Closed from 10:00\s?AM to 2:00\s?PM$/,
    );
    expect(await page.content()).not.toContain('Απογραφή');
    await expectAccessible(page);

    // The same in Greek, formatted by the server's own ICU, and at phone width.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/el/parking/${slug}`);
    const greek = page.getByRole('table', { name: 'Κλειστές ημέρες και ειδικό ωράριο' });
    await expect(greek.getByRole('row').nth(1).getByRole('cell')).toHaveText(/^08:00.*14:00$/);
    await expect(greek.getByRole('row').nth(2).getByRole('cell')).toHaveText(
      'Κλειστά από 10:00 έως 14:00',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await expectAccessible(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Search leaves it out on the closed day and finds it the day before.
    const found = async (day: string) => {
      const response = await page.request.get('/api/v1/parking/search', {
        params: {
          latitude: 35.3387,
          longitude: 25.1442,
          start: athensInstant(day, '10:00'),
          end: athensInstant(day, '12:00'),
        },
      });
      expect(response.status()).toBe(200);
      const { results } = (await response.json()) as { results: { slug: string }[] };
      return results.some((result) => result.slug === slug);
    };
    expect(await found(shut)).toBe(false);
    expect(await found(athensDay(19))).toBe(true);

    const stay = (day: string, from: string, to: string) =>
      `/en/parking/${slug}?startDate=${day}&startTime=${from}&endDate=${day}&endTime=${to}`;
    await page.goto(stay(shut, '10:00', '12:00'));
    await expect(page.getByText('Closed during part of your stay')).toBeVisible();
    await page.goto(stay(short, '09:00', '13:00'));
    await expect(page.getByText('Closed during part of your stay')).toBeHidden();
    await page.goto(stay(short, '13:00', '15:00'));
    await expect(page.getByText('Closed during part of your stay')).toBeVisible();
    await page.goto(stay(cleaning, '11:00', '12:00'));
    await expect(page.getByText('Closed during part of your stay')).toBeVisible();
    await page.goto(stay(cleaning, '15:00', '16:00'));
    await expect(page.getByText('Closed during part of your stay')).toBeHidden();

    // Nobody else can see or change them.
    const context = await browser.newContext({ storageState: SIGNED_IN_STATE });
    const stranger = await context.newPage();
    expect((await stranger.goto(`/en/owner/listings/${id}/closures`))?.status()).toBe(404);
    const write = await stranger.request.put(`/api/v1/owner/listings/${id}/hours-exceptions`, {
      headers: { origin: WEB_URL },
      data: { exceptions: [] },
    });
    expect(write.status()).toBe(404);
    const copy = await stranger.request.post(`/api/v1/owner/listings/${id}/hours-exceptions/copy`, {
      headers: { origin: WEB_URL },
      data: { to: [otherId] },
    });
    expect(copy.status()).toBe(404);
    const copyHoursAway = await stranger.request.post(
      `/api/v1/owner/listings/${otherId}/hours/copy`,
      {
        headers: { origin: WEB_URL },
        data: { to: [thirdId] },
      },
    );
    expect(copyHoursAway.status()).toBe(404);
    await context.close();

    expect(await csp()).toEqual([]);
  } finally {
    await unpublishListing(id);
  }
});
