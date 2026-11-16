import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { FIRST_VISIT, measureFirstVisit } from '../support/budgets';
import { HAS_DATABASE, makeStaff, unpublishListing } from '../support/db';
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

// Feature: the staff app (5.2b, #66–#68): its own origin, sign-in with a second factor, the queue,
// a listing's review, the decision and the audit log, in both languages. What the API itself
// refuses an ordinary account is in `admin.smoke.ts`.

test.skip(!ADMIN_URL, 'The staff app is only reachable on a local run');
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

/** Signs in on the staff app (English) and, with a key, passes the second step. */
async function signInToStaffApp(page: Page, email: string, key?: string, next = '/listings') {
  await page.goto(admin(`/en/sign-in?next=${encodeURIComponent(next)}`));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (key) {
    await expect(page).toHaveURL(admin(`/en/two-factor?next=${encodeURIComponent(next)}`));
    await page.getByLabel('Authentication code').fill(totp(key));
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page).toHaveURL(admin(`/en${next}`));
}

/**
 * Opens the queue under a status filter and says which one it is on. The queue is oldest first and
 * other specs leave listings in every state, so a listing of this run is somewhere down the pages:
 * finding it by order is the API's integration test, and here the screen is shown to filter.
 */
async function openQueue(page: Page, filter: string) {
  await page.goto(admin('/en/listings'));
  await page
    .getByRole('navigation', { name: 'Listing status' })
    .getByRole('link', { name: filter, exact: true })
    .click();
  await expect(
    page.getByRole('navigation', { name: 'Listing status' }).getByRole('link', { name: filter }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('table', { name: `Listings, status: ${filter}` })).toBeVisible();
  await expect(page.getByRole('table').getByRole('link').first()).toBeVisible();
}

test('the staff app has a policy of its own and only the doors staff need', async ({ request }) => {
  const response = await request.get(admin('/en/sign-in'));
  expect(response.status()).toBe(200);
  const headers = response.headers();
  const csp = headers['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("connect-src 'self'");
  // Nothing third-party, ever: no maps and no payments on a page that shows owners' details.
  expect(csp).not.toMatch(/mapbox|stripe/i);
  expect(headers['x-robots-tag']).toContain('noindex');
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(await response.text()).toContain('noindex');

  // Sign-up, resets and the rest of Better Auth are not served from this origin.
  for (const [method, path] of [
    ['post', '/api/auth/sign-up/email'],
    ['post', '/api/auth/request-password-reset'],
    ['post', '/api/auth/two-factor/enable'],
    ['post', '/api/auth/update-user'],
    ['get', '/api/auth/get-session'],
    ['get', '/api/auth/list-sessions'],
  ] as const) {
    const answer = await request[method](admin(path), {
      headers: { origin: ADMIN_URL as string },
      data: method === 'post' ? { email: `x-${randomUUID()}@example.com` } : undefined,
    });
    expect(answer.status(), `${method} ${path}`).toBe(404);
  }
  // Sign-in is for this origin alone: a form on another site, the public one included, is refused.
  for (const origin of ['https://evil.example', WEB_URL]) {
    const answer = await request.post(admin('/api/auth/sign-in/email'), {
      headers: { origin },
      data: { email: `x-${randomUUID()}@example.com`, password: TEST_PASSWORD },
    });
    expect(answer.status(), origin).toBe(403);
  }
  // The API answers through this origin too, but only its staff routes: nothing else is proxied.
  expect((await request.get(admin('/api/v1/me'))).status()).toBe(404);
  expect((await request.get(admin('/api/v1/owner/listings'))).status()).toBe(404);
  // The API answers through this origin too, and still wants a session.
  expect((await request.get(admin('/api/v1/admin/listings'))).status()).toBe(401);
  expect((await request.get(admin('/api/v1/admin/audit'))).status()).toBe(401);
});

test('signed out, every staff screen goes to sign-in and comes back', async ({ page }) => {
  for (const [locale, path] of [
    ['en', '/listings'],
    ['el', '/audit'],
    ['en', `/listings/${randomUUID()}`],
    ['en', '/users'],
    ['el', `/users/${randomUUID()}`],
  ] as const) {
    await page.goto(admin(`/${locale}${path}`));
    await expect(page).toHaveURL(admin(`/${locale}/sign-in?next=${encodeURIComponent(path)}`));
  }
  await page.goto(admin('/en/sign-in'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff sign-in');
  await expect(page).toHaveTitle(/^Staff sign-in/);
  // A wrong password is one plain refusal.
  await page.getByLabel('Email').fill(`nobody-${randomUUID()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'The email or password is incorrect' }),
  ).toBeVisible();
  await expectAccessible(page);

  // Greek, on a phone: nothing pushes the page sideways.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(admin('/el/sign-in'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Σύνδεση προσωπικού');
  await expect(page.locator('html')).toHaveAttribute('lang', 'el');
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
  await expectAccessible(page);
});

test('the sign-in page stays within the first-visit budget', async ({ page }) => {
  const { javascriptBytes, requests } = await measureFirstVisit(page, admin('/en/sign-in'));
  test.info().annotations.push({
    type: 'measurement',
    description: `${Math.round(javascriptBytes / 1024)} KiB JS, ${requests} requests`,
  });
  expect(javascriptBytes).toBeLessThan(FIRST_VISIT.javascriptBytes);
  expect(requests).toBeLessThan(FIRST_VISIT.requests);
});

test('an ordinary account signs in and meets no staff screen', async ({ browser, page }) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  const email = uniqueEmail('not-staff');
  await registerAndSignIn(page, email, 'Not Staff');
  const { context, page: other } = await freshPage(browser);
  try {
    await signInToStaffApp(other, email);
    await expect(other.getByRole('heading', { level: 1 })).toHaveText('This account is not staff');
    await expect(other.getByRole('link', { name: 'Listings', exact: true })).toHaveCount(0);
    await expectAccessible(other);
    // The data is the API's to refuse, whatever the page shows.
    expect((await other.request.get(admin('/api/v1/admin/listings'))).status()).toBe(403);
    expect((await other.request.get(admin('/api/v1/admin/audit'))).status()).toBe(403);
  } finally {
    await context.close();
  }
});

test('staff without a second factor are sent to turn it on, and see no data', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'A new account needs its confirmation email');
  test.skip(!HAS_DATABASE, 'Making staff is done by hand');
  const email = uniqueEmail('staff-no-2fa');
  await registerAndSignIn(page, email, 'Staff Without Factor');
  await makeStaff(email);
  const { context, page: other } = await freshPage(browser);
  try {
    await signInToStaffApp(other, email);
    await expect(other.getByRole('heading', { level: 1 })).toHaveText('Turn on two-factor first');
    // No staff links for an account that cannot use them.
    await expect(other.getByRole('navigation', { name: 'Staff' })).toHaveCount(0);
    await expect(
      other.getByRole('link', { name: /account page on the public site/ }),
    ).toHaveAttribute('href', `${WEB_URL}/en/account`);
    // The API says the same on its own.
    const refusal = await other.request.get(admin('/api/v1/admin/listings'));
    expect(refusal.status()).toBe(403);
    expect(await refusal.json()).toMatchObject({ code: 'MFA_REQUIRED' });
  } finally {
    await context.close();
  }
});

test('staff review a listing, send one back, approve another, and it is all in the log', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
  test.skip(!HAS_DATABASE, 'Making staff is done by hand');
  test.setTimeout(240_000);

  // An owner with two listings in review.
  const ownerName = `Owner ${randomUUID().slice(0, 6)}`;
  await registerAndSignIn(page, uniqueEmail('staff-owner'), ownerName);
  const sentBack = await listingWithStaff(page, `Γκαράζ επιστροφής ${randomUUID().slice(0, 6)}`);
  const approved = await listingWithStaff(page, `Γκαράζ έγκρισης ${randomUUID().slice(0, 6)}`, {
    spaces: ['Α1', 'Α2'],
    contentLocale: 'en',
  });
  // …and a staff account of its own, with a second factor.
  const staffEmail = uniqueEmail('staff');
  const staffContext = await freshPage(browser);
  const staffWeb = staffContext.page;
  await registerAndSignIn(staffWeb, staffEmail, 'Staff Reviewer');
  const key = await enrolTwoFactor(staffWeb);
  await makeStaff(staffEmail);

  const { context, page: staff } = await freshPage(browser);
  const csp = await trackCspViolations(staff);
  try {
    // Sign-in, the second step, and the queue the person asked for.
    // Signing in with a deep link comes back to that page, through the second step.
    await signInToStaffApp(staff, staffEmail, key, '/audit');
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Audit log');
    // The session cookie belongs to this host alone (no Domain), and no script can read it.
    const cookie = (await context.cookies(ADMIN_URL)).find((c) => c.name.endsWith('session_token'));
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
    expect(cookie?.domain.startsWith('.')).toBe(false);

    // What each page costs a first visit, in a browser of its own that has cached nothing.
    const state = await context.storageState();
    for (const path of ['/en/listings', `/en/listings/${sentBack.id}`, '/en/audit']) {
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

    await staff.goto(admin('/en/listings'));
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Listings');
    await expect(staff).toHaveTitle(/^Listings/);
    await expect(
      staff.getByRole('navigation', { name: 'Listing status' }).getByRole('link', {
        name: 'Waiting for review',
      }),
    ).toHaveAttribute('aria-current', 'true');
    await expect(staff.getByRole('link', { name: 'Listings', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectAccessible(staff);

    // Its review: what was sent in, who stands behind it, and the proof document.
    await staff.goto(admin(`/en/listings/${sentBack.id}`));
    await expect(staff.getByRole('heading', { level: 1 })).toContainText('Γκαράζ επιστροφής');
    await expect(staff.getByText('Waiting for review').first()).toBeVisible();
    const owners = staff.getByRole('list', { name: 'The listing’s owners and their details' });
    await expect(owners).toContainText(ownerName);
    await expect(owners).toContainText('Primary owner');
    // Tax numbers arrive as their last three characters (#67), never whole.
    await expect(owners).toContainText('Tax number: ending in 216');
    await expect(owners).not.toContainText('094259216');
    await expectAccessible(staff);
    const proof = staff.getByRole('link', { name: /Lease allowing subletting: lease\.pdf/ });
    const download = await staff.request.get((await proof.getAttribute('href')) as string);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-disposition']).toContain('attachment');

    // An empty note is refused in words, and the page is told how many fields need attention.
    await staff.getByRole('button', { name: 'Send back with this note' }).click();
    await expect(staff.getByText('Check this field')).toBeVisible();
    await expect(staff.getByLabel('What should the owner change?')).toBeFocused();
    // Then sent back, with a note the owner will read.
    const note = `Please add a clearer photo of the entrance (${randomUUID().slice(0, 6)}).`;
    await staff.getByLabel('What should the owner change?').fill(note);
    await staff.getByRole('button', { name: 'Send back with this note' }).click();
    await expect(staff.getByRole('heading', { name: 'Listing sent back' })).toBeFocused();
    await staff.reload();
    await expect(staff.getByText('Sent back').first()).toBeVisible();
    await expect(staff.getByText(note)).toBeVisible();
    await expect(staff.getByText(/is not waiting for a decision/)).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Approve this listing' })).toHaveCount(0);
    // A second decision on it is refused by the API, whoever asks.
    const again = await staff.request.post(admin(`/api/v1/admin/listings/${sentBack.id}/approve`), {
      headers: { origin: ADMIN_URL as string },
    });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'NOT_IN_REVIEW' });

    // The filters show each state, and the other listing is opened by its address.
    await openQueue(staff, 'Sent back');
    await openQueue(staff, 'Waiting for review');
    await staff.goto(admin(`/en/listings/${approved.id}`));
    await expect(staff.getByText('Α1 and Α2')).toBeVisible();
    await expect(staff.getByText(/2 spaces:/)).toBeVisible();
    await staff.getByRole('button', { name: 'Approve this listing' }).click();
    await expect(staff.getByText('Publish this listing now?')).toBeVisible();
    await staff.getByRole('button', { name: 'Not yet' }).click();
    await expect(staff.getByRole('button', { name: 'Approve this listing' })).toBeFocused();
    await staff.getByRole('button', { name: 'Approve this listing' }).click();
    await staff.getByRole('button', { name: 'Yes, publish it' }).click();
    await expect(staff.getByRole('heading', { name: 'Listing approved' })).toBeFocused();
    // It is live on the public site.
    await openQueue(staff, 'Live');
    const live = await staff.request.get(`${WEB_URL}/api/v1/parking/${approved.slug}`);
    expect(live.status()).toBe(200);

    // The log has all three, in the staff member's name; the filter narrows it.
    await staff.goto(admin('/en/audit'));
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Audit log');
    const log = staff.getByRole('table', { name: 'Audit log' });
    await expect(log.getByRole('row', { name: /Listing approved/ }).first()).toContainText(
      staffEmail,
    );
    await expect(log.getByRole('row', { name: /Listing sent back/ }).first()).toContainText(note);
    await expect(log.getByRole('row', { name: /Proof document opened/ }).first()).toBeVisible();
    await expectAccessible(staff);
    await staff
      .getByRole('navigation', { name: 'Kind of action' })
      .getByRole('link', { name: 'Listing sent back' })
      .click();
    await expect(staff).toHaveURL(/action=listing\.changes_requested/);
    await expect(log.getByRole('row', { name: /Listing approved/ })).toHaveCount(0);
    await expect(log.getByRole('row', { name: /Listing sent back/ }).first()).toBeVisible();
    // A mangled filter or place is the whole log, not an error.
    await staff.goto(admin('/en/audit?action=nonsense&after=garbage'));
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Audit log');

    // Greek, on a phone: the review and the log stay inside the screen.
    await staff.setViewportSize({ width: 320, height: 800 });
    for (const path of [`/el/listings/${sentBack.id}`, '/el/audit', '/el/listings']) {
      await staff.goto(admin(path));
      await expect(staff.locator('html')).toHaveAttribute('lang', 'el');
      const sideways = await staff.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways, path).toBeLessThanOrEqual(0);
      await expectAccessible(staff);
    }
    await staff.goto(admin('/el/listings'));
    await expect(staff.getByRole('heading', { level: 1 })).toHaveText('Χώροι');

    // Signing out ends it: the screens ask again, and so does the API.
    await staff.goto(admin('/en/listings'));
    await staff.getByRole('button', { name: 'Sign out' }).click();
    await expect(staff).toHaveURL(admin('/en/sign-in'));
    expect((await staff.request.get(admin('/api/v1/admin/listings'))).status()).toBe(401);

    expect(await csp()).toEqual([]);
  } finally {
    await context.close();
    await staffContext.context.close();
    await unpublishListing(approved.id);
  }
});
