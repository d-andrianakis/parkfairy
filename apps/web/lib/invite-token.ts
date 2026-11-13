const KEY = 'parkfairy:invite-token';

/**
 * As `INVITE_TOKEN_PATTERN` in the contracts (a test holds them equal), kept here so the invite
 * page doesn't load zod for one regular expression.
 */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * An invite's token (#56). The email's link carries it after `#`, which no server sees, so it
 * stays out of every log. Read once, it's kept for this tab (signing in on the way loses the
 * address's `#`) and taken out of the address, so it isn't bookmarked or shared with the page.
 */
export function takeInviteToken(): string | null {
  const fromLink = window.location.hash.slice(1);
  if (INVITE_TOKEN_PATTERN.test(fromLink)) {
    try {
      sessionStorage.setItem(KEY, fromLink);
    } catch {
      // Private browsing may refuse: the link still works while the page stays open.
    }
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    return fromLink;
  }
  try {
    const kept = sessionStorage.getItem(KEY);
    return kept && INVITE_TOKEN_PATTERN.test(kept) ? kept : null;
  } catch {
    return null;
  }
}

/** Accepted: nothing left to keep. */
export function forgetInviteToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}
