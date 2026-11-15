import { useTranslations } from 'next-intl';

/** A value nobody gave: a dash for the eye, and "not given" for a screen reader, which skips a dash. */
export function None() {
  const t = useTranslations('Admin');
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">{t('notGiven')}</span>
    </>
  );
}
