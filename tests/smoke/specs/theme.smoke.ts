import { expect, test, type Locator, type Page } from '@playwright/test';
import { WEB_URL } from '../support/env';
import { expectAccessible, trackCspViolations } from '../support/fixtures';

// Feature: theme — light, dark or the OS setting; rendered by the server (no flash, no
// script), remembered per browser, and operable by keyboard. The menu itself loads on
// intent, so these tests also cover a press made before it has arrived.

/** Whether the page background is dark, whatever colour syntax the browser reports. */
function pageIsDark(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('no 2d canvas');
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return (r + g + b) / 3 < 128;
  });
}

function themeCookie(page: Page) {
  return page
    .context()
    .cookies()
    .then((cookies) => cookies.find((cookie) => cookie.name === 'theme'));
}

/** Waits for the menu's open animation, so axe measures final colours. */
async function settled(menu: Locator) {
  await expect(menu).toBeVisible();
  await menu.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
}

test.describe('with a dark OS setting', () => {
  test.use({ colorScheme: 'dark' });

  test('follows the OS until the reader chooses', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('html')).not.toHaveAttribute('class', /(light|dark)/);
    expect(await pageIsDark(page)).toBe(true);
  });

  test('an explicit choice wins over the OS, everywhere, from the first byte', async ({ page }) => {
    const violations = await trackCspViolations(page);
    await page.goto('/en/sign-in');

    await page.getByRole('button', { name: 'Theme' }).click();
    const menu = page.getByRole('menu', { name: 'Theme' });
    await expect(menu.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await settled(menu);
    await expectAccessible(page); // with the menu open
    await menu.getByRole('menuitemradio', { name: 'Light' }).click();

    await expect(page.locator('html')).toHaveClass('light');
    expect(await pageIsDark(page)).toBe(false);
    const cookie = await themeCookie(page);
    expect(cookie).toMatchObject({
      value: 'light',
      path: '/',
      sameSite: 'Lax',
      httpOnly: false,
      secure: WEB_URL.startsWith('https://'),
    });
    // Remembered beyond this browser session.
    expect(cookie?.expires ?? 0).toBeGreaterThan(Date.now() / 1000 + 300 * 24 * 60 * 60);

    // The server reads the cookie, so the first byte of HTML is already light, on every
    // page including the 404 (which renders without the app layout).
    const html = await (await page.request.get('/en/sign-in')).text();
    expect(html).toMatch(/<html lang="en" class="light"/);
    const notFound = await page.request.get('/en/no-such-page');
    expect(notFound.status()).toBe(404);
    expect(await notFound.text()).toMatch(/<html lang="en" class="light"/);

    await page.reload();
    expect(await pageIsDark(page)).toBe(false);
    await page.getByRole('button', { name: 'Theme' }).click();
    await expect(menu.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expectAccessible(page); // explicit light on a dark OS

    await page.goto('/el/sign-in'); // other language, same choice
    await expect(page.locator('html')).toHaveClass('light');
    expect(await violations()).toEqual([]);
  });
});

test('keyboard users can change the theme and keep their place', async ({ page }) => {
  await page.goto('/el');
  const trigger = page.getByRole('button', { name: 'Εμφάνιση' });
  const menu = page.getByRole('menu', { name: 'Εμφάνιση' });
  await trigger.focus();
  await page.keyboard.press('Enter');

  await expect(menu.getByRole('menuitemradio', { name: 'Ανοιχτόχρωμο' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Σκουρόχρωμο' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('html')).toHaveClass('dark');
  expect(await pageIsDark(page)).toBe(true);

  // Back to the OS setting forgets the choice.
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitemradio', { name: 'Ανοιχτόχρωμο' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Σκουρόχρωμο' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Προεπιλογή' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).not.toHaveAttribute('class', /(light|dark)/);
  expect(await themeCookie(page)).toBeUndefined();
});

test('Escape closes the menu without changing the theme', async ({ page }) => {
  await page.goto('/en');
  const trigger = page.getByRole('button', { name: 'Theme' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Theme' });
  await expect(menu.getByRole('menuitemradio', { name: 'Light' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: 'Dark' })).toBeFocused();
  await page.keyboard.press('Escape');

  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('html')).not.toHaveAttribute('class', /(light|dark)/);
  expect(await themeCookie(page)).toBeUndefined();
});

test('focus stays visible in Windows contrast themes, and motion can be reduced', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('/en');
  const trigger = page.getByRole('button', { name: 'Theme' });
  await trigger.focus();
  // Forced colours drop box-shadow focus rings; a (transparent) outline is drawn instead.
  await expect(trigger).toHaveCSS('outline-style', 'solid');

  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Theme' });
  const light = menu.getByRole('menuitemradio', { name: 'Light' });
  await expect(light).toBeFocused();
  await expect(light).toHaveCSS('outline-style', 'solid');
  // Only the focused item gets an outline.
  await expect(menu.getByRole('menuitemradio', { name: 'Dark' })).toHaveCSS(
    'outline-style',
    'none',
  );
  const duration = await menu.evaluate((element) => getComputedStyle(element).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.001);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false, colorScheme: 'light' });

  test('a saved dark theme is painted by the server', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: 'dark', url: baseURL ?? WEB_URL }]);
    for (const path of ['/el/sign-in', '/el/no-such-page']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveClass('dark');
      expect(await pageIsDark(page)).toBe(true);
    }
  });
});

test('a tampered theme cookie falls back to the OS setting', async ({ page, context, baseURL }) => {
  const value = 'dark" onload="alert(1)';
  await context.addCookies([{ name: 'theme', value, url: baseURL ?? WEB_URL }]);
  expect((await themeCookie(page))?.value).toBe(value); // the browser really sends it

  const response = await page.request.get('/en');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toMatch(/<html lang="en">/);
});
