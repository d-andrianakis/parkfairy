import { z } from 'zod';
import { contractsRegistry } from './registry.js';

/**
 * Locales the product ships in. Adding one requires: a message catalog in apps/web/messages,
 * a migration widening the `users_locale_check` constraint, and translated emails.
 */
export const SUPPORTED_LOCALES = ['el', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'el';

/** Marketplace home time zone: recurring schedules and displayed times use it unless a facility overrides it. */
export const DEFAULT_TIME_ZONE = 'Europe/Athens';

export const LocaleSchema = z.enum(SUPPORTED_LOCALES).register(contractsRegistry, {
  id: 'Locale',
  description: 'BCP 47 language tag of a supported UI locale.',
});

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
