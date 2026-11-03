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
  const refused = page.getByRole('alert').filter({ hasText: 'If you’ve just signed up' });
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

test('signing in says nothing about whether an address is free', async ({ page }) => {
  readsOutbox();
  // The attack: sign up, then sign in with the password just chosen.
  const signUpWith = (email: string, password: string) =>
    page.request.post('/api/auth/sign-up/email', {
      headers: { origin: WEB_URL },
      data: { name: 'Stranger', email, password },
    });
  const signInWith = (email: string, password: string) =>
    page.request.post('/api/auth/sign-in/email', {
      headers: { origin: WEB_URL },
      data: { email, password },
    });
  const free = uniqueEmail('free');
  const taken = uniqueEmail('taken');
  expect((await signUpWith(taken, TEST_PASSWORD)).status()).toBe(200);

  expect((await signUpWith(free, NEW_PASSWORD)).status()).toBe(200);
  expect((await signUpWith(taken, NEW_PASSWORD)).status()).toBe(200);
  const fresh = await signInWith(free, NEW_PASSWORD);
  const refused = await signInWith(taken, NEW_PASSWORD);

  expect(fresh.status()).toBe(401);
  expect(refused.status()).toBe(401);
  expect(await fresh.json()).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' });
  expect(await fresh.text()).toBe(await refused.text());
});

test('reset requests are held to a floor through the real route', async ({ page }) => {
  const started = Date.now();
  const response = await page.request.post('/api/auth/request-password-reset', {
    headers: { origin: WEB_URL },
    data: { email: uniqueEmail('floor') },
  });
  expect(response.status()).toBe(200);
  expect(Date.now() - started).toBeGreaterThanOrEqual(240); // the network only adds to it
});

test('the check-your-inbox panel stays through a language switch and a reload', async ({
  page,
}) => {
  readsOutbox();
  const email = uniqueEmail('panel');
  await signUp(page, email);
  await expect(page).toHaveURL('/en/sign-up?sent=1'); // the address stays out of it

  await page
    .getByRole('navigation', { name: 'Language' })
    .getByRole('link', { name: 'Ελληνικά' })
    .click();

  await expect(page).toHaveURL('/el/sign-up?sent=1');
  await expect(page.getByRole('heading', { name: 'Ελέγξτε τα εισερχόμενά σας' })).toBeFocused();
  await expect(page).toHaveTitle(/^Ελέγξτε τα εισερχόμενά σας/);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Αποστολή ξανά' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeHidden();
  await expectAccessible(page);

  await page.reload();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page).toHaveTitle(/^Ελέγξτε τα εισερχόμενά σας/);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expectAccessible(page);
  await page.emulateMedia({ colorScheme: 'light' });

  // The header's link is the way back, say after a mistyped address.
  await page.getByRole('banner').getByRole('link', { name: 'Δημιουργία λογαριασμού' }).click();
  await expect(page).toHaveURL('/el/sign-up');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page).not.toHaveTitle(/^Ελέγξτε τα εισερχόμενά σας/);
  await expect(page.locator('#main-content')).toBeFocused();
});

test('going back to the form right after sending works, without a reload', async ({ page }) => {
  readsOutbox();
  await signUp(page, uniqueEmail('mistyped'));

  await page.getByRole('banner').getByRole('link', { name: 'Create account' }).click();

  await expect(page).toHaveURL('/en/sign-up');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page).not.toHaveTitle(/^Check your inbox/);
  await expect(page.locator('#main-content')).toBeFocused();
});

test('someone typing before the page hydrates keeps the field', async ({ page }) => {
  // The page's scripts wait until the field is in use; replacing the input would then drop it.
  let release = () => {};
  const typed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await typed;
    await route.continue();
  });
  await page.goto('/en/sign-in', { waitUntil: 'commit' });
  const password = page.getByLabel('Password', { exact: true });
  await password.focus();
  await password.pressSequentially('horse');
  await expect(page.getByRole('button', { name: 'Show password' })).toBeHidden();

  release();
  await expect(page.getByRole('button', { name: 'Show password' })).toBeVisible();

  await expect(password).toBeFocused();
  await password.pressSequentially('staple');
  await expect(password).toHaveValue('horsestaple');
});

