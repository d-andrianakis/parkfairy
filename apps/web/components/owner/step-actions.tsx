'use client';

import { Button } from '@parkfairy/ui/components/button';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/**
 * The end of every step. The button stays focusable while saving (`aria-disabled`, repeats
 * ignored by the form), as on the other forms. With `onLater`, leaving saves first; without it
 * the step saves as it goes, so leaving is only a link.
 */
export function StepActions({
  saving,
  onLater,
  laterLabel,
  submitLabel,
}: {
  saving: boolean;
  onLater?: () => void;
  /** For a step that keeps nothing until its button: leaving must not sound like saving. */
  laterLabel?: string;
  submitLabel?: string;
}) {
  const t = useTranslations('Owner.step');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {onLater ? (
        <Button
          type="button"
          variant="ghost"
          className={WRAPPING_BUTTON}
          aria-disabled={saving || undefined}
          onClick={onLater}
        >
          {t('saveLater')}
        </Button>
      ) : (
        <Button asChild variant="ghost" className={WRAPPING_BUTTON}>
          <Link href="/owner">{laterLabel ?? t('saveLater')}</Link>
        </Button>
      )}
      <Button type="submit" className={WRAPPING_BUTTON} aria-disabled={saving || undefined}>
        {saving ? t('saving') : (submitLabel ?? t('saveContinue'))}
      </Button>
    </div>
  );
}
