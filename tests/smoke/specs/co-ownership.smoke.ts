import { expect, test, type Page } from '@playwright/test';
import { emailLink, waitForEmail } from '../support/email';
import { activatePayoutsOf, HAS_DATABASE } from '../support/db';
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
import { fillOwnerDetails, listingWithStaff } from '../support/listings';

// Feature: co-ownership of a listing (#53–#56). The primary owner invites by email from the
// listing's owners page; the worker sends the invitation, its link's token after `#`; the person
// invited, signed out, signs in on the way and comes back to accept it; the primary sets the
// shares once everyone given one has filled in their details (#22), and the page says drivers
// wait until everyone with a share can be paid. A co-owner paid a share can't empty their details
// (they would go missing under live bookings), and the primary can hand the role over: offered by
// email, accepted by the co-owner, the old primary staying as a co-owner (#61–#64).

test.use(ownVisitor);

test('an owner invites a co-owner by email, who accepts, and the primary sets the shares', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'The invitation is read from the local email outbox');
  test.setTimeout(300_000);
  const name = `Κοινό γκαράζ ${Date.now().toString(36)}`;
  const primaryEmail = uniqueEmail('primary-owner');
  await registerAndSignIn(page, primaryEmail, 'Maria Primary');
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
      `Maria Primary invites you to co-own “${name}”.`,
    );
    await expectAccessible(invited);
    // And in Greek: the token kept for the tab while the invitation is open.
    await invited.goto('/el/owner/invite');
    await expect(invited.getByRole('status')).toContainText(
      `Maria Primary σας προσκαλεί να συμμετέχετε στην ιδιοκτησία του χώρου «${name}».`,
    );
    await expectAccessible(invited);
    await invited.goto('/en/owner/invite');
    await invited.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(
      invited.getByRole('heading', { name: 'You’re now one of this listing’s owners.' }),
    ).toBeFocused();
    await invited.getByRole('link', { name: 'See the listing’s owners' }).click();
    await expect(invited.getByText('Eleni Co (you)')).toBeVisible();
    // A co-owner sees the shares, and may leave, but not set them, nor anyone's address.
    await expect(invited.getByRole('spinbutton')).toHaveCount(0);
    await expect(invited.getByRole('button', { name: 'Leave this listing' })).toBeVisible();
    await expect(invited.getByText(coOwnerEmail, { exact: true })).toBeVisible();
    await expect(invited.getByText(/^primary-owner/)).toHaveCount(0);

    // The primary gives the co-owner a share: refused while their details and tax aren't in.
    await page.reload();
    await page.getByRole('spinbutton', { name: 'Share for Maria Primary' }).fill('70');
    await page.getByRole('spinbutton', { name: 'Share for Eleni Co' }).fill('30');
    await expect(page.getByText('Total: 100%')).toBeVisible();
    await page.getByRole('button', { name: 'Save shares' }).click();
    await expect(
      page.getByText(/^An owner with a share, or the primary owner, hasn’t/),
    ).toBeVisible();
    // Said at the share that waits, naming whose it is.
    await expect(
      page.getByRole('spinbutton', { name: 'Share for Eleni Co' }),
    ).toHaveAccessibleDescription(
      /Eleni Co can have a share once they’ve filled in “About you” and “Tax details”/,
    );
    await expectAccessible(page);
    await fillOwnerDetails(invited);

    // Filled in: saved. They can't be paid yet, so drivers wait.
    await page.getByRole('button', { name: 'Save shares' }).click();
    await expect(page.getByText('Shares saved.')).toBeVisible();
    await expect(page.getByText(/Drivers can’t book this listing until every owner/)).toBeVisible();
    await expectAccessible(page);

    // Paid a share of a listing that is with staff: their details can't be left incomplete, and
    // the page says why beside the status, not "check your connection".
    await invited.goto('/en/owner/profile');
    const phone = invited.getByRole('textbox', { name: 'Phone' });
    await expect(phone).not.toHaveValue('');
    await phone.clear();
    await phone.press('Tab');
    await expect(
      invited.getByText(/You’re paid a share of a listing that is with us or live/),
    ).toBeVisible();
    await expectAccessible(invited);
    // A value can still be replaced.
    await phone.fill('+30 210 123 4568');
    await phone.press('Tab');
    await expect(
      invited.getByText(/You’re paid a share of a listing that is with us or live/),
    ).toHaveCount(0);

    // And in Greek.
    await page.goto(`/el/owner/listings/${id}/owners`);
    await expect(page.getByRole('heading', { level: 1, name: 'Ιδιοκτήτες' })).toBeVisible();
    await expect(page.getByText('Συνιδιοκτησία', { exact: true })).toBeVisible();
    await expectAccessible(page);

    // A payout account is made by hand in the database (Stripe isn't in this run).
    if (HAS_DATABASE) await handOver({ page, invited, id, primaryEmail, coOwnerEmail });
  } finally {
    await context.close();
  }
});

