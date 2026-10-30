'use client';

import { isValidationMessage } from '@parkfairy/contracts';
import { useTranslations } from 'next-intl';
import { validationArgs } from './validation-args';

/**
 * Translates a Zod issue message (a key from `VALIDATION_MESSAGES`) for display.
 * Unknown messages fall back to a generic prompt instead of leaking untranslated text.
 */
export function useValidationMessage() {
  const t = useTranslations('Validation');
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    const key = isValidationMessage(message) ? message : 'invalid';
    return t(key, validationArgs(key));
  };
}
