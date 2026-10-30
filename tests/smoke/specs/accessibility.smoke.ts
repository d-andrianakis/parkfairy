import { expect, test, type Page } from '@playwright/test';
import { DEMO_DATA, SIGNED_IN_STATE } from '../support/env';
import { expectAccessible } from '../support/fixtures';

// Feature: accessibility — every page passes WCAG 2.2 AA automated checks in both
// languages (including colour contrast, which jsdom unit tests cannot measure).

const publicPages = [
  '',
  '/sign-in',
  '/sign-up',
  '/two-factor',
  '/no-such-page',
  // Public catalogue (demo listings from pnpm db:seed).
  ...(DEMO_DATA ? ['/search?area=syntagma', '/parking/syntagma-square-garage'] : []),
];
const locales = ['el', 'en'] as const;
const accountNav = { el: 'Λογαριασμός', en: 'Account' } as const;

/**
 * WCAG 1.4.10 Reflow. Measured once the header is complete: its account links arrive after a
 * client session check (the 404 page has no header).
 */
async function expectNoSidewaysScroll(page: Page, locale: 'el' | 'en', links: number) {
  if (!page.url().endsWith('/no-such-page')) {
    await expect(
      page.getByRole('navigation', { name: accountNav[locale] }).getByRole('link'),
    ).toHaveCount(links);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const locale of locales) {
  for (const path of publicPages) {
    test(`/${locale}${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await page.goto(`/${locale}${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page);
    });
  }
}

// WCAG 1.4.10 Reflow: no sideways scrolling at 320 CSS px. Greek labels run longer.
test.describe('narrow screens', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const locale of locales) {
    for (const path of publicPages) {
      test(`/${locale}${path} reflows at 320px`, async ({ page }) => {
        await page.goto(`/${locale}${path}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoSidewaysScroll(page, locale, 2);
      });
    }
  }
});

// Contrast differs per theme, not per language, so dark mode is checked in one locale.
test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });

  for (const path of publicPages) {
    test(`/en${path} has no WCAG 2.2 AA violations in dark mode`, async ({ page }) => {
      await page.goto(`/en${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page);
    });
  }

  test('form errors stay accessible in dark mode', async ({ page }) => {
    await page.goto('/en/sign-up');
    // A typed, invalid value: its text must stay readable inside the red-bordered field.
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
  });
});

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

  test('/el/account reflows at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/el/account');
    await expect(page.getByTestId('api-user-id')).toBeVisible(); // long UUID and email
    await expectNoSidewaysScroll(page, 'el', 1);
  });

  test('/en/account has no WCAG 2.2 AA violations in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en/account');
    await expect(page.getByTestId('api-user-id')).toBeVisible();
    await expectAccessible(page);
  });
});
