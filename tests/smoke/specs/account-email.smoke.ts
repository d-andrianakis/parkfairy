import { expect, test } from '@playwright/test';
import { emailLink, emailsTo, waitForEmail } from '../support/email';
import { EMAIL_OUTBOX, TEST_PASSWORD, WEB_URL } from '../support/env';
import {
  confirmEmail,
  expectAccessible,
  ownVisitor,
  registerAndSignIn,
  signIn,
  signUp,
  uniqueEmail,
} from '../support/fixtures';

// Feature: account emails — confirming an address before the first sign-in, and getting back
// into an account with a forgotten password. Reads what the web app writes to its outbox.

test.use(ownVisitor);

const NEW_PASSWORD = 'a much better horse staple';
const CONFIRM = 'Confirm your email address';
const readsOutbox = () => test.skip(!EMAIL_OUTBOX, 'Reads the local web app’s outbox');

test('an address must be confirmed before the first sign-in', async ({ page }) => {
  readsOutbox();
  const email = uniqueEmail('confirm');

  await signUp(page, email);
  await expect(page).toHaveTitle(/^Check your inbox/);
  await expectAccessible(page);
  await waitForEmail(email, CONFIRM);
  // Signing up opened no session.
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);

  // Asking again sends another link, and says so.
  await page.getByRole('button', { name: 'Send it again' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sent.' })).toBeVisible();
  await expect.poll(async () => (await emailsTo(email)).length).toBe(2);

  await page.goto('/en/sign-in');
  await signIn(page, email);
  const refused = page.getByRole('alert').filter({
    hasText: 'Confirm your email address first.',
  });
  await expect(refused).toBeVisible();
  await expect(page).toHaveURL('/en/sign-in');
  await expectAccessible(page);
  await expect.poll(async () => (await emailsTo(email)).length).toBe(3);

  // Opening the link confirms nothing, as a mail scanner fetching it must not.
  await page.goto(emailLink(await waitForEmail(email, CONFIRM)));
  await expect(page.getByRole('button', { name: 'Confirm email' })).toBeVisible();
  await expectAccessible(page);
  await page.goto('/en/sign-in');
  await signIn(page, email);
  await expect(refused).toBeVisible();

  // Pressing the button does, and is not a session: a stranger may have signed up with it.
  await confirmEmail(page, email);
  await expect(page).toHaveTitle(/^Email confirmed/);
  await expectAccessible(page);
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);

  await page.goto('/en/sign-in');
  await signIn(page, email);
  await expect(page).toHaveURL('/en/account');
  await expect(page.getByTestId('api-user-id')).toBeVisible();
});

test('signing up with a taken address gives nothing away and tells the owner', async ({ page }) => {
  readsOutbox();
  const email = uniqueEmail('taken');
  await signUp(page, email);
  await signUp(page, email); // same screen as a new address, and no session

  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  const notice = await waitForEmail(email, 'You already have a Parkfairy account');
  expect(emailLink(notice)).toMatch(/\/en\/forgot-password$/);
});

test('a forgotten password is replaced through the emailed link', async ({ page }) => {
  readsOutbox();
  const email = uniqueEmail('reset');
  await registerAndSignIn(page, email);

  await page.goto('/en/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeFocused();
  await expectAccessible(page);

  const link = emailLink(await waitForEmail(email, 'Choose a new password'));
  await page.goto(link);
  await expect(page).toHaveURL(/\/en\/reset-password\?token=\w+$/);
  await expect(
    page.getByRole('heading', { name: 'Choose a new password', level: 1 }),
  ).toBeVisible();

  await page.getByLabel('New password').fill('short');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByLabel('New password')).toHaveAttribute('aria-invalid', 'true');
  await expectAccessible(page);

  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL('/en/reset-password?done=1'); // the spent token leaves the URL
  await expect(page.getByRole('heading', { name: 'Password changed', level: 1 })).toBeVisible();
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page).toHaveTitle(/^Password changed/);
  await expectAccessible(page);

  // Everything signed in before is out, and the owner hears about it.
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  await waitForEmail(email, 'Your password was changed');

  // The link worked once.
  await page.goto(link);
  const dead = page.getByRole('heading', { name: 'This link no longer works', level: 1 });
  await expect(dead).toBeVisible();
  await expect(page).toHaveTitle(/^This link no longer works/);
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();

  await page.goto('/en/sign-in');
  await signIn(page, email);
  await expect(
    page.getByRole('alert').filter({ hasText: 'The email or password is incorrect.' }),
  ).toBeVisible();
  await signIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL('/en/account');
});

