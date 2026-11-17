'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ListingStatus } from '@parkfairy/api-client';
import {
  type AdminChangesInput,
  AdminChangesInputSchema,
  OWNER_LIMITS,
} from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { FieldDescription, FieldGroup, FieldLabel } from '@parkfairy/ui/components/field';
import { Textarea } from '@parkfairy/ui/components/textarea';
import { useTranslations } from 'next-intl';
import { type FormEvent, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { FocusHeading } from '@/components/focus-heading';
import { FormError } from '@/components/form-error';
import { PlainField, PlainFieldError } from '@/components/plain-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { approve, requestChanges, useAdminError } from '@/lib/admin-client';
import type { Outcome } from '@/lib/api-call';
import { useValidationMessage } from '@/lib/use-validation-message';

type Done = 'approved' | 'changes';

/**
 * Staff's decision on a listing waiting for one: approve it (after asking again, since that
 * publishes it) or send it back with a note the owner reads. Either is final for this review, so
 * the buttons give way to a heading that takes the focus and says what was recorded.
 */
export function DecisionPanel({
  id,
  canDecide,
  own,
  status,
}: {
  id: string;
  canDecide: boolean;
  own: boolean;
  status: ListingStatus;
}) {
  const t = useTranslations('AdminReview');
  const router = useRouter();
  const [done, setDone] = useState<Done | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adminError = useAdminError();
  const approveButton = useRef<HTMLButtonElement>(null);
  const question = useRef<HTMLParagraphElement>(null);

  if (done) {
    return (
      <div className="grid gap-2">
        <FocusHeading level="h3">{t(`done.${done}.title`)}</FocusHeading>
        <p className="text-sm text-muted-foreground">{t(`done.${done}.text`)}</p>
      </div>
    );
  }
  if (own) return <Notice>{t('own')}</Notice>;
  if (!canDecide) return <Notice>{t('notWaiting', { status: t(`status.${status}`) })}</Notice>;

  function finished(outcome: Outcome<unknown>, result: Done) {
    if (outcome.ok) {
      setDone(result);
      router.refresh();
      return;
    }
    setError(adminError(outcome.failure, outcome.status));
    // Decided by someone else meanwhile: the page behind this panel is out of date.
    if (outcome.failure.code === 'NOT_IN_REVIEW') router.refresh();
  }

  async function confirmApproval() {
    if (busy) return;
    setBusy(true);
    setError(null);
    finished(await approve(id), 'approved');
    setBusy(false);
  }

  return (
    <div className="grid gap-8">
      <section aria-labelledby="approve-heading" className="grid gap-3">
        <h3 id="approve-heading" className="font-semibold">
          {t('approve.heading')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('approve.text')}</p>
        {asking ? (
          <div role="group" aria-labelledby="approve-question" className="grid gap-3">
            <p
              ref={question}
              id="approve-question"
              tabIndex={-1}
              className="rounded-sm font-medium outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {t('approve.question')}
            </p>
            <div className="flex flex-wrap gap-2">
              {/* aria-disabled, not disabled: a disabled button drops keyboard focus to <body>. */}
              <Button type="button" aria-disabled={busy || undefined} onClick={confirmApproval}>
                {busy ? t('approve.busy') : t('approve.confirm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAsking(false);
                  // The button that asked is back after this render; put the focus on it.
                  requestAnimationFrame(() => approveButton.current?.focus());
                }}
              >
                {t('approve.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              ref={approveButton}
              type="button"
              onClick={() => {
                setError(null);
                setAsking(true);
                // The button that was pressed goes with this render; the question is read next.
                requestAnimationFrame(() => question.current?.focus());
              }}
            >
              {t('approve.button')}
            </Button>
          </div>
        )}
        {asking ? <FormError message={error} /> : null}
      </section>

      <ChangesForm
        id={id}
        onDone={(outcome) => finished(outcome, 'changes')}
        error={asking ? null : error}
        clearError={() => setError(null)}
      />
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    // Said on the page, not announced as it loads: it is not an error.
    <Alert role="note">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function ChangesForm({
  id,
  onDone,
  error,
  clearError,
}: {
  id: string;
  onDone: (outcome: Outcome<unknown>) => void;
  error: string | null;
  clearError: () => void;
}) {
  const t = useTranslations('AdminReview');
  const validationMessage = useValidationMessage();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AdminChangesInput>({
    resolver: zodResolver(AdminChangesInputSchema),
    defaultValues: { note: '' },
  });
  const status = useInvalidSubmitStatus();
  const onSubmit = handleSubmit(async ({ note }) => {
    status.clear();
    clearError();
    onDone(await requestChanges(id, note));
  }, status.onInvalid);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };
  const noteError = validationMessage(errors.note?.message);
  const hint = t('changes.hint', { max: OWNER_LIMITS.reviewNote });

  return (
    <section aria-labelledby="changes-heading" className="grid gap-3">
      <h3 id="changes-heading" className="font-semibold">
        {t('changes.heading')}
      </h3>
      <p className="text-sm text-muted-foreground">{t('changes.text')}</p>
      <form method="post" onSubmit={submit} noValidate>
        <FieldGroup>
          <FormError message={error} />
          <PlainField data-invalid={noteError ? true : undefined}>
            <FieldLabel htmlFor="note">{t('changes.note')}</FieldLabel>
            <Textarea
              id="note"
              rows={5}
              aria-invalid={noteError ? true : undefined}
              aria-describedby={noteError ? 'note-hint note-error' : 'note-hint'}
              {...register('note')}
            />
            <FieldDescription id="note-hint">{hint}</FieldDescription>
            {noteError ? <PlainFieldError id="note-error">{noteError}</PlainFieldError> : null}
          </PlainField>
          <div>
            <Button type="submit" variant="outline" aria-disabled={isSubmitting || undefined}>
              {isSubmitting ? t('changes.busy') : t('changes.submit')}
            </Button>
          </div>
        </FieldGroup>
        {status.region}
      </form>
    </section>
  );
}
