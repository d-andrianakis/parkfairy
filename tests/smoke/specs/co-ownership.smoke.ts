import { expect, test } from '@playwright/test';
import { emailLink, waitForEmail } from '../support/email';
import { EMAIL_OUTBOX } from '../support/env';
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

// Feature: co-ownership of a listing (#53–#56). The primary owner invites by email from the
// listing's owners page; the worker sends the invitation, its link's token after `#`; the person
// invited, signed out, signs in on the way and comes back to accept it; the primary sets the
// shares, and the page says drivers wait until everyone with a share can be paid.

test.use(ownVisitor);

test('an owner invites a co-owner by email, who accepts, and the primary sets the shares', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'The invitation is read from the local email outbox');
  test.setTimeout(180_000);
  const name = `Κοινό γκαράζ ${Date.now().toString(36)}`;
  await registerAndSignIn(page, uniqueEmail('primary-owner'), 'Maria Primary');
  const { id } = await listingWithStaff(page, name);

  // From the dashboard to the listing's owners.
  await page.goto('/en/owner');
  await page.getByRole('link', { name: `Owners of “${name}”` }).click();
  await expect(page).toHaveURL(`/en/owner/listings/${id}/owners`);
  await expect(page.getByRole('heading', { level: 1, name: 'Owners' })).toBeVisible();
  await expectAccessible(page);

  const coOwnerEmail = uniqueEmail('co-owner');
  await page.getByRole('textbox', { name: 'Email address' }).fill(coOwnerEmail);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${coOwnerEmail}.`)).toBeVisible();
  await expect(page.getByText(coOwnerEmail, { exact: true })).toBeVisible();

  // The worker sends it: the link's token after `#`, so no server ever logs it.
  const invitation = await waitForEmail(
    coOwnerEmail,
    'An invitation to co-own a parking listing on Parkfairy',
    { timeout: 90_000 },
  );
  const link = emailLink(invitation);
  expect(new URL(link).pathname).toBe('/en/owner/invite');
  expect(new URL(link).hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);

  const context = await browser.newContext();
  const invited = await context.newPage();
  try {
    await signUp(invited, coOwnerEmail, 'Eleni Co');
    await confirmEmail(invited, coOwnerEmail);
    // Signed out: asked to sign in with the address invited; the link's token kept for the tab.
    await invited.goto(link);
    await expect(
      invited.getByRole('heading', { level: 1, name: 'Invitation to co-own a listing' }),
    ).toBeVisible();
    await expectAccessible(invited);
    await invited.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
    await signIn(invited, coOwnerEmail);
    await expect(invited).toHaveURL('/en/owner/invite');
    await expect(invited.getByRole('status')).toContainText(
      `Maria Primary invites you to own “${name}” with its owners.`,
    );
    await expectAccessible(invited);
    await invited.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(
      invited.getByRole('heading', { name: 'You’re now one of this listing’s owners.' }),
    ).toBeFocused();
    await invited.getByRole('link', { name: 'See the listing’s owners' }).click();
    await expect(invited.getByText('Eleni Co (you)')).toBeVisible();
    // A co-owner sees the shares, and may leave, but not set them.
    await expect(invited.getByRole('spinbutton')).toHaveCount(0);
    await expect(invited.getByRole('button', { name: 'Leave this listing' })).toBeVisible();
  } finally {
    await context.close();
  }

  // The primary gives the co-owner a share; they can't be paid yet, so drivers wait.
  await page.reload();
  await page.getByRole('spinbutton', { name: 'Share for Maria Primary' }).fill('70');
  await page.getByRole('spinbutton', { name: 'Share for Eleni Co' }).fill('30');
  await expect(page.getByText('Total: 100%')).toBeVisible();
  await page.getByRole('button', { name: 'Save shares' }).click();
  await expect(page.getByText('Shares saved.')).toBeVisible();
  await expect(page.getByText(/Drivers can’t book this listing until every owner/)).toBeVisible();
  await expectAccessible(page);

  // And in Greek.
  await page.goto(`/el/owner/listings/${id}/owners`);
  await expect(page.getByRole('heading', { level: 1, name: 'Ιδιοκτήτες' })).toBeVisible();
  await expect(page.getByText('Συνιδιοκτησία', { exact: true })).toBeVisible();
  await expectAccessible(page);
});
