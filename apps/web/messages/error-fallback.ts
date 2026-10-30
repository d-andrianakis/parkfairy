import type { Locale } from '@parkfairy/contracts/locales';

/**
 * The `Error` namespace of each catalog, for app/global-error.tsx only: that screen shows when
 * the root layout (and with it the message provider) failed, often because a script chunk
 * could not load, so it cannot fetch the catalogs, and bundling them would put every string
 * on every page. The catalogs stay the source of truth: error-fallback.test.ts fails if these
 * drift from them.
 */
export const ERROR_FALLBACK = {
  el: {
    title: 'Παρουσιάστηκε σφάλμα',
    description: 'Δεν ήταν δυνατή η φόρτωση της σελίδας. Δοκιμάστε ξανά.',
    retry: 'Δοκιμάστε ξανά',
  },
  en: {
    title: 'Something went wrong',
    description: 'This page couldn’t be loaded. Please try again.',
    retry: 'Try again',
  },
} satisfies Record<Locale, Record<'title' | 'description' | 'retry', string>>;
