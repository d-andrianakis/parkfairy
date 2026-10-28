import { expect, test } from '@playwright/test';
import { SIGNED_IN_STATE } from '../support/env';
import { expectAccessible } from '../support/fixtures';

// Feature: accessibility — every page passes WCAG 2.2 AA automated checks in both
// languages (including colour contrast, which jsdom unit tests cannot measure).

const publicPages = ['', '/sign-in', '/sign-up', '/two-factor', '/no-such-page'];
const locales = ['el', 'en'];

for (const locale of locales) {
  for (const path of publicPages) {
    test(`/${locale}${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await page.goto(`/${locale}${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page);
    });
  }
}

test('form errors stay accessible', async ({ page }) => {
  await page.goto('/el/sign-up');
  await page.getByRole('button', { name: 'Δημιουργία λογαριασμού' }).click();
  await expect(page.getByLabel('Όνομα')).toHaveAttribute('aria-invalid', 'true');
  await expectAccessible(page);
});

test('keyboard users can skip straight to the content', async ({ page }) => {
  await page.goto('/en');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test.describe('signed in', () => {
  test.use({ storageState: SIGNED_IN_STATE });

  for (const locale of locales) {
    test(`/${locale}/account has no WCAG 2.2 AA violations`, async ({ page }) => {
      await page.goto(`/${locale}/account`);
      await expect(page.getByTestId('api-user-id')).toBeVisible();
      await expectAccessible(page);
    });
  }
});
