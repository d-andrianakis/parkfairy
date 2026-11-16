import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { FIRST_VISIT, measureFirstVisit } from '../support/budgets';
import { HAS_DATABASE, makeStaff } from '../support/db';
import { waitForEmail } from '../support/email';
import { ADMIN_URL, EMAIL_OUTBOX, TEST_PASSWORD, visitorAddress, WEB_URL } from '../support/env';
import {
  enrolTwoFactor,
  expectAccessible,
  ownVisitor,
  registerAndSignIn,
  trackCspViolations,
  uniqueEmail,
} from '../support/fixtures';
import { totp } from '../support/totp';

// Feature: support's way into an account (5.2c, #13): find a person by their whole address, remove
// their two-factor authentication after an identity check, and see it in the audit log. The rules
// (not on staff, not on yourself, once only) are the API's integration tests; here is the path.

test.skip(!ADMIN_URL, 'The staff app is only reachable on a local run');
test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
test.skip(!HAS_DATABASE, 'Making staff is done by hand');
test.use(ownVisitor);

const admin = (path: string) => `${ADMIN_URL}${path}`;

/** A browser of its own at an address of its own, signed out: cookies of `localhost` are shared. */
async function freshPage(browser: Browser) {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': visitorAddress() },
    storageState: { cookies: [], origins: [] },
  });
  return { context, page: await context.newPage() };
}

async function signInToStaffApp(page: Page, email: string, key: string, next: string) {
  await page.goto(admin(`/en/sign-in?next=${encodeURIComponent(next)}`));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Authentication code').fill(totp(key));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(admin(`/en${next}`));
}

