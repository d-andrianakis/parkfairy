'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FieldErrors, FieldValues } from 'react-hook-form';

/**
 * Announces a failed submit. React Hook Form moves focus to the first invalid field, which a
 * screen reader then reads with its error; but when that field already had focus (Enter in it,
 * e.g. the one-field two-factor form) nothing changes and nothing is said. This polite status
 * says how many fields need attention. Render `region` inside the form, always, and call
 * `clear()` when a submit passes validation so the message never outlives the errors.
 */
export function useInvalidSubmitStatus() {
  const t = useTranslations('Forms');
  const [message, setMessage] = useState('');

  function onInvalid<T extends FieldValues>(errors: FieldErrors<T>) {
    const text = t('invalidSummary', { count: Object.keys(errors).length });
    // Clear first, so the same message is announced again on the next failed attempt.
    setMessage('');
    requestAnimationFrame(() => setMessage(text));
  }

  const clear = () => setMessage('');

  const region = (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
  return { onInvalid, clear, region };
}
