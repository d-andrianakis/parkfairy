const KEY = 'parkfairy.typed-email';

/**
 * Carries an address typed on sign-in to the forgotten-password form, so nobody retypes it
 * (WCAG 3.3.7). Not in the URL, where it would reach logs. Storage can be blocked, and losing
 * this only means typing the address again.
 */
export function rememberEmail(email: string | undefined): void {
  if (!email) return;
  try {
    sessionStorage.setItem(KEY, email);
  } catch {}
}

/** The remembered address, once: it should not linger in the browser. */
export function takeRememberedEmail(): string | null {
  try {
    const email = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return email;
  } catch {
    return null;
  }
}
