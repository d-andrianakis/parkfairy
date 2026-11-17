'use client';

import { reportOverstay } from '@parkfairy/api-client';
import { Button } from '@parkfairy/ui/components/button';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/form-error';
import { useRouter } from '@/i18n/navigation';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

import { TextareaField } from './fields';
import { useFocusAfterRender } from './navigation';

/**
 * What a past booking says about a car left past its stay (5.2c4, #11, #76): the report so far, or
 * a way to make one. The owner writes what they saw, in a form opened in place; the report goes to
 * staff and to nobody else, and the driver isn't told. Sent, the list is refreshed behind this and
 * the line that says so stays, because the refreshed row no longer offers the button the focus was on.
 */
export function OverstayReport({
  listingId,
  bookingId,
  reference,
  canReport,
  overstay,
  noteMax,
}: {
  listingId: string;
  bookingId: string;
  reference: string;
  canReport: boolean;
  overstay: { reportedAt: string; status: 'open' | 'resolved' } | null;
  /** The longest note the API takes: said in the hint, which the server then enforces. */
  noteMax: number;
}) {
  const t = useTranslations('Owner.bookingList.overstay');
  const format = useFormatter();
  const router = useRouter();
  const ownerError = useOwnerError();
  const focusAfter = useFocusAfterRender();
  const sentLine = useRef<HTMLParagraphElement>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const button = `overstay-${bookingId}`;
  const field = `overstay-note-${bookingId}`;

  useEffect(() => {
    if (sent) sentLine.current?.focus();
  }, [sent]);
  // Opening the form puts the cursor where the owner writes.
  useEffect(() => {
    if (asking) document.getElementById(field)?.focus();
  }, [asking, field]);

  if (sent) {
    return (
      <p
        ref={sentLine}
        tabIndex={-1}
        role="status"
        className="rounded-sm text-sm focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {t('sent')}
      </p>
    );
  }
  if (overstay) {
    return (
      <p className="text-sm">
        {t(overstay.status === 'resolved' ? 'closed' : 'reported', {
          date: format.dateTime(new Date(overstay.reportedAt), { dateStyle: 'long' }),
        })}
      </p>
    );
  }
  if (!canReport) return null;

  if (!asking) {
    return (
      <div>
        <Button
          id={button}
          type="button"
          variant="outline"
          size="sm"
          className={WRAPPING_BUTTON}
          onClick={() => setAsking(true)}
        >
          {t.rich('report', {
            reference,
            // Which booking, for a list of buttons read out of their cards.
            hidden: (chunks) => <span className="sr-only">{chunks}</span>,
          })}
        </Button>
      </div>
    );
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (note.trim() === '') {
      setProblem(t('noteRequired'));
      document.getElementById(field)?.focus();
      return;
    }
    setProblem(null);
    setFailure(null);
    setSaving(true);
    const outcome = await attempt(() =>
      reportOverstay({ path: { id: listingId, bookingId }, body: { note } }),
    );
    if (outcome.ok) {
      setSent(true);
      router.refresh();
    } else {
      setFailure(ownerError(outcome.failure));
      setSaving(false);
    }
  }

  return (
    <form
      aria-label={t('formLabel', { reference })}
      onSubmit={(event) => void send(event)}
      noValidate
      className="grid gap-3"
    >
      <p className="text-sm">{t('lead')}</p>
      <TextareaField
        id={field}
        label={t('noteLabel')}
        hint={t('noteHint', { max: noteMax })}
        error={problem ?? undefined}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
          setProblem(null);
        }}
        aria-required="true"
        rows={4}
      />
      <FormError message={failure} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          className={WRAPPING_BUTTON}
          aria-disabled={saving || undefined}
        >
          {saving ? t('sending') : t('submit')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={WRAPPING_BUTTON}
          aria-disabled={saving || undefined}
          onClick={() => {
            // A report on its way can't be taken back: the form stays until it has landed or failed.
            if (saving) return;
            setAsking(false);
            setProblem(null);
            setFailure(null);
            focusAfter(button);
          }}
        >
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
