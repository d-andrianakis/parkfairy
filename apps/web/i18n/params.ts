import type { Locale } from '@parkfairy/contracts';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

export interface LocaleParams {
  params: Promise<{ locale: string }>;
}

/** The validated locale of a `[locale]` route (layouts reject unknown ones with a 404). */
export async function localeFromParams(params: LocaleParams['params']): Promise<Locale> {
  const { locale } = await params;
  return hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
}
