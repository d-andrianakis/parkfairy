import { expect, test } from '@playwright/test';
import { TEST_PASSWORD } from '../support/env';
import { expectAccessible, uniqueEmail } from '../support/fixtures';
import { totp } from '../support/totp';

// Feature: two-factor settings — a driver turns on two-factor authentication from the account
// page, the next sign-in asks for a code, and it can be turned off again. Uses its own
// account: enrolling rotates the session, which would sign out the shared smoke account.

test('a driver enrols in two-factor, signs in with a code, then turns it off', async ({ page }) => {
  const email = uniqueEmail('two-factor');
  await page.goto('/en/sign-up');
  await page.getByLabel('Name').fill('Two-Factor Driver');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/en/account');

  const settings = page.getByRole('heading', { name: 'Two-factor authentication', level: 2 });
  await expect(settings).toBeVisible();
  await expect(page.getByTestId('two-factor-status')).toContainText('Off.');

  // Set up: password again (a wrong one is refused), then the QR code and the same key as text.
  await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm it’s you' })).toBeFocused();
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'That password is incorrect.' }),
  ).toBeVisible();
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(
    page.getByRole('heading', { name: 'Add Parkfairy to your authenticator app' }),
  ).toBeFocused();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const secret = (await page.getByTestId('two-factor-key').textContent()) ?? '';
  expect(secret.replace(/\s/g, '')).toMatch(/^[A-Z2-7]{16,}$/);
  await expectAccessible(page);

  await page.getByLabel('Authentication code').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();

  // Backup codes are shown once, and the API now reports two-factor as on.
  await expect(page.getByRole('heading', { name: 'Save your backup codes' })).toBeFocused();
  await expect(
    page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem'),
  ).not.toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'I’ve saved them' }).click();
  await expect(page.getByTestId('two-factor-status')).toContainText('On.');
  const me = await page.request.get('/api/v1/me');
  expect(await me.json()).toMatchObject({ twoFactorEnabled: true });

  // The next sign-in needs a code from the authenticator app.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/en');
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/en/two-factor');
  await page.getByLabel('Authentication code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL('/en/account');

  // Turning it off asks for the password again.
  await page.getByRole('button', { name: 'Turn off two-factor authentication' }).click();
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Turn off two-factor authentication' }).click();
  await expect(page.getByTestId('two-factor-status')).toContainText('Off.');
  const after = await page.request.get('/api/v1/me');
  expect(await after.json()).toMatchObject({ twoFactorEnabled: false });
});
