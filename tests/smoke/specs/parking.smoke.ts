import { expect, test, type Page } from '@playwright/test';
import { DEMO_DATA } from '../support/env';
import { expectAccessible, trackCspViolations } from '../support/fixtures';

// Feature: public parking catalogue — anyone can find demo parking by area or position and
// dates (half-hour steps), see who is open for the whole stay, and open a listing.

const needsDemoData = () => test.skip(!DEMO_DATA, 'Needs the demo listings (pnpm db:seed)');

/** The next date (YYYY-MM-DD, Athens calendar, at least two days out) on an ISO weekday. */
function nextAthensWeekday(isoWeekday: number): string {
  const athens = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' });
  for (let days = 2; days < 10; days++) {
    const date = athens.format(new Date(Date.now() + days * 86_400_000));
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
    if (weekday === isoWeekday) return date;
  }
  throw new Error('unreachable');
}

function searchQuery(area: string, date: string, from: string, until: string) {
  return new URLSearchParams({
    area,
    startDate: date,
    startTime: from,
    endDate: date,
    endTime: until,
  }).toString();
}

const results = (page: Page, name: string) => page.getByRole('region', { name });

const dateTimeField = (page: Page, name: string) =>
  page.getByRole('combobox', { name, exact: true });

const PICKER = {
  en: { next: 'Next month', hours: 'Hour', minutes: 'Minutes' },
  el: { next: 'Επόμενος μήνας', hours: 'Ώρα', minutes: 'Λεπτά' },
};

