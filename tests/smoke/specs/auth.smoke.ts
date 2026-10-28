import { expect, test } from '@playwright/test';
import { TEST_PASSWORD } from '../support/env';
import { uniqueEmail } from '../support/fixtures';

// Feature: authentication — sign up, session recognised by the API, sign out, sign in.

test('a driver signs up, is recognised by the API, signs out and signs back in', async ({
  page,
}) => {
  const email = uniqueEmail();

  await page.goto('/en/sign-up');
  await page.getByLabel('Name').fill('Smoke Driver');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL('/en/account');
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
  await page.getByLabel('Password').fill(TEST_PASSWORD);
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
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText('Use at least 10 characters')).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
  expect(authCalls).toBe(0);
});

test('wrong credentials get a translated, generic error', async ({ page }) => {
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(uniqueEmail('nobody'));
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Next.js also renders an (empty) role=alert route announcer, so match ours by its text.
  await expect(
    page.getByRole('alert').filter({ hasText: 'The email or password is incorrect.' }),
  ).toBeVisible();
});
