import { rm } from 'node:fs/promises';
import { expect, test as setup } from '@playwright/test';
import { emailLink, waitForEmail } from '../support/email';
import { EMAIL_OUTBOX, SIGNED_IN_STATE, SMOKE_USER, TEST_PASSWORD } from '../support/env';
import { ownVisitor, uniqueEmail } from '../support/fixtures';

setup.use(ownVisitor);

// One shared account for every check that needs a session. It is created in Greek on purpose:
// the i18n smoke test asserts the account remembers that language, and its confirmation email
// must arrive in Greek. Runs against a deployed site need SMOKE_USER_EMAIL/PASSWORD, because
// the suite cannot read a real inbox.
setup('shared smoke account', async ({ page }) => {
  // Old emails hold live links, and reading thousands of files fails on Windows (EMFILE).
  if (EMAIL_OUTBOX) await rm(EMAIL_OUTBOX, { recursive: true, force: true });
  if (!SMOKE_USER && !EMAIL_OUTBOX) {
    throw new Error('A deployed site needs SMOKE_USER_EMAIL and SMOKE_USER_PASSWORD');
  }
  const account = SMOKE_USER ?? { email: uniqueEmail(), password: TEST_PASSWORD };

  if (!SMOKE_USER) {
    await page.goto('/el/sign-up');
    await page.getByLabel('Όνομα').fill('Smoke Οδηγός');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Κωδικός πρόσβασης').fill(account.password);
    await page.getByRole('button', { name: 'Δημιουργία λογαριασμού' }).click();
    await expect(page.getByRole('heading', { name: 'Ελέγξτε τα εισερχόμενά σας' })).toBeFocused();
    await page.goto(
      emailLink(await waitForEmail(account.email, 'Επιβεβαιώστε τη διεύθυνση email σας')),
    );
    await page.getByRole('button', { name: 'Επιβεβαίωση email' }).click();
    await expect(page.getByRole('heading', { name: 'Το email επιβεβαιώθηκε' })).toBeFocused();
  }

  await page.goto('/el/sign-in');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Κωδικός πρόσβασης').fill(account.password);
  await page.getByRole('button', { name: 'Σύνδεση' }).click();

  await expect(page).toHaveURL('/el/account');
  await page.context().storageState({ path: SIGNED_IN_STATE });
});
