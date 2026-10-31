'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';
import { usePathname, useSearchParams } from '@/i18n/navigation';

// Module scope, not refs: switching language remounts the [locale] layout, and that must still
// count as a navigation. StrictMode's second effect run sees the same key and does nothing.
let lastKey: string | undefined;
let traversedTo: string | undefined;
let keepFocus = false;
if (typeof window !== 'undefined') {
  // Back/Forward restore the scroll position; leave focus alone there too.
  window.addEventListener('popstate', () => {
    traversedTo = window.location.href;
  });
}

/** For a page rewriting its own URL (`useSentPanel`), which is no navigation. */
export function keepFocusThroughUrlChange() {
  keepFocus = true;
}

/**
 * After a client-side navigation Next.js leaves focus on <body>, so keyboard and screen-reader
 * users start nowhere in particular. Move it to the main landmark (tabIndex -1 in the layout).
 * Not on first load, not for in-page hash links (same path and query), not on Back/Forward.
 */
export function RouteFocus() {
  const key = `${useLocale()}${usePathname()}?${useSearchParams()?.toString() ?? ''}`;

  useEffect(() => {
    const navigated = lastKey !== undefined && lastKey !== key;
    lastKey = key;
    if (!navigated) return;
    const traversal = traversedTo === window.location.href;
    traversedTo = undefined;
    const keep = keepFocus;
    keepFocus = false;
    if (!traversal && !keep) document.getElementById('main-content')?.focus();
  }, [key]);

  return null;
}
