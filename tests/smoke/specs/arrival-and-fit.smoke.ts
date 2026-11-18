import { expect, type Page, test } from '@playwright/test';

import { DEMO_DATA } from '../support/env';
import { expectAccessible, trackCspViolations } from '../support/fixtures';
import { athensDay, athensInstant } from '../support/listings';

// Feature: filters and fit (5A.1). A driver narrows a search to the parking that has what they
// need (a space with all the features, the listing's security) and to spaces that fit their
// vehicle, in centimetres. Owners' limits and security show on the listing; how to get in does not:
// it is read on a booking's page (booking.smoke.ts).

test.beforeEach(() => test.skip(!DEMO_DATA, 'Needs the demo listings (pnpm db:seed)'));

const GARAGE = 'Γκαράζ Πλατείας Συντάγματος'; // CCTV, lit, gated; spaces 190 and 210 cm high
const ERMOU = 'Πάρκινγκ Ερμού'; // CCTV; spaces 200 cm high
const MONASTIRAKI = 'Υπαίθριος χώρος Μοναστηρακίου'; // lit only; no limits

const day = () => athensDay(6);
const search = (locale: 'en' | 'el', extra: Record<string, string | string[]> = {}) => {
  const params = new URLSearchParams({
    area: 'syntagma',
    startDate: day(),
    startTime: '10:00',
    endDate: day(),
    endTime: '12:00',
  });
  for (const [key, value] of Object.entries(extra)) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return `/${locale}/search?${params.toString()}`;
};
const card = (page: Page, name: string) => page.getByRole('link', { name, exact: true });

test('narrows a search by what the parking has, all of it at once', async ({ page }) => {
  const violations = await trackCspViolations(page);
  await page.goto(search('en'));
  await expect(card(page, GARAGE)).toBeVisible();
  await expect(card(page, ERMOU)).toBeVisible();
  await expect(card(page, MONASTIRAKI)).toBeVisible();

  // Through the form, as a driver does: tick, search, and the page keeps the ticks.
  const filters = page.getByRole('group', { name: 'Filters' });
  await filters.getByRole('checkbox', { name: 'CCTV' }).check();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/security=cctv/);
  await expect(card(page, GARAGE)).toBeVisible();
  await expect(card(page, ERMOU)).toBeVisible();
  await expect(card(page, MONASTIRAKI)).toHaveCount(0);
  await expect(filters.getByRole('checkbox', { name: 'CCTV' })).toBeChecked();

  // Both together: only a listing with both.
  await filters.getByRole('checkbox', { name: 'Gated entry' }).check();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/security=cctv&security=gated/);
  await expect(card(page, GARAGE)).toBeVisible();
  await expect(card(page, ERMOU)).toHaveCount(0);

  // A feature is a space's: covered with a charger is the garage's first three.
  await page.goto(search('en', { features: ['covered', 'evCharging'] }));
  await expect(card(page, GARAGE)).toBeVisible();
  await expect(card(page, ERMOU)).toHaveCount(0);
  expect(await violations()).toEqual([]);
});

test('leaves out spaces too small for the vehicle, and keeps those that state no limit', async ({
  page,
}) => {
  await page.goto(search('en', { vehicleHeightCm: '205' }));
  // The garage's deeper spaces take 210; Ermou's 200 do not; Monastiraki states nothing.
  await expect(card(page, GARAGE)).toBeVisible();
  await expect(card(page, ERMOU)).toHaveCount(0);
  await expect(card(page, MONASTIRAKI)).toBeVisible();
  await expect(page.getByLabel('Height (cm)')).toHaveValue('205');

  await page.goto(search('en', { vehicleHeightCm: '215' }));
  await expect(card(page, GARAGE)).toHaveCount(0);
  await expect(card(page, MONASTIRAKI)).toBeVisible();

  await page.goto(search('en', { vehicleHeightCm: '190' }));
  await expect(card(page, GARAGE)).toBeVisible();
  await expect(card(page, ERMOU)).toBeVisible();
});

