'use client';

import { cancelListingBooking } from '@parkfairy/api-client';
import { Button } from '@parkfairy/ui/components/button';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FormError } from '@/components/form-error';
import { useRouter } from '@/i18n/navigation';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { ownerBookingsHref } from '@/lib/owner-href';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { useFocusAfterRender } from './navigation';

/**
 * Two presses, in place, as deleting a draft is: calling a booking off can't be undone, and the
 * driver is refunded in full and emailed (decision #27). Done, the page comes back without the card
 * (`?cancelled=`), and its notice takes the focus and says which booking went: a region in the card
 * would go with it, cut off by the focus moving.
 */
export function CancelListingBooking({
  listingId,
  bookingId,
  reference,
}: {
  listingId: string;
  bookingId: string;
  reference: string;
}) {
  const t = useTranslations('Owner.bookings');
  const router = useRouter();
  const ownerError = useOwnerError();
  const focusAfter = useFocusAfterRender();
  const question = useRef<HTMLParagraphElement>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const button = `cancel-${bookingId}`;

  useEffect(() => {
    if (asking) question.current?.focus();
  }, [asking]);

  async function cancel() {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const outcome = await attempt(() =>
      cancelListingBooking({ path: { id: listingId, bookingId } }),
    );
    if (outcome.ok) {
      router.replace(`${ownerBookingsHref(listingId)}?cancelled=${reference}`);
    } else {
      setFailure(ownerError(outcome.failure));
      setSaving(false);
    }
  }

  return (
    <>
      {asking ? (
        <div className="grid gap-2">
          <FormError message={failure} />
          <p
            ref={question}
            tabIndex={-1}
            className="rounded-sm text-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t('cancelQuestion', { reference })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className={WRAPPING_BUTTON}
              aria-disabled={saving || undefined}
              onClick={() => void cancel()}
            >
              {saving ? t('cancelling') : t('cancelConfirm')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={WRAPPING_BUTTON}
              onClick={() => {
                setAsking(false);
                focusAfter(button);
              }}
            >
              {t('cancelKeep')}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            id={button}
            type="button"
            variant="outline"
            size="sm"
            className={WRAPPING_BUTTON}
            onClick={() => setAsking(true)}
          >
            {t('cancel', { reference })}
          </Button>
        </div>
      )}
    </>
  );
}