test('support finds an account by its address and removes its two-factor authentication', async ({
  browser,
}) => {
  test.setTimeout(240_000);

  // A person who lost their phone: an account with two-factor on, and a session of its own.
  const personEmail = uniqueEmail('lost-phone');
  const personContext = await freshPage(browser);
  const person = personContext.page;
  await registerAndSignIn(person, personEmail, 'Person Lost Phone');
  await enrolTwoFactor(person);
  expect((await person.request.get(`${WEB_URL}/api/v1/me`)).status()).toBe(200);

  // Support: staff with a second factor of their own.
  const staffEmail = uniqueEmail('support');
  const staffWeb = await freshPage(browser);
  await registerAndSignIn(staffWeb.page, staffEmail, 'Support Sam');
  const key = await enrolTwoFactor(staffWeb.page);
  await makeStaff(staffEmail);

  const { context, page: staff } = await freshPage(browser);
  const csp = await trackCspViolations(staff);
  try {
    await signInToStaffApp(staff, staffEmail, key, '/users');
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Accounts');
    await expect(staff).toHaveTitle(/^Accounts/);
    await expect(staff.getByRole('link', { name: 'Accounts', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectAccessible(staff);

    // Not an address, and an address nobody has: each in words, and never a list.
    const address = staff.getByLabel('Email address');
    await staff.getByRole('button', { name: 'Find the account' }).click();
    await expect(address).toBeFocused();
    await expect(address).toHaveAttribute('aria-invalid', 'true');
    await address.fill('person');
    await staff.getByRole('button', { name: 'Find the account' }).click();
    await expect(address).toHaveAttribute('aria-invalid', 'true');
    await address.fill(`nobody-${randomUUID()}@example.com`);
    await staff.getByRole('button', { name: 'Find the account' }).click();
    // Said at the field, which takes the focus.
    await expect(address).toBeFocused();
    await expect(address).toHaveAccessibleDescription(/No account has this address\./);
    await expect(staff.getByRole('table')).toHaveCount(0);

    // The address travels in a body: it is in no URL of the page.
    await address.fill(personEmail.toUpperCase());
    await staff.getByRole('button', { name: 'Find the account' }).click();
    await expect(staff).toHaveURL(/\/en\/users\/[0-9a-f-]{36}$/);
    expect(staff.url()).not.toContain('example.com');
    const accountId = staff.url().split('/').pop() as string;
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Person Lost Phone');
    await expect(staff.getByText(personEmail)).toBeVisible();
    await expect(staff.getByText('Two-factor authentication', { exact: true })).toBeVisible();
    await expect(staff.getByText('On', { exact: true })).toBeVisible();
    await expectAccessible(staff);

    // The lookup is a POST, and nothing lists accounts.
    expect((await staff.request.get(admin('/api/v1/admin/users'))).status()).toBe(404);
    expect(
      (await staff.request.get(admin(`/api/v1/admin/users/lookup?email=${personEmail}`))).status(),
    ).toBeGreaterThanOrEqual(400);

    // Greek, on a phone, with two-factor on: its long buttons wrap, and nothing pushes the page
    // sideways, on the form and on the question after it.
    await staff.setViewportSize({ width: 320, height: 800 });
    await staff.goto(admin(`/el/users/${accountId}`));
    const widest = () =>
      staff.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await widest()).toBeLessThanOrEqual(0);
    await staff.getByRole('button', { name: /Αφαίρεση ελέγχου ταυτότητας δύο παραγόντων/ }).click();
    await staff.getByLabel(/Πώς ελέγξατε/).fill('Αίτημα 4821.');
    await staff.getByRole('button', { name: /Αφαίρεση ελέγχου ταυτότητας δύο παραγόντων/ }).click();
    await expect(staff.getByText(/Να αφαιρεθεί τώρα ο έλεγχος ταυτότητας/)).toBeFocused();
    expect(await widest()).toBeLessThanOrEqual(0);
    await expectAccessible(staff);
    await staff.setViewportSize({ width: 1280, height: 720 });
    await staff.goto(admin(`/en/users/${accountId}`));
    // Opening the page is a line in the log.
    // Removing it takes a note of how the person was identified, then one more question.
    const remove = staff.getByRole('button', { name: 'Remove two-factor authentication…' });
    await remove.click();
    const note = staff.getByLabel('How did you check who they are?');
    await expect(note).toBeFocused();
    await expect(note).toHaveAttribute('aria-invalid', 'true');
    const check = `Video call and ID, ticket ${randomUUID().slice(0, 6)}.`;
    await note.fill(check);
    await remove.click();
    const question = staff.getByText(/Remove two-factor authentication from this account now/);
    await expect(question).toBeFocused();
    await expectAccessible(staff);
    await staff.getByRole('button', { name: 'Not yet' }).click();
    await expect(note).toBeFocused();
    await expect(note).toHaveValue(check);
    await remove.click();
    await staff.getByRole('button', { name: 'Yes, remove it' }).click();
    await expect(
      staff.getByRole('heading', { name: 'Two-factor authentication removed' }),
    ).toBeFocused();

    // It is off, the person is signed out everywhere, their old password opens nothing, and their
    // address was told.
    const old = await person.request.post(`${WEB_URL}/api/auth/sign-in/email`, {
      headers: { origin: WEB_URL },
      data: { email: personEmail, password: TEST_PASSWORD },
    });
    expect(old.status()).toBeGreaterThanOrEqual(400);
    await staff.reload();
    await expect(staff.getByText('Off', { exact: true })).toBeVisible();
    await expect(staff.getByRole('note')).toContainText('has no two-factor authentication');
    await expect(staff.getByRole('button', { name: /Remove two-factor/ })).toHaveCount(0);
    expect((await person.request.get(`${WEB_URL}/api/v1/me`)).status()).toBe(401);
    // A second removal is refused by the API, whoever asks.
    const again = await staff.request.post(
      admin(`/api/v1/admin/users/${accountId}/remove-two-factor`),
      { headers: { origin: ADMIN_URL as string }, data: { note: check } },
    );
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'NO_TWO_FACTOR' });
    // …and so is a write from another site.
    const foreign = await staff.request.post(
      admin(`/api/v1/admin/users/${accountId}/remove-two-factor`),
      { headers: { origin: 'https://evil.example' }, data: { note: check } },
    );
    expect(foreign.status()).toBe(403);

    // The worker sends it on its next run; it says what happened and what to do if it wasn't them.
    const mail = await waitForEmail(
      personEmail,
      'Two-factor authentication was removed from your Parkfairy account',
      { timeout: 120_000 },
    );
    expect(mail.text).toContain('your password was cancelled too');
    expect(mail.text).toContain('/en/forgot-password');
    expect(mail.text).not.toContain(check);

    // The log has it, in the staff member's name, with the note and a link back to the account.
    await staff.goto(admin('/en/audit'));
    const log = staff.getByRole('table', { name: 'Audit log' });
    const row = log.getByRole('row', { name: /Two-factor authentication removed from an account/ });
    await expect(row.first()).toContainText(staffEmail);
    await expect(row.first()).toContainText(check);
    await expect(row.first()).toContainText('Password cancelled');
    await expect(log.getByRole('row', { name: /Account page opened/ }).first()).toContainText(
      staffEmail,
    );
    await expect(row.first().getByRole('link', { name: 'Open the account' })).toHaveAttribute(
      'href',
      `/en/users/${accountId}`,
    );
    await expectAccessible(staff);

    // What the two pages cost a first visit, in a browser of its own that has cached nothing.
    const state = await context.storageState();
    for (const path of ['/en/users', `/en/users/${accountId}`]) {
      const cold = await browser.newContext({
        storageState: state,
        extraHTTPHeaders: { 'x-forwarded-for': visitorAddress() },
      });
      const { javascriptBytes, requests } = await measureFirstVisit(
        await cold.newPage(),
        admin(path),
      );
      await cold.close();
      test.info().annotations.push({
        type: 'measurement',
        description: `${path}: ${Math.round(javascriptBytes / 1024)} KiB JS, ${requests} requests`,
      });
      expect(javascriptBytes, path).toBeLessThan(FIRST_VISIT.javascriptBytes);
      expect(requests, path).toBeLessThan(FIRST_VISIT.requests);
    }

    // Staff's own account offers no removal, and says why.
    await staff.goto(admin('/en/users'));
    await staff.getByLabel('Email address').fill(staffEmail);
    await staff.getByRole('button', { name: 'Find the account' }).click();
    await expect(staff.getByRole('region', { name: 'Security' }).getByRole('note')).toContainText(
      'your own account',
    );
    await expect(staff.getByRole('region', { name: 'Suspension' }).getByRole('note')).toContainText(
      'your own account',
    );
    await expect(staff.getByRole('button', { name: /Suspend this account/ })).toHaveCount(0);
    await expect(staff.getByRole('button', { name: /Remove two-factor/ })).toHaveCount(0);

    // Greek, on a phone: the lookup and an account stay inside the screen.
    await staff.setViewportSize({ width: 320, height: 800 });
    for (const path of ['/el/users', `/el/users/${accountId}`]) {
      await staff.goto(admin(path));
      await expect(staff.locator('html')).toHaveAttribute('lang', 'el');
      const sideways = await staff.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways, path).toBeLessThanOrEqual(0);
      await expectAccessible(staff);
    }
    await staff.goto(admin('/el/users'));
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Λογαριασμοί');

    expect(await csp()).toEqual([]);
  } finally {
    await context.close();
    await staffWeb.context.close();
    await personContext.context.close();
  }
});

test('the staff routes for accounts are not for an ordinary account', async ({ browser }) => {
  const email = uniqueEmail('not-staff-users');
  const { context, page } = await freshPage(browser);
  try {
    await registerAndSignIn(page, email, 'Not Staff');
    for (const [method, path] of [
      ['post', '/api/v1/admin/users/lookup'],
      ['get', `/api/v1/admin/users/${randomUUID()}`],
      ['post', `/api/v1/admin/users/${randomUUID()}/remove-two-factor`],
    ] as const) {
      const answer = await page.request[method](`${WEB_URL}${path}`, {
        headers: { origin: WEB_URL },
        data: method === 'post' ? { email, note: 'x' } : undefined,
      });
      expect(answer.status(), `${method} ${path}`).toBe(403);
    }
  } finally {
    await context.close();
  }
});
