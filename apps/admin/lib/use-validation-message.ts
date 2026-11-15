'use client';

import { isValidationMessage } from '@parkfairy/contracts/validation';
import { useTranslations } from 'next-intl';

/** The messages the staff app's forms can produce; its catalog carries these and no others. */
const SHOWN = [
  'emailInvalid',
  'passwordRequired',
  'codeInvalid',
  'backupCodeRequired',
  'textTooLong',
  'invalid',
] as const;
type Shown = (typeof SHOWN)[number];

const isShown = (key: string): key is Shown => (SHOWN as readonly string[]).includes(key);

/**
 * Translates a Zod issue message (a key from `VALIDATION_MESSAGES`) for display. Anything this
 * app's forms don't produce falls back to a generic prompt instead of leaking untranslated text.
 */
export function useValidationMessage() {
  const t = useTranslations('Validation');
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    return t(isValidationMessage(message) && isShown(message) ? message : 'invalid');
  };
}
