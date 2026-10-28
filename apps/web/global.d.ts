import type { routing } from './i18n/routing';
import type messages from './messages/en.json';

// English is the reference catalog: every key used in code must exist in it, and the
// catalog parity test keeps the other locales identical in shape.
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
