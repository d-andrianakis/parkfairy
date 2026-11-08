import { expect, test, type Page } from '@playwright/test';
import { DEMO_DATA, EMAIL_OUTBOX, SIGNED_IN_STATE, WEB_URL } from '../support/env';
import { expectAccessible, ownDriver } from '../support/fixtures';

// Feature: accessibility — every page passes WCAG 2.2 AA automated checks in both
// languages (including colour contrast, which jsdom unit tests cannot measure).

const publicPages = [
  '',
  '/sign-in',
  '/sign-up',
  '/two-factor',
  '/forgot-password',
  '/reset-password?token=not-a-real-token',
  '/reset-password?error=INVALID_TOKEN',
  '/reset-password?done=1',
  '/verify-email',
  '/verify-email?token=not-a-real-token',
  '/no-such-page',
  '/owner',
  // Public catalogue (demo listings from pnpm db:seed).
  ...(DEMO_DATA ? ['/search?area=syntagma', '/parking/syntagma-square-garage'] : []),
];
const locales = ['el', 'en'] as const;
const accountNav = { el: 'Λογαριασμός', en: 'Account' } as const;

/**
 * A hold of the shared account's on a demo listing, far ahead, for a page to show; let go after.
 * Null where bookings aren't taken (only a local run takes them without payment, decision #33).
 */
async function demoHold(page: Page, daysAhead: number): Promise<string | null> {
  const slug = 'syntagma-square-garage';
  // On the half hour, in UTC, inside the demo garage's hours.
  const day = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
  const stay = { start: `${day}T08:00:00.000Z`, end: `${day}T10:00:00.000Z` };
  const listing = (await (
    await page.request.get(`/api/v1/parking/${slug}`, { params: stay })
  ).json()) as { bookingOpen: boolean; spaces: { id: string }[] };
  if (!listing.bookingOpen) return null;
  const held = await page.request.post('/api/v1/bookings', {
    headers: { origin: WEB_URL },
    data: { listing: slug, spaceId: listing.spaces[0]?.id, ...stay },
  });
  expect(held.status()).toBe(201);
  return ((await held.json()) as { id: string }).id;
}

const letGo = (page: Page, id: string) =>
  page.request.post(`/api/v1/bookings/${id}/cancel`, { headers: { origin: WEB_URL } });

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
        await expectNoSidewaysScroll(page, locale, 3);
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
      await expect(page.getByTestId('api-user-id')).toHaveText(/^[0-9a-f-]{36}$/);
      await expectAccessible(page);
    });
  }

  // Every step, with its forms filled in, is checked along the way in owner-onboarding.smoke.ts.
  for (const locale of locales) {
    for (const path of [
      '/owner',
      '/owner/profile',
      '/owner/tax',
      '/bookings',
      '/bookings?when=past',
    ]) {
      test(`/${locale}${path} has no WCAG 2.2 AA violations, signed in`, async ({ page }) => {
        await page.goto(`/${locale}${path}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectAccessible(page);
      });
    }
  }

  test('a booking’s page has no WCAG 2.2 AA violations, both languages, with its errors, dark', async ({
    browser,
  }) => {
    test.skip(!DEMO_DATA, 'needs the demo listings (pnpm db:seed)');
    test.skip(!EMAIL_OUTBOX, 'A driver of its own needs a confirmation email');
    // Signing up, through the emailed link, takes longer than a page check.
    test.setTimeout(120_000);
    // Not the shared account: its other tests' holds would let this one go.
    const { context, page } = await ownDriver(browser, 'a11y-booking');
    const id = await demoHold(page, 200);
    test.skip(!id, 'Bookings are taken without payment on a local run only');
    try {
      for (const locale of locales) {
        await page.goto(`/${locale}/bookings/${id}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectAccessible(page);
      }
      // No plate, from the keyboard: the error state, in dark mode.
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto(`/en/bookings/${id}`);
      await page.getByRole('button', { name: 'Confirm booking' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('textbox', { name: 'Number plate' })).toBeFocused();
      await expectAccessible(page);
    } finally {
      if (id) await letGo(page, id);
      await context.close();
    }
  });

  // On a draft of the shared account's own, so it runs anywhere: no database or outbox needed.
  test('closures and special hours have no WCAG 2.2 AA violations, by keyboard, both languages, dark', async ({
    page,
  }) => {
    const headers = { origin: WEB_URL };
    const created = await page.request.post('/api/v1/owner/listings', { headers });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    try {
      for (const locale of locales) {
        await page.goto(`/${locale}/owner/listings/${id}/closures`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectAccessible(page);
      }
      // Add a period and save it empty, all from the keyboard: the error state, in dark mode.
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto(`/en/owner/listings/${id}/closures`);
      await page.getByRole('button', { name: 'Add dates' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('First day')).toBeFocused();
      await page.getByRole('button', { name: 'Save' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('First day')).toBeFocused();
      await expect(page.getByLabel('First day')).toHaveAttribute('aria-invalid', 'true');
      await expectAccessible(page);
    } finally {
      await page.request.delete(`/api/v1/owner/listings/${id}`, { headers });
    }
  });

  test('/en/owner/profile has no WCAG 2.2 AA violations in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en/owner/profile');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('/el/owner reflows at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/el/owner');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSidewaysScroll(page, 'el', 3);
  });

  test('/el/account reflows at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/el/account');
    await expect(page.getByTestId('api-user-id')).toHaveText(/^[0-9a-f-]{36}$/); // long UUID and email
    await expectNoSidewaysScroll(page, 'el', 3);
  });

  test('/en/account has no WCAG 2.2 AA violations in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en/account');
    await expect(page.getByTestId('api-user-id')).toHaveText(/^[0-9a-f-]{36}$/);
    await expectAccessible(page);
  });
});
