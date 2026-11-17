import { randomUUID } from 'node:crypto';

import { type Browser, expect, type Page, test } from '@playwright/test';

import { FIRST_VISIT, measureFirstVisit } from '../support/budgets';
import {
  addBookings,
  bookingsOf,
  failRefund,
  HAS_DATABASE,
  loseDispute,
  makeStaff,
  moneyOf,
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

// Feature: support and money (5.2c3, #82–#85): a booking found by its reference and called off with
// a full refund, a refund that failed asked again or settled, and a lost dispute decided either way,
// each with its note in the audit log. The rules (races, rollback, who is refused) are the API's
// integration tests; here is the path, what an owner is told, and the screens in both languages.

test.skip(!ADMIN_URL, 'The staff app is only reachable on a local run');
test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
test.skip(!HAS_DATABASE, 'Making staff is done by hand');
test.use(ownVisitor);

const admin = (path: string) => `${ADMIN_URL}${path}`;

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

async function staffSession(browser: Browser, next: string) {
  const email = uniqueEmail('money-staff');
  const web = await freshPage(browser);
  await registerAndSignIn(web.page, email, 'Money Mo');
  const key = await enrolTwoFactor(web.page);
  await makeStaff(email);
  const session = await freshPage(browser);
  await signInToStaffApp(session.page, email, key, next);
  return { ...session, web, email };
}

/** An owner with a live listing and `count` upcoming bookings, as the owner's own (the API refuses that, so they go in by hand). */
async function listingWithBookings(browser: Browser, count: number) {
  const owner = await freshPage(browser);
  const ownerEmail = uniqueEmail('money-owner');
  await registerAndSignIn(owner.page, ownerEmail, 'Money Owner');
  const name = `Γκαράζ χρημάτων ${randomUUID().slice(0, 6)}`;
  const listing = await listingWithStaff(owner.page, name);
  await publishListing(listing.id);
  await addBookings(listing.id, count);
  return { owner, ownerEmail, name, listing, bookings: await bookingsOf(listing.id) };
}

test('support finds a booking by its reference and calls it off with a full refund', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const { owner, ownerEmail, name, listing, bookings } = await listingWithBookings(browser, 2);
  const [target, other] = bookings;
  const { context, page: staff, web, email: staffEmail } = await staffSession(browser, '/bookings');
  const csp = await trackCspViolations(staff);
  try {
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Bookings');
    await expectAccessible(staff);

    // A reference that is not one, then one nobody has, then the real one: in a body, never a URL.
    const field = staff.getByLabel('Booking reference');
    await staff.getByRole('button', { name: 'Find the booking' }).click();
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await field.fill('ZZZZ-ZZZZ');
    await staff.getByRole('button', { name: 'Find the booking' }).click();
    await expect(field).toHaveAccessibleDescription(/No booking has this reference/);
    await field.fill((target?.reference ?? '').toLowerCase());
    await staff.getByRole('button', { name: 'Find the booking' }).click();
    await expect(staff).toHaveURL(/\/en\/bookings\/[0-9a-f-]{36}$/);
    expect(staff.url()).not.toContain(target?.reference ?? 'x');

    // What was booked, by whom, and where its money stands.
    await expect(staff.getByRole('heading', { level: 1 })).toContainText(target?.reference ?? '');
    await expect(staff.getByText('Confirmed', { exact: true })).toBeVisible();
    await expect(staff.getByText('IKB1234')).toBeVisible();
    await expect(staff.getByText(ownerEmail)).toBeVisible();
    await expect(staff.getByText('€4.00').first()).toBeVisible();
    await expectAccessible(staff);

    // What the page costs a first visit, with its panels, in a browser that has cached nothing.
    const cold = await browser.newContext({
      storageState: await context.storageState(),
      extraHTTPHeaders: { 'x-forwarded-for': visitorAddress() },
    });
    const { javascriptBytes, requests } = await measureFirstVisit(
      await cold.newPage(),
      staff.url(),
    );
    await cold.close();
    test.info().annotations.push({
      type: 'measurement',
      description: `a booking: ${Math.round(javascriptBytes / 1024)} KiB JS, ${requests} requests`,
    });
    expect(javascriptBytes).toBeLessThan(FIRST_VISIT.javascriptBytes);
    expect(requests).toBeLessThan(FIRST_VISIT.requests);

    // Calling it off: a note, then one more question that names the refund.
    const start = staff.getByRole('button', { name: 'Cancel this booking…' });
    await start.click();
    const note = staff.getByLabel(/Why\?/);
    await expect(note).toBeFocused();
    await expect(note).toHaveAttribute('aria-invalid', 'true');
    const why = `Ticket ${randomUUID().slice(0, 6)}, driver called.`;
    await note.fill(why);
    await start.click();
    await expect(
      staff.getByText('Cancel this booking now? The driver is refunded in full: €4.00.'),
    ).toBeFocused();
    await staff.getByRole('button', { name: 'Not yet' }).click();
    await expect(note).toBeFocused();
    await expect(note).toHaveValue(why);
    await start.click();
    await staff.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(staff.getByRole('heading', { name: 'Booking cancelled' })).toBeFocused();

    // Cancelled, the refund owed in full (unpaid in this run: nothing to send), the other booking untouched.
    expect((await moneyOf(target?.id ?? '')).status).toBe('cancelled');
    expect((await moneyOf(other?.id ?? '')).status).toBe('confirmed');
    await staff.reload();
    await expect(staff.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Cancel this booking…' })).toHaveCount(0);
    // Asked again, the API says it is done.
    const again = await staff.request.post(admin(`/api/v1/admin/bookings/${target?.id}/cancel`), {
      headers: { origin: ADMIN_URL as string },
      data: { note: why },
    });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'NOT_CANCELLABLE' });

    // The owner is told (and, being the driver of these bookings in this run, hears of it too).
    const told = await waitForEmail(ownerEmail, `Support cancelled a booking for “${name}”`, {
      timeout: 120_000,
    });
    expect(told.text).toContain('You won’t receive a share of this booking');
    expect(told.text).not.toMatch(/IKB1234|Money Owner/);

    // The log has it, with the reference and the note; opening the booking is a line too.
    // Through the filter: the log is shared with every other spec and shows 25 lines a page.
    await staff.goto(admin('/en/audit?action=booking.cancelled'));
    const log = staff.getByRole('table', { name: 'Audit log' });
    const row = log.getByRole('row', { name: /Booking cancelled/ }).first();
    await expect(row).toContainText(staffEmail);
    await expect(row).toContainText(why);
    await expect(row).toContainText(target?.reference ?? '');
    await expect(row.getByRole('link', { name: 'Open the booking' })).toHaveAttribute(
      'href',
      `/en/bookings/${target?.id}`,
    );
    await staff.goto(admin('/en/audit?action=booking.viewed'));
    await expect(log.getByRole('row', { name: /Booking opened/ }).first()).toBeVisible();
    await expectAccessible(staff);
    expect(await csp()).toEqual([]);
  } finally {
    await context.close();
    await web.context.close();
    await owner.context.close();
    await unpublishListing(listing.id);
  }
});

