import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@parkfairy/contracts/locales';
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // Every URL carries its locale, as on the public site.
  localePrefix: 'always',
});
