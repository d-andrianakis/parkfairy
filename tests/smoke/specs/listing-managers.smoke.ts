import { expect, test } from '@playwright/test';

import { addBookings, HAS_DATABASE, publishListing, unpublishListing } from '../support/db';
import { emailLink, waitForEmail } from '../support/email';
import { EMAIL_OUTBOX, WEB_URL } from '../support/env';
import {
  confirmEmail,
  expectAccessible,
  ownVisitor,
  registerAndSignIn,
  signIn,
  signUp,
  uniqueEmail,
} from '../support/fixtures';
import { listingWithStaff } from '../support/listings';

// Feature: a listing's managers (#69–#71). The primary owner invites one by email from the owners
// page, choosing "a manager"; the manager needs only an account. They get the calendar, the
// bookings (and may cancel one) and the closures, and nothing else of the listing's: not its
// owners, not its earnings. The primary can take them off again.

test.use(ownVisitor);

test('the primary owner invites a manager, who runs the listing day to day, until removed', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'The invitation is read from the local email outbox');
  test.skip(!HAS_DATABASE, 'Putting a listing live and booking it are done by hand');
  test.setTimeout(300_000);
  const name = `Γκαράζ διαχείρισης ${Date.now().toString(36)}`;
  await registerAndSignIn(page, uniqueEmail('mgr-primary'), 'Maria Primary');
  const { id } = await listingWithStaff(page, name, { spaces: ['Α1'], contentLocale: 'en' });
  await publishListing(id);
  await addBookings(id, 2);

  const managerEmail = uniqueEmail('mgr');
  const context = await browser.newContext();
  const manager = await context.newPage();
  try {
    // The owners page: the primary chooses what they are inviting someone to be.
    await page.goto(`/en/owner/listings/${id}/owners`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Invite an owner or a manager' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Managers' })).toBeVisible();
    await expect(page.getByText('No managers yet.')).toBeVisible();
    await page.getByRole('radio', { name: /^Manager/ }).check();
    await page.getByRole('textbox', { name: 'Email address' }).fill(managerEmail);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(`Invitation to manage sent to ${managerEmail}.`)).toBeVisible();

    const invitation = await waitForEmail(
      managerEmail,
      'An invitation to manage a parking listing on Parkfairy',
      { timeout: 90_000 },
    );
    const link = emailLink(invitation);
    expect(new URL(link).pathname).toBe('/en/owner/invite');
    expect(new URL(link).hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);

    // The manager: a new account, nothing else, and the invitation says what it is to.
    await signUp(manager, managerEmail, 'Nikos Manager');
    await confirmEmail(manager, managerEmail);
    await manager.goto(link);
    await manager.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
    await signIn(manager, managerEmail);
    await expect(manager).toHaveURL('/en/owner/invite');
    await expect(manager.getByRole('status')).toContainText(
      `Maria Primary invites you to manage “${name}”.`,
    );
    await expect(manager.getByText(/You won’t have a share or see earnings/)).toBeVisible();
    await expectAccessible(manager);
    await manager.goto('/el/owner/invite');
    await expect(manager.getByRole('status')).toContainText(
      `Maria Primary σας προσκαλεί να διαχειρίζεστε τον χώρο «${name}».`,
    );
    await expectAccessible(manager);
    await manager.goto('/en/owner/invite');
    await manager.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(
      manager.getByRole('heading', { name: 'You now manage this listing.' }),
    ).toBeFocused();

    // The calendar of the listing, with its bookings; the owners' page is not theirs.
    await manager.getByRole('link', { name: 'See the listing’s calendar' }).click();
    await expect(manager).toHaveURL(new RegExp(`/en/owner/calendar\\?listing=${id}`));
    await expect(manager.getByRole('heading', { level: 1 })).toHaveText('Calendar');
    await expect(
      manager.getByRole('heading', { level: 3, name: /^Booking [0-9A-Z]{4}-[0-9A-Z]{4}$/ }).first(),
    ).toBeVisible();
    await expectAccessible(manager);
    expect((await manager.request.get(`/api/v1/owner/listings/${id}/owners`)).status()).toBe(404);
    expect((await manager.request.get(`/api/v1/owner/listings/${id}`)).status()).toBe(404);
    expect((await manager.request.get('/api/v1/owner/earnings')).ok()).toBe(true);
    // Their own page for it isn't there: the same 404 as any listing that isn't theirs.
    expect((await manager.goto(`/en/owner/listings/${id}/owners`))?.status()).toBe(404);

    // Their start: the listing they manage, three ways in.
    await manager.goto('/en/owner');
    const managed = manager.getByRole('heading', { level: 2, name: 'Listings you manage' });
    await expect(managed).toBeVisible();
    await expectAccessible(manager);
    await manager.getByRole('list', { name }).getByRole('link', { name: 'Bookings' }).click();
    await expect(manager).toHaveURL(`/en/owner/listings/${id}/bookings`);
    await expect(
      manager.getByRole('heading', { level: 2, name: /^Booking [0-9A-Z]{4}-[0-9A-Z]{4}$/ }).first(),
    ).toBeVisible();
    await manager.goto(`/en/owner/listings/${id}/closures`);
    await expect(manager.getByRole('heading', { level: 1 })).toHaveText(
      'Closures and special hours',
    );
    await expectAccessible(manager);
    // They may save closures; the listing's own changes stay refused.
    const closed = await manager.request.put(`/api/v1/owner/listings/${id}/hours-exceptions`, {
      headers: { origin: WEB_URL },
      data: { exceptions: [] },
    });
    expect(closed.ok()).toBe(true);

    // In Greek, and at a phone's width: their start, and the primary's owners page.
    await manager.setViewportSize({ width: 320, height: 800 });
    await page.setViewportSize({ width: 320, height: 800 });
    for (const [who, path] of [
      [manager, '/el/owner'],
      [page, `/el/owner/listings/${id}/owners`],
    ] as const) {
      await who.goto(path);
      await expect(who.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await who.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
      await expectAccessible(who);
    }
    await manager.setViewportSize({ width: 1280, height: 720 });
    await page.setViewportSize({ width: 1280, height: 720 });

    // The primary sees them, and takes them off in two presses; they lose the listing at once.
    await page.goto(`/en/owner/listings/${id}/owners`);
    await expect(page.getByText(managerEmail, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove manager Nikos Manager' }).click();
    await page.getByRole('button', { name: 'Yes, remove' }).click();
    await expect(page.getByText('Removed manager Nikos Manager.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Managers' })).toBeFocused();
    expect((await manager.request.get(`/api/v1/owner/listings/${id}/bookings`)).status()).toBe(404);
    await manager.goto('/en/owner');
    await expect(
      manager.getByRole('heading', { level: 2, name: 'Listings you manage' }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await unpublishListing(id);
  }
});