/**
 * The primary offers the role (asked twice), the co-owner is emailed, takes it over (asked twice)
 * once their payouts are set up, and the old primary is told by email and stays as a co-owner.
 */
async function handOver({
  page,
  invited,
  id,
  primaryEmail,
  coOwnerEmail,
}: {
  page: Page;
  invited: Page;
  id: string;
  primaryEmail: string;
  coOwnerEmail: string;
}) {
  const ownersPath = `/en/owner/listings/${id}/owners`;
  await page.goto(ownersPath);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Handing over the primary role' }),
  ).toBeVisible();
  await expectAccessible(page);

  // Asked twice: the first press changes nothing, and "No" leaves things as they are.
  await page.getByRole('button', { name: 'Offer the primary role to Eleni Co' }).click();
  await expect(page.getByText(/Nothing changes until they accept/)).toBeFocused();
  await page.getByRole('button', { name: 'No, leave it as it is' }).click();
  await expect(
    page.getByRole('button', { name: 'Offer the primary role to Eleni Co' }),
  ).toBeFocused();

  // Not ready to lead: payouts. The refusal names what's missing, and nothing was offered.
  await page.getByRole('button', { name: 'Offer the primary role to Eleni Co' }).click();
  await page.getByRole('button', { name: 'Yes, offer it' }).click();
  await expect(page.getByText(/needs payouts set up with Stripe first/)).toBeVisible();
  await expectAccessible(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Take the offer back' })).toHaveCount(0);

  await activatePayoutsOf(coOwnerEmail);
  await page.getByRole('button', { name: 'Offer the primary role to Eleni Co' }).click();
  await page.getByRole('button', { name: 'Yes, offer it' }).click();
  await expect(page.getByText('Offered the primary role to Eleni Co.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take the offer back' })).toBeFocused();
  await expect(page.getByText(/has been offered the primary role/)).toBeVisible();
  await expectAccessible(page);

  // The co-owner is emailed by the worker, with nothing an owner typed in it.
  const offered = await waitForEmail(
    coOwnerEmail,
    'You’ve been offered the primary role of a listing on Parkfairy',
    { timeout: 90_000 },
  );
  expect(emailLink(offered)).toContain(`/en/owner/listings/${id}/owners`);

  // Their page: the offer, the way to payouts, and Greek.
  await invited.goto(ownersPath);
  await expect(invited.getByText(/You’ve been offered the primary role/)).toBeVisible();
  await expect(invited.getByRole('link', { name: 'Set up your payouts' })).toHaveAttribute(
    'href',
    '/en/owner/payouts',
  );
  await expectAccessible(invited);
  await invited.goto(`/el/owner/listings/${id}/owners`);
  await expect(
    invited.getByRole('heading', { level: 2, name: 'Παράδοση του ρόλου του κύριου ιδιοκτήτη' }),
  ).toBeVisible();
  await expectAccessible(invited);

  // Taking over: asked twice, the focus lands on the page's owners heading, and the rights moved.
  await invited.goto(ownersPath);
  await invited.getByRole('button', { name: 'Take over the primary role' }).click();
  await invited.getByRole('button', { name: 'Yes, take over' }).click();
  await expect(invited.getByText('You’re now the primary owner.')).toBeVisible();
  await expect(invited.getByRole('heading', { level: 2, name: 'Owners and shares' })).toBeFocused();
  await expect(invited.getByRole('button', { name: 'Save shares' })).toBeVisible();
  await expect(invited.getByRole('button', { name: 'Leave this listing' })).toHaveCount(0);
  await expectAccessible(invited);

  // The old primary stays, as a co-owner: no shares to set, nobody to remove, but a way out.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Leave this listing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save shares' })).toHaveCount(0);
  await expect(page.getByText('Maria Primary (you)')).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Handing over the primary role' }),
  ).toHaveCount(0);
  await expectAccessible(page);

  // And is told, by the worker.
  const accepted = await waitForEmail(primaryEmail, 'Your listing has a new primary owner', {
    timeout: 90_000,
  });
  expect(emailLink(accepted)).toContain(`/en/owner/listings/${id}/owners`);
}
