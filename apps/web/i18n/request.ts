import { DEFAULT_TIME_ZONE } from '@parkfairy/contracts';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Render dates in the marketplace's zone on server and client alike (no hydration drift).
    timeZone: DEFAULT_TIME_ZONE,
  };
});
