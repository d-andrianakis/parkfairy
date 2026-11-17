import { randomUUID } from 'node:crypto';

import { type Browser, expect, type Page, test } from '@playwright/test';

import { FIRST_VISIT, measureFirstVisit } from '../support/budgets';
import {
  addEndedBookings,
  HAS_DATABASE,
  makeStaff,
  overstayOf,
  publishListing,
  unpublishListing,
} from '../support/db';
import { ADMIN_URL, EMAIL_OUTBOX, TEST_PASSWORD, visitorAddress } from '../support/env';
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

// Feature: overstay reports (5.2c4, #11, #76): an owner says a car stayed past its booking, and staff
// close the report with a note. Recorded and triaged only. The rules (who may report, which stays,
// races, the table's constraints) are the API's integration tests; here is the path across the two
// apps, what each side reads, and the screens in both languages.

test.skip(!ADMIN_URL, 'The staff app is only reachable on a local run');
test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
test.skip(!HAS_DATABASE, 'Making staff, and stays that are over, is done by hand');
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

test('an owner reports a car left past its stay and support closes the report', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const owner = await freshPage(browser);
  await registerAndSignIn(owner.page, uniqueEmail('over-owner'), 'Over Owen');
  const name = `Γκαράζ υπέρβασης ${randomUUID().slice(0, 6)}`;
  const listing = await listingWithStaff(owner.page, name);
  await publishListing(listing.id);
  const [target, second] = await addEndedBookings(listing.id, 2);
  const reference = target?.reference ?? '';

  const staffEmail = uniqueEmail('over-staff');
  const web = await freshPage(browser);
  await registerAndSignIn(web.page, staffEmail, 'Over Sam');
  const key = await enrolTwoFactor(web.page);
  await makeStaff(staffEmail);
  const session = await freshPage(browser);
  const staff = session.page;
  const csp = await trackCspViolations(staff);
  try {
    // The owner's past bookings offer the report, saying what it does and does not do.
    const page = owner.page;
    await page.goto('/en/owner/bookings?status=past');
    await expect(page.getByText(/within 14 days of the stay’s end/)).toBeVisible();
    await expectAccessible(page);
    const report = page.getByRole('button', { name: `Report an overstay (booking ${reference})` });
    await report.click();
    const note = page.getByLabel('What happened?');
    await expect(note).toBeFocused();
    await expect(
      page.getByText(/The driver isn’t told, and nothing is charged or refunded/),
    ).toBeVisible();
    await expectAccessible(page);

    // Nothing is sent without a note; a refusal puts the cursor back in the field.
    await page.getByRole('button', { name: 'Send the report' }).click();
    await expect(note).toBeFocused();
    await expect(note).toHaveAccessibleDescription(/Describe what happened\./);
    expect(await overstayOf(target?.id ?? '')).toBeNull();

    // "Not now" gives the button back, with the focus.
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(report).toBeFocused();
    await report.click();

    const said = `A grey Fiat stayed ${randomUUID().slice(0, 6)} minutes on.`;
    await page.getByLabel('What happened?').fill(said);
    await page.getByRole('button', { name: 'Send the report' }).click();
    const sent = page.getByRole('status').filter({ hasText: 'Report sent.' });
    await expect(sent).toBeFocused();
    expect(await overstayOf(target?.id ?? '')).toMatchObject({ status: 'open', note: said });

    // After a reload the report is a line of text, and the other stay still offers one. Greek too.
    await page.reload();
    await expect(
      page.getByText(/An overstay was reported on .*Our team will look into it\./),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Report an overstay (booking ${reference})` }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `Report an overstay (booking ${second?.reference})` }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/el/owner/bookings?status=past');
    await expect(page.getByText(/Αναφέρθηκε υπέρβαση χρόνου/)).toBeVisible();
    await page.getByRole('button', { name: /Αναφορά υπέρβασης χρόνου/ }).click();
    await expect(page.getByLabel('Τι συνέβη;')).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await expectAccessible(page);

    // Staff see it in the queue: a reference and a listing, no driver and no note.
    await signInToStaffApp(staff, staffEmail, key, '/overstays');
    await expect(staff.getByRole('heading', { level: 1, name: 'Overstays' })).toBeVisible();
    await expectAccessible(staff);
    const row = staff.getByRole('row', { name: new RegExp(reference) });
    await expect(row).toContainText(name);
    await expect(row).not.toContainText(said);
    await row.getByRole('link', { name: reference }).click();
    await expect(staff).toHaveURL(/\/en\/overstays\/[0-9a-f-]{36}$/);

    // The report: who wrote what, the stay, and a way to the booking, which is where the driver is.
    await expect(staff.getByRole('heading', { level: 1 })).toContainText(reference);
    await expect(staff.getByText(said)).toBeVisible();
    await expect(staff.getByText('Over Owen')).toBeVisible();
    await expect(staff.getByText('IKB1234')).toHaveCount(0);
    await expect(staff.getByRole('link', { name: `Open booking ${reference}` })).toBeVisible();
    await expectAccessible(staff);

    const cold = await browser.newContext({
      storageState: await session.context.storageState(),
      extraHTTPHeaders: { 'x-forwarded-for': visitorAddress() },
    });
    const { javascriptBytes, requests } = await measureFirstVisit(
      await cold.newPage(),
      staff.url(),
    );
    await cold.close();
    test.info().annotations.push({
      type: 'measurement',
      description: `an overstay report: ${Math.round(javascriptBytes / 1024)} KiB JS, ${requests} requests`,
    });
    expect(javascriptBytes).toBeLessThan(FIRST_VISIT.javascriptBytes);
    expect(requests).toBeLessThan(FIRST_VISIT.requests);

    // Closing it: a note, one more question, then a heading that takes the focus.
    const start = staff.getByRole('button', { name: 'Close this report…' });
    await start.click();
    const why = staff.getByLabel(/What was done\?/);
    await expect(why).toBeFocused();
    await expect(why).toHaveAttribute('aria-invalid', 'true');
    const ticket = `Ticket ${randomUUID().slice(0, 6)}, owner called.`;
    await why.fill(ticket);
    await start.click();
    await expect(staff.getByText('Close this report now? This can’t be undone.')).toBeFocused();
    await staff.getByRole('button', { name: 'Not yet' }).click();
    await expect(why).toHaveValue(ticket);
    await start.click();
    await staff.getByRole('button', { name: 'Yes, close it' }).click();
    await expect(staff.getByRole('heading', { name: 'Report closed' })).toBeFocused();
    expect(await overstayOf(target?.id ?? '')).toMatchObject({
      status: 'resolved',
      resolution: ticket,
    });

    // Closed: it moves lists, and asking the API again says it is done.
    await staff.reload();
    await expect(staff.getByText('Nothing to do here: this report is closed.')).toBeVisible();
    await staff.goto(admin('/en/overstays'));
    await expect(staff.getByRole('row', { name: new RegExp(reference) })).toHaveCount(0);
    await staff.goto(admin('/en/overstays?status=resolved'));
    await expect(staff.getByRole('row', { name: new RegExp(reference) })).toBeVisible();
    const id = (await staff.getByRole('link', { name: reference }).getAttribute('href'))
      ?.split('/')
      .pop();
    const again = await staff.request.post(admin(`/api/v1/admin/overstays/${id}/resolve`), {
      headers: { origin: ADMIN_URL as string },
      data: { note: ticket },
    });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'ALREADY_RESOLVED' });

    // The log names the booking and the note; the owner's page says it was looked into, not what staff wrote.
    await staff.goto(admin('/en/audit?action=overstay.resolved'));
    const logRow = staff
      .getByRole('table', { name: 'Audit log' })
      .getByRole('row', { name: /Overstay report closed/ })
      .first();
    await expect(logRow).toContainText(staffEmail);
    await expect(logRow).toContainText(ticket);
    await expect(logRow).toContainText(reference);
    await expectAccessible(staff);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/owner/bookings?status=past');
    await expect(page.getByText(/has looked into it and closed the report/)).toBeVisible();
    await expect(page.getByText(ticket)).toHaveCount(0);

    // The staff screens in Greek at a phone's width.
    await staff.setViewportSize({ width: 320, height: 800 });
    await staff.goto(admin('/el/overstays?status=resolved'));
    await expect(staff.getByRole('heading', { level: 1, name: 'Υπερβάσεις χρόνου' })).toBeVisible();
    expect(
      await staff.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await expectAccessible(staff);
    expect(await csp()).toEqual([]);
  } finally {
    await session.context.close();
    await web.context.close();
    await owner.context.close();
    await unpublishListing(listing.id);
  }
});
