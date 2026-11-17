import { randomUUID } from 'node:crypto';

import { type Browser, expect, type Page, test } from '@playwright/test';

import { FIRST_VISIT, measureFirstVisit } from '../support/budgets';
import {
  addBookings,
  HAS_DATABASE,
  makeStaff,
  publishListing,
  unpublishListing,
} from '../support/db';
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
import { listingWithStaff } from '../support/listings';
import { totp } from '../support/totp';

// Feature: moderation (5.2c2, #78–#81): staff take a live listing down (and, if they say so, call
// off what is booked), bring it back, and suspend and reinstate an account. The rules (own listing,
// races, rollback, who is refused) are the API's integration tests; here is the path, what an owner
// and a suspended person meet, and the screens in both languages.

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

/** Staff with a second factor, signed in to the staff app. */
async function staffSession(browser: Browser, next: string) {
  const email = uniqueEmail('moderator');
  const web = await freshPage(browser);
  await registerAndSignIn(web.page, email, 'Moderator Mo');
  const key = await enrolTwoFactor(web.page);
  await makeStaff(email);
  const session = await freshPage(browser);
  await signInToStaffApp(session.page, email, key, next);
  return { ...session, web, email };
}

test('staff suspend a listing and call off its bookings, and bring it back', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const owner = await freshPage(browser);
  const ownerEmail = uniqueEmail('moderated-owner');
  await registerAndSignIn(owner.page, ownerEmail, 'Moderated Owner');
  const listing = await listingWithStaff(
    owner.page,
    `Γκαράζ αναστολής ${randomUUID().slice(0, 6)}`,
  );
  await publishListing(listing.id);
  await addBookings(listing.id, 2);
  const live = () => owner.page.request.get(`${WEB_URL}/api/v1/parking/${listing.slug}`);
  expect((await live()).status()).toBe(200);

  const {
    context,
    page: staff,
    web,
    email: staffEmail,
  } = await staffSession(browser, `/listings/${listing.id}`);
  const csp = await trackCspViolations(staff);
  try {
    await expect(
      staff.getByRole('heading', { level: 2, name: 'Take it down or bring it back' }),
    ).toBeVisible();
    await expectAccessible(staff);

    // What the page costs a first visit, with its moderation panel and checkbox, in a browser that
    // has cached nothing.
    const cold = await browser.newContext({
      storageState: await context.storageState(),
      extraHTTPHeaders: { 'x-forwarded-for': visitorAddress() },
    });
    const { javascriptBytes, requests } = await measureFirstVisit(
      await cold.newPage(),
      admin(`/en/listings/${listing.id}`),
    );
    await cold.close();
    test.info().annotations.push({
      type: 'measurement',
      description: `a live listing's review: ${Math.round(javascriptBytes / 1024)} KiB JS, ${requests} requests`,
    });
    expect(javascriptBytes).toBeLessThan(FIRST_VISIT.javascriptBytes);
    expect(requests).toBeLessThan(FIRST_VISIT.requests);

    // The note comes first, in words, and the bookings are a choice made each time.
    await staff.getByRole('button', { name: 'Suspend this listing…' }).click();
    const note = staff.getByLabel(/Why is it suspended/);
    await expect(note).toBeFocused();
    await expect(note).toHaveAttribute('aria-invalid', 'true');
    const why = `The deed shows another owner (${randomUUID().slice(0, 6)}).`;
    await note.fill(why);
    const cancel = staff.getByRole('checkbox', { name: 'Also cancel its 2 upcoming bookings' });
    await expect(cancel).not.toBeChecked();
    await cancel.check();
    await staff.getByRole('button', { name: 'Suspend this listing…' }).click();
    const question = staff.getByText(
      'Suspend this listing and cancel its 2 upcoming bookings now? The drivers are refunded in full.',
    );
    await expect(question).toBeFocused();
    await expectAccessible(staff);
    await staff.getByRole('button', { name: 'Not yet' }).click();
    await expect(note).toBeFocused();
    await expect(note).toHaveValue(why);
    await staff.getByRole('button', { name: 'Suspend this listing…' }).click();
    await staff.getByRole('button', { name: 'Yes, suspend it' }).click();
    await expect(staff.getByRole('heading', { name: 'Listing suspended' })).toBeFocused();

    // Off the site, bookings called off with the refund owed, a second suspension refused.
    expect((await live()).status()).toBe(404);
    await staff.reload();
    await expect(staff.getByText('Suspended').first()).toBeVisible();
    await expect(staff.getByText(why)).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Reinstate this listing…' })).toBeVisible();
    const again = await staff.request.post(admin(`/api/v1/admin/listings/${listing.id}/suspend`), {
      headers: { origin: ADMIN_URL as string },
      data: { note: why, cancelBookings: true },
    });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'NOT_PUBLISHED' });

    // Its owner reads why where they read what staff asked for, and is emailed.
    await owner.page.goto('/en/owner');
    await expect(owner.page.getByText('Why this listing is suspended')).toBeVisible();
    await expect(owner.page.getByText(why)).toBeVisible();
    await expectAccessible(owner.page);
    const told = await waitForEmail(ownerEmail, 'Your listing has been suspended', {
      timeout: 120_000,
    });
    expect(told.text).toContain('The reason is on your listing’s page');
    expect(told.text).not.toContain(why);

    // Brought back: live again, the note cleared, the owner told, and the new note is the log's.
    await staff.getByRole('button', { name: 'Reinstate this listing…' }).click();
    await expect(staff.getByLabel(/Why is it reinstated/)).toBeFocused();
    await staff.getByLabel(/Why is it reinstated/).fill('Ticket 4822, deed received.');
    await staff.getByRole('button', { name: 'Reinstate this listing…' }).click();
    await staff.getByRole('button', { name: 'Yes, reinstate it' }).click();
    await expect(staff.getByRole('heading', { name: 'Listing reinstated' })).toBeFocused();
    expect((await live()).status()).toBe(200);
    await owner.page.goto('/en/owner');
    await expect(owner.page.getByText('Why this listing is suspended')).toHaveCount(0);
    await waitForEmail(ownerEmail, 'Your listing is live again', { timeout: 120_000 });

    // The log has both, in the staff member's name, with the choice about bookings.
    // Through the filter: the log is shared with every other spec and shows 25 lines a page.
    await staff.goto(admin('/en/audit?action=listing.suspended'));
    const log = staff.getByRole('table', { name: 'Audit log' });
    const suspended = log.getByRole('row', { name: /Listing suspended/ }).first();
    await expect(suspended).toContainText(staffEmail);
    await expect(suspended).toContainText(why);
    await expect(suspended).toContainText('Bookings cancelled2');
    await staff.goto(admin('/en/audit?action=listing.reinstated'));
    await expect(log.getByRole('row', { name: /Listing reinstated/ }).first()).toContainText(
      'Ticket 4822, deed received.',
    );
    await expectAccessible(staff);

    // Greek, on a phone: the review with its moderation section stays inside the screen.
    await staff.setViewportSize({ width: 320, height: 800 });
    await staff.goto(admin(`/el/listings/${listing.id}`));
    await expect(
      staff.getByRole('heading', { level: 2, name: 'Αναστολή ή άρση αναστολής' }),
    ).toBeVisible();
    await staff.getByRole('button', { name: 'Αναστολή του χώρου…' }).click();
    const sideways = await staff.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sideways).toBeLessThanOrEqual(0);
    await expectAccessible(staff);
    expect(await csp()).toEqual([]);
  } finally {
    await context.close();
    await web.context.close();
    await owner.context.close();
    await unpublishListing(listing.id);
  }
});

