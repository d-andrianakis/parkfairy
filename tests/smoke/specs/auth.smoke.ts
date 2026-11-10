import { expect, test } from '@playwright/test';
import { EMAIL_OUTBOX, TEST_PASSWORD } from '../support/env';
import { expectAccessible, ownVisitor, registerAndSignIn, uniqueEmail } from '../support/fixtures';

// Feature: authentication — sign up, session recognised by the API, sign out, sign in.

test.use(ownVisitor);

test('a driver signs up, is recognised by the API, signs out and signs back in', async ({
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  const email = uniqueEmail();

  await registerAndSignIn(page, email);

  await expect(page.getByRole('heading', { name: 'Verified by the API' })).toBeVisible();
  const apiUserId = page.getByTestId('api-user-id');
  await expect(apiUserId).toHaveText(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  const userId = await apiUserId.textContent();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/en');

  await page.goto('/en/account');
  await expect(page).toHaveURL('/en/sign-in?next=%2Faccount');

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL('/en/account');
  await expect(page.getByTestId('api-user-id')).toHaveText(userId ?? '');
});

test('sign-up validates input in the browser before calling the server', async ({ page }) => {
  let authCalls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/sign-up')) authCalls++;
  });

  await page.goto('/en/sign-up');
  await page.getByLabel('Name').fill('Short Password');
  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText('Use at least 10 characters')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(authCalls).toBe(0);
});

test('a password can be shown, by keyboard, and is hidden again on submit', async ({ page }) => {
  await page.goto('/en/sign-in');
  const password = page.getByLabel('Password', { exact: true });
  const show = page.getByRole('button', { name: 'Show password' });
  await page.getByLabel('Email').fill(uniqueEmail('nobody'));
  await password.fill(TEST_PASSWORD);
  await expect(password).toHaveAttribute('type', 'password');

  await password.press('Tab');
  await expect(show).toBeFocused();
  await show.press('Space');

  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue(TEST_PASSWORD);
  await expect(show).toHaveAttribute('aria-pressed', 'true');
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(show).toHaveAttribute('aria-pressed', 'false');
});

test('the show-password button fits a 320 px screen, in Greek', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/el/sign-up');
  const show = page.getByRole('button', { name: 'Εμφάνιση κωδικού πρόσβασης' });

  const button = await show.boundingBox();
  const input = await page.getByLabel('Κωδικός πρόσβασης', { exact: true }).boundingBox();
  expect(button?.height).toBeGreaterThanOrEqual(24); // WCAG 2.5.8
  expect(button?.width).toBeGreaterThanOrEqual(24);
  expect((button?.x ?? 0) + (button?.width ?? 0)).toBeLessThanOrEqual(
    (input?.x ?? 0) + (input?.width ?? 0),
  );
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
});

test('wrong credentials get a translated, generic error', async ({ page }) => {
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(uniqueEmail('nobody'));
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Next.js also renders an (empty) role=alert route announcer, so match ours by its text.
  await expect(
    page.getByRole('alert').filter({ hasText: 'The email or password is incorrect.' }),
  ).toBeVisible();
  await expectAccessible(page);
});

test('signing in and creating an account keep where the visitor was going (3.1)', async ({
  page,
}) => {
  const stay = '/parking/ermou-garage?startDate=2027-03-10&startTime=10:00';
  const next = (url: string) => new URL(url).searchParams.get('next');
  await page.goto(`/en/sign-in?next=${encodeURIComponent(stay)}`);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/en\/sign-up\?next=/);
  expect(next(page.url())).toBe(stay);
  await page.getByRole('main').getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/sign-in\?next=/);
  expect(next(page.url())).toBe(stay);
});
