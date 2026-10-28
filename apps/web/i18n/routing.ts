import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@parkfairy/contracts';
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // Every URL carries its locale (/el/..., /en/...) so pages are shareable and indexable per language.
  localePrefix: 'always',
});