test('staff suspend an account: it can’t sign in, is told nothing of why, and is let back in', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const personEmail = uniqueEmail('suspended-person');
  const person = await freshPage(browser);
  await registerAndSignIn(person.page, personEmail, 'Person Suspended');
  expect((await person.page.request.get(`${WEB_URL}/api/v1/me`)).status()).toBe(200);

  const { context, page: staff, web, email: staffEmail } = await staffSession(browser, '/users');
  try {
    await staff.getByLabel('Email address').fill(personEmail);
    await staff.getByRole('button', { name: 'Find the account' }).click();
    await expect(staff).toHaveURL(/\/en\/users\/[0-9a-f-]{36}$/);
    const accountId = staff.url().split('/').pop() as string;
    await expect(
      staff.getByText('Account status').locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('Active');
    await expect(staff.getByRole('heading', { level: 2, name: 'Suspension' })).toBeVisible();
    await expectAccessible(staff);

    await staff.getByRole('button', { name: 'Suspend this account…' }).click();
    const note = staff.getByLabel(/Why\? \(for the audit log only\)/);
    await expect(note).toBeFocused();
    const reason = `Ticket ${randomUUID().slice(0, 6)}, chargebacks.`;
    await note.fill(reason);
    await staff.getByRole('button', { name: 'Suspend this account…' }).click();
    await expect(staff.getByText(/Suspend this account now\?/)).toBeFocused();
    await staff.getByRole('button', { name: 'Yes, suspend it' }).click();
    await expect(staff.getByRole('heading', { name: 'Account suspended' })).toBeFocused();

    // The person is out everywhere, and the sign-in page says so, after the password is right.
    expect((await person.page.request.get(`${WEB_URL}/api/v1/me`)).status()).toBe(401);
    const other = await freshPage(browser);
    try {
      await other.page.goto('/en/sign-in');
      await other.page.getByLabel('Email').fill(personEmail);
      await other.page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
      await other.page.getByRole('button', { name: 'Sign in' }).click();
      await expect(
        other.page.getByRole('alert').filter({ hasText: 'This account has been suspended' }),
      ).toBeVisible();
      await expectAccessible(other.page);
      // A wrong password gets the ordinary answer: nothing is learned of the suspension.
      await other.page.getByLabel('Password', { exact: true }).fill('not the password at all');
      await other.page.getByRole('button', { name: 'Sign in' }).click();
      await expect(
        other.page.getByRole('alert').filter({ hasText: 'The email or password is incorrect' }),
      ).toBeVisible();
    } finally {
      await other.context.close();
    }
    const told = await waitForEmail(personEmail, 'Your Parkfairy account has been suspended', {
      timeout: 120_000,
    });
    expect(told.text).toContain('signed out on every device');
    expect(told.text).not.toContain(reason);

    // Lifted: the same password signs in again, and the person is told.
    await staff.reload();
    await expect(staff.getByText('Suspended').first()).toBeVisible();
    await staff.getByRole('button', { name: 'Reinstate this account…' }).click();
    await staff.getByLabel(/Why is it reinstated/).fill('Ticket 4823, resolved.');
    await staff.getByRole('button', { name: 'Reinstate this account…' }).click();
    await staff.getByRole('button', { name: 'Yes, reinstate it' }).click();
    await expect(staff.getByRole('heading', { name: 'Account reinstated' })).toBeFocused();
    const back = await freshPage(browser);
    try {
      await back.page.goto('/en/sign-in');
      await back.page.getByLabel('Email').fill(personEmail);
      await back.page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
      await back.page.getByRole('button', { name: 'Sign in' }).click();
      await expect(back.page).not.toHaveURL(/sign-in/);
    } finally {
      await back.context.close();
    }
    await waitForEmail(personEmail, 'Your Parkfairy account is active again', { timeout: 120_000 });

    // The log has both, the reason in the first, and the account page opened.
    await staff.goto(admin('/en/audit?action=user.suspended'));
    const log = staff.getByRole('table', { name: 'Audit log' });
    const row = log.getByRole('row', { name: /Account suspended/ }).first();
    await expect(row).toContainText(staffEmail);
    await expect(row).toContainText(reason);
    await expect(row.getByRole('link', { name: 'Open the account' })).toHaveAttribute(
      'href',
      `/en/users/${accountId}`,
    );
    await staff.goto(admin('/en/audit?action=user.reinstated'));
    await expect(log.getByRole('row', { name: /Account reinstated/ }).first()).toBeVisible();

    // Greek, on a phone.
    await staff.setViewportSize({ width: 320, height: 800 });
    await staff.goto(admin(`/el/users/${accountId}`));
    await expect(staff.getByRole('heading', { level: 2, name: 'Αναστολή' })).toBeVisible();
    const sideways = await staff.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sideways).toBeLessThanOrEqual(0);
    await expectAccessible(staff);
  } finally {
    await context.close();
    await web.context.close();
    await person.context.close();
  }
});

test('the moderation routes are not for an ordinary account', async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  try {
    await registerAndSignIn(page, uniqueEmail('not-staff-moderation'), 'Not Staff');
    for (const path of [
      `/api/v1/admin/listings/${randomUUID()}/suspend`,
      `/api/v1/admin/listings/${randomUUID()}/reinstate`,
      `/api/v1/admin/users/${randomUUID()}/suspend`,
      `/api/v1/admin/users/${randomUUID()}/reinstate`,
    ]) {
      const answer = await page.request.post(`${WEB_URL}${path}`, {
        headers: { origin: WEB_URL },
        data: { note: 'x', cancelBookings: false },
      });
      expect(answer.status(), path).toBe(403);
    }
  } finally {
    await context.close();
  }
});
