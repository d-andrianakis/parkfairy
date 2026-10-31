const KEY = 'parkfairy.typed-email';
const SENT_KEY = 'parkfairy.sent-to';

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

/** Keeps the address a page's form was sent to, for `useSentPanel`. False if it can't. */
export function rememberSentTo(pathname: string, email: string): boolean {
  try {
    sessionStorage.setItem(`${SENT_KEY}:${pathname}`, email);
    return true;
  } catch {
    return false;
  }
}

export function recallSentTo(pathname: string): string | null {
  try {
    return sessionStorage.getItem(`${SENT_KEY}:${pathname}`);
  } catch {
    return null;
  }
}

export function forgetSentTo(pathname: string): void {
  try {
    sessionStorage.removeItem(`${SENT_KEY}:${pathname}`);
  } catch {}
}

/** On sign-in and sign-out: nobody waits for a link then, and the tab may be someone else's next. */
export function forgetEverySentTo(): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(SENT_KEY)) sessionStorage.removeItem(key);
    }
  } catch {}
}
