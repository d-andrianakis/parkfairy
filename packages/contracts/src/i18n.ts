import { z } from 'zod';
import { SUPPORTED_LOCALES } from './locales.js';
import { contractsRegistry } from './registry.js';

export * from './locales.js';

export const LocaleSchema = z.enum(SUPPORTED_LOCALES).register(contractsRegistry, {
  id: 'Locale',
  description: 'BCP 47 language tag of a supported UI locale.',
});
