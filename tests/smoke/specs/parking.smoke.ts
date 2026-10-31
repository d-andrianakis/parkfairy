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
    await form.getByRole('textbox', { name: 'Από Ημερομηνία' }).fill(day);
    await form.getByRole('combobox', { name: 'Από Ώρα' }).selectOption('09:00');
    await form.getByRole('textbox', { name: 'Έως Ημερομηνία' }).fill(day);
    await form.getByRole('combobox', { name: 'Έως Ώρα' }).selectOption('11:30');
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
  const endTime = page.getByRole('combobox', { name: 'Έως Ώρα' });
  await expect(endTime).toHaveAttribute('aria-invalid', 'true');
  await expect(endTime).toHaveAccessibleDescription('Η αναχώρηση πρέπει να είναι μετά την άφιξη');

  // The summary sits before the form and links to the field, naming it.
  const summary = page.getByRole('alert').filter({ hasText: 'Υπάρχει πρόβλημα' });
  await expect(
    summary.getByRole('link', {
      name: 'Έως: Η αναχώρηση πρέπει να είναι μετά την άφιξη',
      exact: true,
    }),
  ).toHaveAttribute('href', '#search-end-date');

  // Inline errors are not alerts, and fields are not unnamed groups (server → client roles).
  await expect(page.locator('[data-slot=field-error][role=alert]')).toHaveCount(0);
  await expect(page.locator('[data-slot=field][role=group]')).toHaveCount(0);
  await expect(page.getByTestId('result-count')).toHaveCount(0);
  await expectAccessible(page);
});

test('listing pages are public, and unknown listings are 404', async ({ request }) => {
  if (DEMO_DATA) {
    expect((await request.get('/en/parking/syntagma-square-garage')).status()).toBe(200);
  }
  expect((await request.get('/el/parking/no-such-listing')).status()).toBe(404);
  expect((await request.get('/el/parking/Not_A_Slug')).status()).toBe(404);
});
