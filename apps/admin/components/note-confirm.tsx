'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@parkfairy/ui/components/button';
import { FieldDescription, FieldGroup, FieldLabel } from '@parkfairy/ui/components/field';
import { Textarea } from '@parkfairy/ui/components/textarea';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { ZodType } from 'zod';

import { FormError } from '@/components/form-error';
import { PlainField, PlainFieldError } from '@/components/plain-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useAdminError } from '@/lib/admin-client';
import type { Outcome } from '@/lib/api-call';
import { useValidationMessage } from '@/lib/use-validation-message';

export interface NoteConfirmLabels {
  note: string;
  hint: string;
  submit: string;
  question: string;
  confirm: string;
  busy: string;
  cancel: string;
}

/**
 * A change staff make to something of someone's, in two steps: a note, which the schema holds to its
 * rules, then one more question, since the person is told and the note stays in the audit log. The
 * question takes the focus when it appears; "not yet" gives it back to the note with what was
 * written. `extra` is whatever else the change asks (a choice), shown with the note.
 */
export function NoteConfirm({
  schema,
  labels,
  extra,
  run,
  onDone,
  onStale,
  onAttempt,
}: {
  /** What the note must be: the contract's own schema for it. */
  schema: ZodType<{ note: string }, { note: string }>;
  labels: NoteConfirmLabels;
  extra?: ReactNode;
  /** The call; its refusals are said in words. */
  run: (note: string) => Promise<Outcome<unknown>>;
  /** It went through. */
  onDone: () => void;
  /**
   * Whether the refusal says the page behind this is out of date (someone else got there first):
   * then it is the caller's to show, with the reason in words, and this shows no error of its own.
   */
  onStale?: (code: string | undefined, message: string) => boolean;
  /** A new attempt begins: what an earlier refusal left on the page is out of date. */
  onAttempt?: () => void;
}) {
  const id = useId();
  const validationMessage = useValidationMessage();
  const adminError = useAdminError();
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = useRef<HTMLParagraphElement>(null);
  const note = useRef<HTMLTextAreaElement | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ note: string }>({
    resolver: zodResolver(schema),
    defaultValues: { note: '' },
  });
  const status = useInvalidSubmitStatus();
  const { ref: registerRef, ...noteField } = register('note');
  const asked = asking !== null;
  // The form goes with the render that asks; the question is read next.
  useEffect(() => {
    if (asked) question.current?.focus();
  }, [asked]);

  const ask = handleSubmit(({ note: text }) => {
    status.clear();
    setError(null);
    setAsking(text);
  }, status.onInvalid);

  async function confirm() {
    if (busy || asking === null) return;
    setBusy(true);
    setError(null);
    onAttempt?.();
    const outcome = await run(asking);
    setBusy(false);
    if (outcome.ok) {
      onDone();
      return;
    }
    const message = adminError(outcome.failure, outcome.status);
    if (!onStale?.(outcome.failure.code, message)) setError(message);
  }

  const noteError = validationMessage(errors.note?.message);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  if (asking !== null) {
    return (
      <div className="grid gap-3">
        <p
          ref={question}
          tabIndex={-1}
          className="rounded-sm font-medium outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {labels.question}
        </p>
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          {/* aria-disabled, not disabled: a disabled button drops keyboard focus to <body>. */}
          <Button
            type="button"
            variant="destructive"
            // Wraps: a Greek label is longer than a phone's width (WCAG 1.4.10).
            className="h-auto min-h-9 py-2 text-start whitespace-normal"
            aria-disabled={busy || undefined}
            onClick={confirm}
          >
            {busy ? labels.busy : labels.confirm}
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
            {labels.cancel}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form method="post" noValidate onSubmit={(event) => void ask(event)}>
      <FieldGroup>
        <FormError message={error} />
        <PlainField data-invalid={noteError ? true : undefined}>
          <FieldLabel htmlFor={`${id}-note`}>{labels.note}</FieldLabel>
          <Textarea
            id={`${id}-note`}
            rows={3}
            aria-required="true"
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? `${hintId} ${errorId}` : hintId}
            {...noteField}
            ref={(element) => {
              registerRef(element);
              note.current = element;
            }}
          />
          <FieldDescription id={hintId}>{labels.hint}</FieldDescription>
          {noteError ? <PlainFieldError id={errorId}>{noteError}</PlainFieldError> : null}
        </PlainField>
        {extra}
        <div>
          <Button
            type="submit"
            variant="outline"
            className="h-auto min-h-9 py-2 text-start whitespace-normal"
          >
            {labels.submit}
          </Button>
        </div>
      </FieldGroup>
      {status.region}
    </form>
  );
}
