import { expect, test as setup } from '@playwright/test';
import { SIGNED_IN_STATE, SMOKE_USER, TEST_PASSWORD } from '../support/env';
import { uniqueEmail } from '../support/fixtures';

// One shared account for every check that needs a session, which keeps the suite under
// Better Auth's sign-up/sign-in rate limits. It is created in Greek on purpose: the i18n
// smoke test asserts the account remembers that language.
setup('shared smoke account', async ({ page }) => {
  if (SMOKE_USER) {
    await page.goto('/el/sign-in');
    await page.getByLabel('Email').fill(SMOKE_USER.email);
    await page.getByLabel('Κωδικός πρόσβασης').fill(SMOKE_USER.password);
    await page.getByRole('button', { name: 'Σύνδεση' }).click();
  } else {
    await page.goto('/el/sign-up');
    await page.getByLabel('Όνομα').fill('Smoke Οδηγός');
    await page.getByLabel('Email').fill(uniqueEmail());
    await page.getByLabel('Κωδικός πρόσβασης').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Δημιουργία λογαριασμού' }).click();
  }

  await expect(page).toHaveURL('/el/account');
  await page.context().storageState({ path: SIGNED_IN_STATE });
});