test('a panel restored during a slow load leaves the focus where someone moved it', async ({
  page,
}) => {
  const address = 'maria@example.gr';
  await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [
    'parkfairy.sent-to:/forgot-password',
    address,
  ] as const);
  let release = () => {};
  const movedOn = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await movedOn;
    await route.continue();
  });
  await page.goto('/en/forgot-password?sent=1', { waitUntil: 'commit' });
  const signIn = page.getByRole('banner').getByRole('link', { name: 'Sign in' });
  await signIn.focus();
  await expect(page.getByText(address)).toBeHidden(); // the panel has to come after the move

  release();
  await expect(page.getByText(address)).toBeVisible();

  await expect(signIn).toBeFocused();
});

test('a panel after a slow request leaves the focus where someone moved it', async ({ page }) => {
  let release = () => {};
  const movedOn = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/request-password-reset', async (route) => {
    await movedOn;
    await route.continue();
  });
  await page.goto('/en/forgot-password');
  await page.getByLabel('Email').fill(uniqueEmail('slow-request'));
  await page.getByRole('button', { name: 'Send link' }).click();
  const signIn = page.getByRole('banner').getByRole('link', { name: 'Sign in' });
  await signIn.focus();
  const heading = page.getByRole('heading', { name: 'Check your inbox' });
  await expect(heading).toBeHidden();

  release();
  await expect(heading).toBeVisible();

  await expect(signIn).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Check your inbox' })).toBeAttached();
  await expect(page).toHaveTitle(/^Check your inbox/); // here only the panel can rename the tab
});

test('a dead confirmation link’s panel stays through a language switch and a reload', async ({
  page,
}) => {
  const email = uniqueEmail('dead-link');
  await page.goto('/en/verify-email?token=not-a-token');
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send link' }).click();
  // The URL first: the focus has to survive that change, not just arrive before it.
  await expect(page).toHaveURL('/en/verify-email?sent=1');
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeFocused();

  await page
    .getByRole('navigation', { name: 'Language' })
    .getByRole('link', { name: 'Ελληνικά' })
    .click();

  await expect(page).toHaveURL('/el/verify-email?sent=1');
  await expect(page.getByRole('heading', { name: 'Ελέγξτε τα εισερχόμενά σας' })).toBeFocused();
  await expect(page).toHaveTitle(/^Ελέγξτε τα εισερχόμενά σας/);
  await expect(page.getByText(email)).toBeVisible();

  await page.reload();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page).toHaveTitle(/^Ελέγξτε τα εισερχόμενά σας/);
});

test('a copied check-your-inbox link opens the form', async ({ page }) => {
  await page.goto('/en/forgot-password?sent=1');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page).toHaveURL('/en/forgot-password');
  await expect(page).toHaveTitle(/^Forgot your password/);
});

test('the confirmation panel stays out of search indexes too', async ({ page }) => {
  await page.goto('/en/verify-email?sent=1');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
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

  await page
    .getByRole('navigation', { name: 'Language' })
    .getByRole('link', { name: 'Ελληνικά' })
    .click();
  await expect(page).toHaveURL('/el/forgot-password?sent=1');
  await expect(page.getByText(`Αν υπάρχει λογαριασμός με τη διεύθυνση ${nobody}`)).toBeVisible();
  await expect(page).toHaveTitle(/^Ελέγξτε τα εισερχόμενά σας/);

  await page.reload();
  await expect(page.getByText(`Αν υπάρχει λογαριασμός με τη διεύθυνση ${nobody}`)).toBeVisible();
  await expect(page).toHaveTitle(/^Ελέγξτε τα εισερχόμενά σας/);
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
