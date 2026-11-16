'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ADMIN_IDENTITY_NOTE_MAX,
  AdminRemoveTwoFactorInputSchema,
  type AdminRemoveTwoFactorInput,
} from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { FieldDescription, FieldGroup, FieldLabel } from '@parkfairy/ui/components/field';
import { Textarea } from '@parkfairy/ui/components/textarea';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { FocusHeading } from '@/components/focus-heading';
import { FormError } from '@/components/form-error';
import { PlainField, PlainFieldError } from '@/components/plain-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { removeTwoFactor, useAdminError } from '@/lib/admin-client';
import { useValidationMessage } from '@/lib/use-validation-message';

/**
 * Support's removal of an account's second factor, after an identity check (#13): a note of how the
 * person was identified, then one more question, since the person is signed out on every device and
 * the note stays in the audit log for good. Not offered on staff's own account or another staff
 * member's (recovered by hand), nor where there is nothing to remove: it says why instead.
 */
export function RemoveTwoFactorPanel({
  id,
  own,
  staff,
  twoFactorEnabled,
  canRemove,
}: {
  id: string;
  own: boolean;
  staff: boolean;
  twoFactorEnabled: boolean;
  canRemove: boolean;
}) {
  const t = useTranslations('AdminUser');
  const validationMessage = useValidationMessage();
  const adminError = useAdminError();
  const router = useRouter();
  const [asking, setAsking] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = useRef<HTMLParagraphElement>(null);
  const note = useRef<HTMLTextAreaElement | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdminRemoveTwoFactorInput>({
    resolver: zodResolver(AdminRemoveTwoFactorInputSchema),
    defaultValues: { note: '' },
  });
  const status = useInvalidSubmitStatus();
  const { ref: registerRef, ...noteField } = register('note');
  const asked = asking !== null;
  const notice = useRef<HTMLDivElement>(null);
  // A refusal that the page behind this panel then catches up with (someone removed it first) turns
  // the panel into a notice, which takes the focus its question and button had, with the reason.
  const [explained, setExplained] = useState<string | null>(null);
  const noticeShown = own || staff || !twoFactorEnabled || !canRemove;
  useEffect(() => {
    if (noticeShown && explained) notice.current?.focus();
  }, [noticeShown, explained]);
  // The form goes with the render that asks; the question is read next.
  useEffect(() => {
    if (asked) question.current?.focus();
  }, [asked]);

  if (done) {
    return (
      <div className="grid gap-2">
        <FocusHeading level="h3">{t('doneTitle')}</FocusHeading>
        <p className="text-sm text-muted-foreground">{t('doneText')}</p>
      </div>
    );
  }
  if (noticeShown) {
    return (
      <div ref={notice} tabIndex={-1} className="grid gap-3 outline-hidden">
        <FormError message={explained} />
        <Notice>{own ? t('own') : staff ? t('staff') : t('none')}</Notice>
      </div>
    );
  }

  const ask = handleSubmit(({ note: text }) => {
    status.clear();
    setError(null);
    setAsking(text);
  }, status.onInvalid);

  async function confirm() {
    if (busy || asking === null) return;
    setBusy(true);
    setError(null);
    const outcome = await removeTwoFactor(id, asking);
    setBusy(false);
    if (outcome.ok) {
      setDone(true);
      router.refresh();
      return;
    }
    const reason = adminError(outcome.failure, outcome.status);
    setError(reason);
    // Done by someone else meanwhile, or no longer possible: the page behind this is out of date.
    if (outcome.failure.code === 'NO_TWO_FACTOR' || outcome.failure.code === 'STAFF_ACCOUNT') {
      setExplained(reason);
      router.refresh();
    }
  }

  const noteError = validationMessage(errors.note?.message);
  const hint = t('hint', { max: ADMIN_IDENTITY_NOTE_MAX });

  return (
    <section aria-labelledby="remove-heading" className="grid gap-3">
      <h3 id="remove-heading" className="font-semibold">
        {t('heading')}
      </h3>
      <p className="max-w-prose text-sm text-muted-foreground">{t('text')}</p>
      {asking === null ? (
        <form
          method="post"
          noValidate
          onSubmit={(event: FormEvent<HTMLFormElement>) => void ask(event)}
        >
          <FieldGroup>
            <FormError message={error} />
            <PlainField data-invalid={noteError ? true : undefined}>
              <FieldLabel htmlFor="identity-note">{t('note')}</FieldLabel>
              <Textarea
                id="identity-note"
                aria-required="true"
                rows={3}
                aria-invalid={noteError ? true : undefined}
                aria-describedby={
                  noteError ? 'identity-note-hint identity-note-error' : 'identity-note-hint'
                }
                {...noteField}
                ref={(element) => {
                  registerRef(element);
                  note.current = element;
                }}
              />
              <FieldDescription id="identity-note-hint">{hint}</FieldDescription>
              {noteError ? (
                <PlainFieldError id="identity-note-error">{noteError}</PlainFieldError>
              ) : null}
            </PlainField>
            <div>
              <Button
                type="submit"
                variant="outline"
                className="h-auto min-h-9 py-2 text-start whitespace-normal"
              >
                {t('submit')}
              </Button>
            </div>
          </FieldGroup>
          {status.region}
        </form>
      ) : (
        <div className="grid gap-3">
          <p
            ref={question}
            id="remove-question"
            tabIndex={-1}
            className="rounded-sm font-medium outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t('question')}
          </p>
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            {/* aria-disabled, not disabled: a disabled button drops keyboard focus to <body>. */}
            <Button
              type="button"
              variant="destructive"
              className="h-auto min-h-9 py-2 text-start whitespace-normal"
              aria-disabled={busy || undefined}
              onClick={confirm}
            >
              {busy ? t('busy') : t('confirm')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-9 py-2 text-start whitespace-normal"
              onClick={() => {
                setAsking(null);
                setError(null);
                // The form is back after this render; put the focus on the note, with its text.
                requestAnimationFrame(() => note.current?.focus());
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </section>
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