test('a Greek account hears from us in Greek, whatever page it asks from', async ({ page }) => {
  readsOutbox();
  const email = uniqueEmail('greek');
  await page.goto('/el/sign-up');
  await page.getByLabel('Όνομα').fill('Μαρία');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Κωδικός πρόσβασης').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Δημιουργία λογαριασμού' }).click();
  await expect(page.getByRole('heading', { name: 'Ελέγξτε τα εισερχόμενά σας' })).toBeFocused();

  await page.goto('/en/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send link' }).click();

  const reset = await waitForEmail(email, 'Επαναφορά κωδικού πρόσβασης');
  await page.goto(emailLink(reset));
  await expect(page).toHaveURL(/\/el\/reset-password\?token=\w+$/);
});

test('asking for a reset carries the typed address over and reveals nothing', async ({ page }) => {
  const nobody = uniqueEmail('nobody');
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(nobody);
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL('/en/forgot-password');
  await expect(page.getByLabel('Email')).toHaveValue(nobody);

  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeFocused();
  await expect(page.getByText(`If there’s an account for ${nobody}`)).toBeVisible();
  await expect(page.getByText('Enter your email')).toBeHidden(); // the instruction went too
});

test('reset requests are limited per visitor', async ({ page }) => {
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) {
    const response = await page.request.post('/api/auth/request-password-reset', {
      headers: { origin: WEB_URL },
      data: { email: uniqueEmail('limited') },
    });
    statuses.push(response.status());
  }
  expect(statuses).toEqual([200, 200, 200, 429]);
});

test('a bad confirmation link says so and offers a new one, in either language', async ({
  page,
}) => {
  await page.goto('/en/verify-email?token=not-a-token');
  await page.getByRole('button', { name: 'Confirm email' }).click();

  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeFocused();
  await expect(page).toHaveTitle(/^This link no longer works/);
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Send link' })).toBeVisible();
  await expectAccessible(page);

  await page
    .getByRole('navigation', { name: 'Language' })
    .getByRole('link', { name: 'Ελληνικά' })
    .click();
  await expect(page).toHaveURL('/el/verify-email?token=not-a-token');
  await expect(page.getByRole('button', { name: 'Επιβεβαίωση email' })).toBeVisible();
});

test('a reset link survives a language switch and stays out of indexes and referrers', async ({
  page,
}) => {
  const response = await page.goto('/el/reset-password?token=abc');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');

  await page
    .getByRole('navigation', { name: 'Γλώσσα' })
    .getByRole('link', { name: 'English' })
    .click();

  await expect(page).toHaveURL('/en/reset-password?token=abc');
  await expect(page.getByLabel('New password')).toBeVisible();
});

test('a reset link that died while the form was open offers a new one', async ({ page }) => {
  const urls: string[] = [];
  const referrers: string[] = [];
  page.on('request', (request) => {
    urls.push(request.url());
    referrers.push(request.headers().referer ?? '');
  });

  await page.goto('/en/reset-password?token=abc');
  await page.getByLabel('New password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Save new password' }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: 'This link has expired or has already been used.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Request a new link' }).click();
  await expect(page).toHaveURL('/en/forgot-password');

  expect(urls.filter((url) => url.includes('horse'))).toEqual([]); // the password stayed in the body
  expect(referrers.filter((referrer) => referrer.includes('token='))).toEqual([]);
});

test('a long address stays on a 320 px screen, in Greek', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/el/forgot-password');
  await page.getByLabel('Email').fill(`${'x'.repeat(60)}@example.com`);
  await page.getByRole('button', { name: 'Αποστολή συνδέσμου' }).click();
  await expect(page.getByRole('heading', { name: 'Ελέγξτε τα εισερχόμενά σας' })).toBeFocused();

  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
});
