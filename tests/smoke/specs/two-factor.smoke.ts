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
  // The page's own API panel refreshes too.
  await expect(page.getByTestId('api-two-factor')).toHaveText('Enabled');

  // The next sign-in needs a code from the authenticator app.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/en');
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/en/two-factor');
  // The password alone is not a session: the API still refuses.
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  await page.getByLabel('Authentication code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL('/en/account');

  // Turning it off asks for the password again; in Greek, on a 320 px phone, nothing
  // (long labels included) may push the page sideways.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/el/account');
  const turnOff = 'Απενεργοποίηση ελέγχου ταυτότητας δύο παραγόντων';
  await page.getByRole('button', { name: turnOff }).click();
  await expect(page.getByRole('heading', { name: 'Επιβεβαιώστε ότι είστε εσείς' })).toBeFocused();
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
  await page.getByLabel('Κωδικός πρόσβασης').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: turnOff }).click();
  await expect(page.getByTestId('two-factor-status')).toContainText('Ανενεργός.');
  await expect(page.getByTestId('api-two-factor')).toHaveText('Ανενεργός');
  const after = await page.request.get('/api/v1/me');
  expect(await after.json()).toMatchObject({ twoFactorEnabled: false });
});

test('the TOTP helper matches the RFC 6238 test vectors (SHA-1, last 6 digits)', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // base32 of "12345678901234567890"
  expect(totp(secret, 59_000)).toBe('287082');
  expect(totp(secret, 1_111_111_109_000)).toBe('081804');
  expect(totp(secret, 1_111_111_111_000)).toBe('050471');
  expect(totp(secret, 1_234_567_890_000)).toBe('005924');
  expect(totp(secret, 2_000_000_000_000)).toBe('279037');
  expect(totp(secret, 20_000_000_000_000)).toBe('353130');
});