test('support asks Stripe again for a failed refund, or settles it, and decides a lost dispute', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const { owner, ownerEmail, listing, bookings } = await listingWithBookings(browser, 3);
  const [failing, forfeited, released] = bookings;
  await failRefund(failing?.id ?? '');
  await loseDispute(forfeited?.id ?? '');
  await loseDispute(released?.id ?? '');
  const { context, page: staff, web } = await staffSession(browser, '/payments');
  try {
    // The payments page has all three, each a way into its booking.
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Payments');
    const lost = staff.getByRole('table', { name: 'Lost disputes waiting for a decision' });
    await expect(lost.getByRole('link', { name: forfeited?.reference ?? '' })).toBeVisible();
    await expect(
      staff.getByRole('table', { name: 'Refunds that failed' }).getByRole('link', {
        name: failing?.reference ?? '',
      }),
    ).toBeVisible();
    await expectAccessible(staff);

    // A failed refund: asked again under a new attempt, which the page then counts.
    await staff.goto(admin(`/en/bookings/${failing?.id}`));
    await expect(staff.getByText(/Failed at Stripe/)).toBeVisible();
    await staff.getByLabel(/Why try again/).fill('Ticket 4821, card reissued.');
    await staff.getByRole('button', { name: 'Ask again…' }).click();
    await expect(staff.getByText(/Ask Stripe to refund €4\.00 again now\?/)).toBeFocused();
    await staff.getByRole('button', { name: 'Yes, ask again' }).click();
    await expect(staff.getByRole('heading', { name: 'Refund requested' })).toBeFocused();
    expect(await moneyOf(failing?.id ?? '')).toMatchObject({ refundStatus: 'owed', attempts: 1 });
    await staff.reload();
    await expect(staff.getByText(/Owed, not sent yet · €4\.00, asked again once/)).toBeVisible();
    // Failing again, it is settled by hand instead.
    await failRefund(failing?.id ?? '');
    await staff.reload();
    await staff.getByLabel(/How was the driver paid/).fill('Paid by bank transfer.');
    await staff.getByRole('button', { name: 'Mark as settled…' }).click();
    await staff.getByRole('button', { name: 'Yes, it is settled' }).click();
    await expect(staff.getByRole('heading', { name: 'Refund settled' })).toBeFocused();
    expect((await moneyOf(failing?.id ?? '')).refundStatus).toBe('settled');

    // A lost dispute: no note until it is said who bears it; the owners bear this one.
    await staff.goto(admin(`/en/bookings/${forfeited?.id}`));
    await expect(staff.getByText('Waiting for a decision')).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Decide…' })).toHaveCount(0);
    await staff.getByRole('radio', { name: /The owners bear the loss/ }).click();
    await staff.getByLabel(/Why\?/).last().fill('Ticket 4822, evidence refused.');
    await staff.getByRole('button', { name: 'Decide…' }).click();
    await expect(
      staff.getByText('Cancel the owners’ payout for this booking for good? The owners are told.'),
    ).toBeFocused();
    await staff.getByRole('button', { name: 'Yes, decide' }).click();
    await expect(staff.getByRole('heading', { name: 'Decision recorded' })).toBeFocused();
    expect((await moneyOf(forfeited?.id ?? '')).decision).toBe('owners_bear');
    // The other: Parkfairy bears it, and the payout goes on.
    await staff.goto(admin(`/en/bookings/${released?.id}`));
    await staff.getByRole('radio', { name: /Parkfairy bears the loss/ }).click();
    await staff.getByLabel(/Why\?/).last().fill('Ticket 4823, goodwill.');
    await staff.getByRole('button', { name: 'Decide…' }).click();
    await staff.getByRole('button', { name: 'Yes, decide' }).click();
    await expect(staff.getByRole('heading', { name: 'Decision recorded' })).toBeFocused();
    expect((await moneyOf(released?.id ?? '')).decision).toBe('parkfairy_bears');

    // Decided is done: gone from the waiting list, and the owner is told each way.
    await staff.goto(admin('/en/payments'));
    await expect(
      staff
        .getByRole('table', { name: 'Lost disputes waiting for a decision' })
        .getByRole('link', { name: forfeited?.reference ?? '' }),
    ).toHaveCount(0);
    const bad = await waitForEmail(
      ownerEmail,
      `Your share of booking ${forfeited?.reference} will not be sent`,
      { timeout: 120_000 },
    );
    expect(bad.text).toContain('will not be sent');
    await waitForEmail(
      ownerEmail,
      `Your share of booking ${released?.reference} will be sent as usual`,
      { timeout: 120_000 },
    );

    // The log has the three kinds, in the staff member's name.
    const log = staff.getByRole('table', { name: 'Audit log' });
    await staff.goto(admin('/en/audit?action=dispute.decided'));
    await expect(log.getByRole('row', { name: /Lost dispute decided/ }).first()).toContainText(
      'Ticket 4823, goodwill.',
    );
    await staff.goto(admin('/en/audit?action=booking.refund_settled'));
    await expect(log.getByRole('row', { name: /Refund marked settled/ }).first()).toContainText(
      'Paid by bank transfer.',
    );
    await staff.goto(admin('/en/audit?action=booking.refund_retried'));
    await expect(log.getByRole('row', { name: /Refund asked again/ }).first()).toContainText(
      'Attempt1',
    );
    await expectAccessible(staff);

    // Greek, on a phone: the booking with its panels and the payments lists stay inside the screen.
    await staff.setViewportSize({ width: 320, height: 800 });
    for (const path of [
      `/el/bookings/${forfeited?.id}`,
      `/el/bookings/${failing?.id}`,
      '/el/payments',
    ]) {
      await staff.goto(admin(path));
      await expect(staff.locator('html')).toHaveAttribute('lang', 'el');
      const sideways = await staff.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways, path).toBeLessThanOrEqual(0);
      await expectAccessible(staff);
    }
  } finally {
    await context.close();
    await web.context.close();
    await owner.context.close();
    await unpublishListing(listing.id);
  }
});

test('the money routes are not for an ordinary account', async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  try {
    await registerAndSignIn(page, uniqueEmail('not-staff-money'), 'Not Staff');
    for (const [method, path] of [
      ['post', '/api/v1/admin/bookings/lookup'],
      ['get', `/api/v1/admin/bookings/${randomUUID()}`],
      ['post', `/api/v1/admin/bookings/${randomUUID()}/cancel`],
      ['post', `/api/v1/admin/bookings/${randomUUID()}/refund/retry`],
      ['post', `/api/v1/admin/bookings/${randomUUID()}/refund/settle`],
      ['get', '/api/v1/admin/payments'],
      ['post', `/api/v1/admin/disputes/${randomUUID()}/decide`],
    ] as const) {
      const answer = await page.request[method](`${WEB_URL}${path}`, {
        headers: { origin: WEB_URL },
        data:
          method === 'post'
            ? { note: 'x', reference: 'ABCD-EFGH', decision: 'owners_bear' }
            : undefined,
      });
      expect(answer.status(), `${method} ${path}`).toBe(403);
    }
  } finally {
    await context.close();
  }
});
