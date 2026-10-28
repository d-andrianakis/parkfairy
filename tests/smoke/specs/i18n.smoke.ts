import { expect, test } from '@playwright/test';
import { SIGNED_IN_STATE } from '../support/env';

// Feature: internationalization — Greek and English, negotiated, switchable, persisted.

test('the root URL negotiates the visitor’s language', async ({ request }) => {
  const greek = await request.get('/', {
    headers: { 'accept-language': 'el-GR,el;q=0.9' },
    maxRedirects: 0,
  });
  expect(greek.status()).toBe(307);
  expect(greek.headers().location).toMatch(/\/el$/);

  const english = await request.get('/', {
    headers: { 'accept-language': 'en-US,en;q=0.9' },
    maxRedirects: 0,
  });
  expect(english.headers().location).toMatch(/\/en$/);
});

test('pages declare their language and advertise the alternates', async ({ page }) => {
  const response = await page.goto('/el');
  await expect(page.locator('html')).toHaveAttribute('lang', 'el');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Στάθμευση, κλεισμένη πριν φτάσετε.',
  );
  expect(response?.headers().link).toContain('hreflang="en"');
});

test('switching language keeps the reader on the same page', async ({ page }) => {
  await page.goto('/en/sign-in');
  const switcher = page.getByRole('navigation', { name: 'Language' });
  await expect(switcher.getByRole('link', { name: 'English' })).toHaveAttribute(
    'aria-current',
    'true',
  );

  await switcher.getByRole('link', { name: 'Ελληνικά' }).click();

  await expect(page).toHaveURL('/el/sign-in');
  await expect(page.locator('html')).toHaveAttribute('lang', 'el');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Σύνδεση');
  await expect(
    page.getByRole('navigation', { name: 'Γλώσσα' }).getByRole('link', { name: 'Ελληνικά' }),
  ).toHaveAttribute('aria-current', 'true');
});

test('validation messages are shown in the page language', async ({ page }) => {
  await page.goto('/el/sign-in');
  await page.getByRole('button', { name: 'Σύνδεση' }).click();
  await expect(page.getByText('Εισαγάγετε μια έγκυρη διεύθυνση email')).toBeVisible();
});

test('unknown pages get a localized 404', async ({ page }) => {
  const response = await page.goto('/el/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'el');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Δεν βρήκαμε αυτή τη σελίδα');
});

test.describe('signed in', () => {
  test.use({ storageState: SIGNED_IN_STATE });

  test('the account remembers the language it was created in', async ({ page }) => {
    await page.goto('/en/account');
    await expect(page.getByTestId('api-user-locale')).toHaveText('Ελληνικά');
    await expect(page.getByTestId('api-user-locale')).toHaveAttribute('lang', 'el');
  });
});
