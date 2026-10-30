import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { emailLink, waitForEmail } from './email';
import { TEST_PASSWORD, visitorAddress } from './env';

export const uniqueEmail = (prefix = 'smoke') => `${prefix}-${randomUUID()}@example.com`;

/**
 * `test.use(ownVisitor)`: a test arrives as a visitor of its own, not just its worker's (see
 * VISITOR_HEADERS): a flow with an emailed link needs several sign-ins, which would otherwise
 * use up the limit of the tests around it.
 */
export const ownVisitor = {
  // eslint-disable-next-line no-empty-pattern -- Playwright insists on a destructuring pattern
  extraHTTPHeaders: async ({}, use: (headers: Record<string, string>) => Promise<void>) => {
    await use({ 'x-forwarded-for': visitorAddress() });
  },
};

/** Fills in the sign-up form (English) and waits for the "check your inbox" step. */
export async function signUp(page: Page, email: string, name = 'Smoke Driver') {
  await page.goto('/en/sign-up');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeFocused();
}

/** Fills in the sign-in form on the current page (English). */
export async function signIn(page: Page, email: string, password = TEST_PASSWORD) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Opens the link in the confirmation email (English) and presses its button. */
export async function confirmEmail(page: Page, email: string) {
  await page.goto(emailLink(await waitForEmail(email, 'Confirm your email address')));
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeFocused();
}

/** A new account through the real pages: sign-up, emailed link, sign-in. Ends on the account. */
export async function registerAndSignIn(page: Page, email: string, name?: string) {
  await signUp(page, email, name);
  await confirmEmail(page, email);
  await page.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/en/sign-in');
  await signIn(page, email);
  await expect(page).toHaveURL('/en/account');
}

/** WCAG 2.2 A/AA scan of the current page; fails with the rule ids and offending nodes. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const findings = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(findings, `axe violations on ${page.url()}`).toEqual([]);
}

/** Collects Content-Security-Policy violations reported by the browser for this page. */
export async function trackCspViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = store;
    document.addEventListener('securitypolicyviolation', (event) => {
      store.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}
