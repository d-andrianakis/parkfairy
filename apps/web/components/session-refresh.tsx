'use client';

import { useEffect } from 'react';

/**
 * Rendered by the layout when the session is due for its daily extension. Server components
 * cannot set cookies, so the extension goes through the auth handler, whose response renews
 * the cookie. Best effort: if it fails, the next page load tries again.
 */
export function SessionRefresh() {
  useEffect(() => {
    void fetch('/api/auth/get-session', { credentials: 'same-origin', cache: 'no-store' }).catch(
      () => {},
    );
  }, []);
  return null;
}
