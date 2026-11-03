'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { submitOwnerListing } from '@parkfairy/api-client';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormError } from '@/components/form-error';
import { useRouter } from '@/i18n/navigation';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { CheckboxField } from './fields';

export function SubmitListing({ id, resubmitting }: { id: string; resubmitting: boolean }) {
  const t = useTranslations('Owner.review');
  const router = useRouter();
  const message = useValidationMessage();
  const ownerError = useOwnerError();
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!confirmed) {
      setConfirmError(message('confirmRequired'));
      document.getElementById('confirm')?.focus();
      return;
    }
    setConfirmError(undefined);
    setFailure(null);
    setSaving(true);
    const outcome = await attempt(() =>
      submitOwnerListing({ path: { id }, body: { confirmed: true } }),
    );
    if (outcome.ok) {
      router.push('/owner');
      router.refresh();
    } else {
      setFailure(ownerError(outcome.failure));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <FieldGroup>
        <FormError message={failure} />
        <CheckboxField
          id="confirm"
          label={t('confirm')}
          checked={confirmed}
          error={confirmError}
          onChange={(value) => {
            setConfirmed(value);
            if (value) setConfirmError(undefined);
          }}
        />
        <div>
          <Button type="submit" className={WRAPPING_BUTTON} aria-disabled={saving || undefined}>
            {saving ? t('submitting') : resubmitting ? t('resubmit') : t('submit')}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
