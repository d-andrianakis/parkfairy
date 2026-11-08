'use client';

import { cancelMyBooking } from '@parkfairy/api-client';
import { Button } from '@parkfairy/ui/components/button';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FormError } from '@/components/form-error';
import { useRouter } from '@/i18n/navigation';
import { attempt, useBookingError } from '@/lib/booking-client';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

interface Refund {
  amountMinor: number;
  currency: string;
}

/** Where the focus goes and shows, though it is no control: the question asked in its place. */
const FOCUS_TARGET =
  'rounded-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * Two presses, in place, as deleting a draft is: the question says what comes back under the
 * booking's terms, and takes the focus so it is read. The API is told that amount: if the start has
 * come nearer and less comes back now, it refuses, the question says the new amount, and the next
 * press agrees to that. Done, the page comes back cancelled with its own notice. "Keep it" puts the
 * focus back on the first button.
 */
export function CancelBooking({ id, refund: shown }: { id: string; refund: Refund }) {
  const t = useTranslations('Booking');
  const format = useFormatter();
  const bookingError = useBookingError();
  const router = useRouter();
  const question = useRef<HTMLParagraphElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  const [returning, setReturning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [refund, setRefund] = useState(shown);
  const [changed, setChanged] = useState(false);
  const amount = format.number(refund.amountMinor / 100, {
    style: 'currency',
    currency: refund.currency,
  });

  useEffect(() => {
    if (asking) question.current?.focus();
    else if (returning) start.current?.focus();
  }, [asking, returning, changed]);

  async function cancel() {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const outcome = await attempt(() =>
      cancelMyBooking({ path: { id }, body: { expectedRefundMinor: refund.amountMinor } }),
    );
    if (outcome.ok) {
      router.replace(`/bookings/${id}?done=cancelled`);
      return;
    }
    setSaving(false);
    const now = outcome.failure.refund;
    if (outcome.failure.code === 'REFUND_CHANGED' && now) {
      // Asked again, with what comes back now; the focus goes to the new question.
      setRefund(now);
      setChanged((was) => !was);
      return;
    }
    setFailure(bookingError(outcome.failure));
  }

  if (!asking) {
    return (
      <div>
        <Button
          ref={start}
          type="button"
          variant="outline"
          className={WRAPPING_BUTTON}
          onClick={() => setAsking(true)}
        >
          {t('cancel')}
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <FormError message={failure} />
      <p ref={question} tabIndex={-1} className={FOCUS_TARGET}>
        {refund.amountMinor < shown.amountMinor
          ? t('refundChanged', { refund: amount })
          : refund.amountMinor > 0
            ? t('cancelQuestion', { refund: amount })
            : t('cancelQuestionNoRefund')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          className={WRAPPING_BUTTON}
          aria-disabled={saving || undefined}
          onClick={() => void cancel()}
        >
          {saving ? t('cancelling') : t('cancelConfirm')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={WRAPPING_BUTTON}
          onClick={() => {
            setAsking(false);
            setReturning(true);
          }}
        >
          {t('cancelKeep')}
        </Button>
      </div>
    </div>
  );
}