/** Opens one end of the stay and picks its day, hour and half hour. */
async function pickDateTime(
  page: Page,
  locale: keyof typeof PICKER,
  field: string,
  day: string,
  hour: string,
  minute: string,
) {
  const labels = PICKER[locale];
  await dateTimeField(page, field).click();
  const dialog = page.getByRole('dialog', { name: field });
  await expect(dialog.getByRole('grid')).toBeVisible();
  const dayName = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`),
  );
  const dayButton = dialog.getByRole('button', { name: dayName });
  if (!(await dayButton.isVisible())) {
    await dialog.getByRole('button', { name: labels.next }).click();
  }
  await dayButton.click();
  const radio = (group: string, name: string) =>
    dialog.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true });
  await radio(labels.hours, hour).click();
  await radio(labels.minutes, minute).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test.describe('with demo listings', () => {
  test.beforeEach(needsDemoData);

  test('the home page shows featured demo parking to anonymous visitors', async ({ page }) => {
    await page.goto('/en');
    const featured = page.getByRole('region', { name: 'Featured parking' });
    await expect(featured.getByRole('listitem').first()).toBeVisible();
    await expect(featured.getByRole('link', { name: 'Πάρκινγκ Ερμού' })).toBeVisible();
  });

  test('search by area and dates, then open a listing with the total for the stay', async ({
    page,
  }) => {
    const violations = await trackCspViolations(page);
    const day = nextAthensWeekday(3);
    await page.goto('/el');

    const form = page.getByRole('search', { name: 'Αναζήτηση στάθμευσης' });
    await form.getByRole('combobox', { name: 'Πού' }).selectOption('syntagma');
    await pickDateTime(page, 'el', 'Από', day, '09', '00');
    await pickDateTime(page, 'el', 'Έως', day, '11', '30');
    await form.getByRole('button', { name: 'Αναζήτηση' }).click();

    await expect(page).toHaveURL(/\/el\/search\?area=syntagma/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Στάθμευση στην περιοχή Σύνταγμα',
    );
    // The stay in Athens time on the 24-hour clock (CI runs in UTC; this catches zone slips),
    // read as "09:00 έως 11:30": the dash is hidden from screen readers.
    await expect(page.getByText(/09:00–?\s*έως\s*11:30/)).toBeVisible();
    const nearest = results(page, 'Αποτελέσματα').getByRole('listitem').first();
    await expect(nearest.getByRole('link', { name: 'Γκαράζ Πλατείας Συντάγματος' })).toBeVisible();
    await expect(nearest).toContainText('8,75 €'); // 2 h 30 at €3.50

    // Anywhere on the card opens the listing (the link covers it).
    // The title link's overlay covers the card, so a click on its middle lands on the link.
    await nearest.locator('[data-slot=card]').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Γκαράζ Πλατείας Συντάγματος');
    await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute('lang', 'el');
    await expect(page.getByText('Σύνολο 8,75 €')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Ωράριο λειτουργίας' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Θέσεις' }).locator(':scope > li')).toHaveCount(12);
    // Focus moved to the new page's content (client-side navigation).
    await expect(page.locator('#main-content')).toBeFocused();
    await expectAccessible(page); // listing with an open stay
    expect(await violations()).toEqual([]);
  });

  test('switching language keeps the search', async ({ page }) => {
    const day = nextAthensWeekday(3);
    await page.goto(`/el/search?${searchQuery('syntagma', day, '10:00', '12:00')}`);
    await page
      .getByRole('navigation', { name: 'Γλώσσα' })
      .getByRole('link', { name: 'English' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Parking near Syntagma');
    await expect(page.getByTestId('result-count')).toBeVisible();
    // The stay window survives the switch too, not just the area.
    await expect(page).toHaveURL(
      new RegExp(`/en/search\\?.*startDate=${day}.*startTime=10%3A00.*endTime=12%3A00`),
    );
  });

  test('search only shows places open for the whole stay', async ({ page }) => {
    const closedOnSunday = 'Γκαράζ Σκουφά';
    const weekdaysOnly = 'Ιδιωτική θέση Κολωνακίου';

    await page.goto(
      `/en/search?${searchQuery('kolonaki', nextAthensWeekday(7), '10:00', '12:00')}`,
    );
    await expect(page.getByTestId('result-count')).toBeVisible();
    await expect(results(page, 'Results').getByRole('link', { name: closedOnSunday })).toHaveCount(
      0,
    );
    await expect(results(page, 'Results').getByRole('link', { name: weekdaysOnly })).toHaveCount(0);

    await page.goto(
      `/en/search?${searchQuery('kolonaki', nextAthensWeekday(1), '10:00', '12:00')}`,
    );
    await expect(
      results(page, 'Results').getByRole('link', { name: closedOnSunday }),
    ).toBeVisible();
    await expect(results(page, 'Results').getByRole('link', { name: weekdaysOnly })).toBeVisible();
  });

  test('an area with nothing open says so', async ({ page }) => {
    // The Marousi business park is the only listing within 5 km, and closed on Sundays.
    await page.goto(`/en/search?${searchQuery('marousi', nextAthensWeekday(7), '10:00', '12:00')}`);
    await expect(page.getByText('No parking available')).toBeVisible();
    await expectAccessible(page);
  });

  test('a listing says when it is closed for the stay', async ({ page }) => {
    const sunday = nextAthensWeekday(7);
    const query = new URLSearchParams({
      startDate: sunday,
      startTime: '10:00',
      endDate: sunday,
      endTime: '12:00',
    });
    await page.goto(`/en/parking/kolonaki-private-space?${query}`);
    await expect(
      page.getByText('Closed during part of your stay.', { exact: false }),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test.describe('near me', () => {
    test.use({
      geolocation: { latitude: 37.9755, longitude: 23.7348 },
      permissions: ['geolocation'],
    });

    test('searches around the browser position, rounded to about 100 m', async ({ page }) => {
      await page.goto('/en');
      await page.getByRole('button', { name: 'Use my location' }).click();

      await expect(page).toHaveURL(/[?&]latitude=37\.97[56]&longitude=23\.735&/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Parking near you');
      await expect(
        results(page, 'Results').getByRole('link', { name: 'Γκαράζ Πλατείας Συντάγματος' }),
      ).toBeVisible();
    });
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('the search form still works', async ({ page }) => {
      await page.goto('/en');
      await page.getByRole('combobox', { name: 'Where' }).selectOption('piraeusPort');
      // The picker needs a script, so the plain date and time stay.
      await expect(page.getByRole('textbox', { name: 'From Date' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Until Time' })).toBeVisible();
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Parking near Piraeus Port');
      await expect(results(page, 'Results').getByRole('listitem').first()).toBeVisible();
    });
  });

  test('listing cards show keyboard focus in Windows contrast themes', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/en');
    const card = page
      .getByRole('region', { name: 'Featured parking' })
      .getByRole('listitem')
      .first();
    await card.getByRole('link').focus();
    await expect(card.locator('[data-slot=card]')).toHaveCSS('outline-style', 'solid');
  });
});

test('an invalid search explains what to fix, in the page language', async ({ page }) => {
  const day = nextAthensWeekday(3);
  await page.goto(`/el/search?${searchQuery('syntagma', day, '10:00', '09:00')}`);

  await expect(page).toHaveTitle(/^Σφάλμα: /);
  const until = dateTimeField(page, 'Έως');
  await expect(until).toHaveAttribute('aria-invalid', 'true');
  await expect(until).toHaveAccessibleDescription('Η αναχώρηση πρέπει να είναι μετά την άφιξη');

  // The summary sits before the form and links to the field, naming it.
  const summary = page.getByRole('alert').filter({ hasText: 'Υπάρχει πρόβλημα' });
  await expect(
    summary.getByRole('link', {
      name: 'Έως: Η αναχώρηση πρέπει να είναι μετά την άφιξη',
      exact: true,
    }),
  ).toHaveAttribute('href', '#search-end-date');
  await summary.getByRole('link').click();
  await expect(until).toBeFocused();

  // Inline errors are not alerts, and fields are not unnamed groups (server → client roles).
  await expect(page.locator('[data-slot=field-error][role=alert]')).toHaveCount(0);
  await expect(page.locator('[data-slot=field][role=group]')).toHaveCount(0);
  await expect(page.getByTestId('result-count')).toHaveCount(0);
  await expectAccessible(page);
});

test.describe('the date and time picker', () => {
  test('loads only once someone heads for it', async ({ page }) => {
    const scripts: string[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') scripts.push(response.url());
    });
    await page.goto('/en', { waitUntil: 'networkidle' });
    const atFirst = scripts.length;

    await dateTimeField(page, 'From').hover();

    await expect.poll(() => scripts.length).toBeGreaterThan(atFirst);
  });

  test('works from the keyboard and gives the focus back', async ({ page }) => {
    await page.goto('/en');
    const from = dateTimeField(page, 'From');
    const before = await from.textContent();

    await from.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'From' });
    await expect(dialog.locator(':focus')).toHaveAttribute('data-day', /./); // a day, not the arrows

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    const hours = dialog.getByRole('radiogroup', { name: 'Hour' });
    await expect(hours.getByRole('radio', { checked: true })).toBeFocused();
    await page.keyboard.press('Tab');
    const minutes = dialog.getByRole('radiogroup', { name: 'Minutes' });
    await expect(minutes.getByRole('radio', { checked: true })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(from).toBeFocused();
    await expect(from).not.toHaveText(before ?? '');
  });

  test('speaks Greek on the 24-hour clock, and passes axe in both themes', async ({ page }) => {
    await page.goto('/el');
    await dateTimeField(page, 'Από').click();
    const dialog = page.getByRole('dialog', { name: 'Από' });

    await expect(dialog.getByRole('button', { name: 'Επόμενος μήνας' })).toBeVisible();
    const hours = dialog.getByRole('radiogroup', { name: 'Ώρα' });
    await expect(hours.getByRole('radio')).toHaveCount(24);
    await expect(hours.getByRole('radio').first()).toHaveText('00');
    await expectAccessible(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    // Toggles fade their text while the fill changes at once: axe must judge where they settle.
    await page.evaluate(() =>
      Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
    );
    await expectAccessible(page);
  });

  test('shows the chosen day and hour in Windows contrast themes', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/en');
    await dateTimeField(page, 'From').click();
    const dialog = page.getByRole('dialog', { name: 'From' });

    const hour = dialog
      .getByRole('radiogroup', { name: 'Hour' })
      .getByRole('radio', { checked: true });
    await expect(hour).toHaveCSS('outline-style', 'solid');
    await expect(dialog.locator('[data-selected-single=true]')).toHaveCSS('outline-style', 'solid');
    // Today can't lean on its fill here.
    await expect(dialog.locator('[data-today] button')).toHaveCSS(
      'text-decoration-line',
      'underline',
    );
  });

  test('fits a 320 px phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/el');
    await dateTimeField(page, 'Από').click();
    const dialog = page.getByRole('dialog', { name: 'Από' });
    await expect(dialog.getByRole('grid')).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(304); // the page's gutter
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );

    // The hours scroll sideways here; the last of them is still reachable.
    await dialog.getByRole('radio', { name: '23', exact: true }).click();
    await expect(dateTimeField(page, 'Από')).toContainText('23:');
  });

  for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    test.describe(`from ${timezoneId}`, () => {
      test.use({ timezoneId });

      test('keeps the Athens day that was pressed', async ({ page }) => {
        const day = nextAthensWeekday(3);
        await page.goto('/en');
        await pickDateTime(page, 'en', 'From', day, '2 PM', '30');

        await expect(page.locator('input[name=startDate]')).toHaveValue(day);
        await expect(page.locator('input[name=startTime]')).toHaveValue('14:30');
      });
    });
  }

  test('a From picked past Until takes Until along, and the search goes through', async ({
    page,
  }) => {
    const day = nextAthensWeekday(3);
    await page.goto(`/en/search?${searchQuery('syntagma', day, '09:00', '11:30')}`);

    await pickDateTime(page, 'en', 'From', day, '2 PM', '30');

    await expect(page.locator('input[name=endDate]')).toHaveValue(day);
    await expect(page.locator('input[name=endTime]')).toHaveValue('17:00');
    await expect(page.getByRole('status').filter({ hasText: 'Departure moved to' })).toContainText(
      '5:00',
    );

    await page.getByRole('search').getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/startTime=14%3A30.*endTime=17%3A00/);
    await expect(page.getByTestId('result-count')).toBeVisible(); // only with an API response
    await expect(page).not.toHaveTitle(/^Error: /);
    await expect(dateTimeField(page, 'Until')).not.toHaveAttribute('aria-invalid', 'true');

    await page.goto(`/el/search?${searchQuery('syntagma', day, '09:00', '11:30')}`);
    await pickDateTime(page, 'el', 'Από', day, '14', '30');
    await expect(page.getByRole('status').filter({ hasText: 'Η αναχώρηση άλλαξε' })).toContainText(
      '17:00',
    );
  });

  test('a date the URL mangled asks for a new one', async ({ page }) => {
    const query =
      'area=syntagma&startDate=nonsense&startTime=10:00&endDate=2030-01-01&endTime=12:00';
    await page.goto(`/en/search?${query}`);

    await expect(dateTimeField(page, 'From')).toContainText('Choose a date and time');
    await expect(dateTimeField(page, 'From')).toHaveAttribute('aria-invalid', 'true');
  });
});

test('listing pages are public, and unknown listings are 404', async ({ request }) => {
  if (DEMO_DATA) {
    expect((await request.get('/en/parking/syntagma-square-garage')).status()).toBe(200);
  }
  expect((await request.get('/el/parking/no-such-listing')).status()).toBe(404);
  expect((await request.get('/el/parking/Not_A_Slug')).status()).toBe(404);
});