test('says in centimetres what is wrong with a size, naming the field', async ({ page }) => {
  await page.goto(search('en', { vehicleHeightCm: '99' }));
  const height = page.getByLabel('Height (cm)');
  await expect(height).toHaveAttribute('aria-invalid', 'true');
  await expect(height).toHaveAccessibleDescription(/Enter a height from 100 to 500 cm/);
  const summary = page
    .getByRole('alert')
    .filter({ hasText: 'There is a problem with your search' });
  await expect(
    summary.getByRole('link', {
      name: 'Height (cm): Enter a height from 100 to 500 cm',
      exact: true,
    }),
  ).toHaveAttribute('href', '#search-vehicle-height');
  await summary.getByRole('link').click();
  await expect(height).toBeFocused();
  await expect(page.getByTestId('result-count')).toHaveCount(0);
  await expectAccessible(page);

  await page.goto(search('el', { vehicleHeightCm: 'ψηλό' }));
  await expect(page.getByLabel('Ύψος (εκ.)')).toHaveAccessibleDescription(
    'Εισαγάγετε ύψος από 100 έως 500 εκ.',
  );
});

test('keeps the filters when the language changes', async ({ page }) => {
  await page.goto(search('el', { features: ['covered', 'accessible'], security: 'cctv' }));
  await page
    .getByRole('navigation', { name: 'Γλώσσα' })
    .getByRole('link', { name: 'English' })
    .click();
  await expect(page).toHaveURL(/features=covered&features=accessible/);
  await expect(page).toHaveURL(/security=cctv/);
  const filters = page.getByRole('group', { name: 'Filters' });
  await expect(filters.getByRole('checkbox', { name: 'Covered' })).toBeChecked();
  await expect(filters.getByRole('checkbox', { name: 'Accessible space' })).toBeChecked();
  await expect(filters.getByRole('checkbox', { name: 'CCTV' })).toBeChecked();
});

test('shows security and limits on the listing, in both languages, and not how to get in', async ({
  page,
}) => {
  const violations = await trackCspViolations(page);
  await page.goto('/en/parking/syntagma-square-garage');
  const security = page.getByRole('list', { name: 'Security' });
  await expect(security).toContainText('CCTV');
  await expect(security).toContainText('Lit at night');
  await expect(security).toContainText('Gated entry');
  const spaces = page.getByRole('list', { name: 'Spaces' });
  await expect(spaces).toContainText('Vehicles up to 190 cm high');
  await expect(spaces).toContainText('Vehicles up to 210 cm wide');
  await expectAccessible(page);

  await page.goto('/el/parking/syntagma-square-garage');
  await expect(page.getByRole('list', { name: 'Ασφάλεια' })).toContainText('Κάμερες ασφαλείας');
  await expect(page.getByText('Ύψος οχήματος έως 190 εκ.').first()).toBeVisible();
  await expectAccessible(page);

  // The gate code is for a driver with a booking: not in the page, nor in what the API serves.
  const hidden = 'φαρμακείο';
  expect(await page.content()).not.toContain(hidden);
  for (const path of [
    '/api/v1/parking/syntagma-square-garage',
    '/api/v1/parking/featured',
    `/api/v1/parking/search?area=syntagma&start=${encodeURIComponent(athensInstant(day(), '10:00'))}&end=${encodeURIComponent(athensInstant(day(), '12:00'))}`,
  ]) {
    const response = await page.request.get(path);
    expect(await response.text(), path).not.toContain(hidden);
  }
  expect(await violations()).toEqual([]);
});

test('fits a phone, in Greek, with the filters in view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(search('el', { vehicleHeightCm: '190', security: 'gated' }));
  await expect(page.getByRole('group', { name: 'Φίλτρα' })).toBeVisible();
  // No sideways scrolling at 320 px (WCAG 1.4.10).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectAccessible(page);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the filters are plain form fields: tick, search, and the page keeps them', async ({
    page,
  }) => {
    await page.goto(search('en'));
    const filters = page.getByRole('group', { name: 'Filters' });
    await filters.getByRole('checkbox', { name: 'Gated entry' }).check();
    await filters.getByLabel('Height (cm)').fill('185');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/security=gated/);
    await expect(page).toHaveURL(/vehicleHeightCm=185/);
    await expect(card(page, GARAGE)).toBeVisible();
    await expect(card(page, ERMOU)).toHaveCount(0);
    await expect(filters.getByRole('checkbox', { name: 'Gated entry' })).toBeChecked();
    await expect(filters.getByLabel('Height (cm)')).toHaveValue('185');
  });
});
