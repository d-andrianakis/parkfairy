'use client';

import { holdParkingSpace } from '@parkfairy/api-client';
import { Button } from '@parkfairy/ui/components/button';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { FormError } from '@/components/form-error';
import { getPathname, Link, useRouter } from '@/i18n/navigation';
import { attempt, CHOOSE_AGAIN, useBookingError } from '@/lib/booking-client';
import { loadPage } from '@/lib/load-page';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/**
 * "Book again" on a stay that is over (5A.2): holds the same space, for the same car, for the stay
 * the page worked out (`rebookStay`), and goes to that booking's page for the plate and payment. The
 * space may have gone, or the listing closed that time; then the refusal is said here, with a way to
 * the listing page for the same times, where another space can be picked.
 */
export function RebookButton({
  listing,
  spaceId,
  vehicleId,
  start,
  end,
  chooseHref,
  describedBy,
}: {
  listing: string;
  spaceId: string;
  vehicleId: string | null;
  start: string;
  end: string;
  /** The listing page filled in with this stay: where another space can be chosen. */
  chooseHref: string;
  /** The text that says which times this is, so each button reads apart from the others. */
  describedBy: string;
}) {
  const t = useTranslations('Rebook');
  const router = useRouter();
  const locale = useLocale();
  const bookingError = useBookingError();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ text: string; chooseAgain: boolean } | null>(null);

  async function rebook() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await attempt(() =>
      holdParkingSpace({
        body: { listing, spaceId, start, end, ...(vehicleId ? { vehicleId } : {}) },
      }),
    );
    if (outcome.ok && outcome.data) {
      // Where drivers pay, the booking page is a real load: its policy is the one Stripe needs.
      if (outcome.data.checkout === 'payment') {
        loadPage(getPathname({ href: `/bookings/${outcome.data.id}`, locale }));
      } else {
        router.push(`/bookings/${outcome.data.id}`);
      }
      return;
    }
    const refusal = outcome.ok ? {} : outcome.failure;
    setBusy(false);
    setFailure({
      text: bookingError(refusal),
      chooseAgain: CHOOSE_AGAIN.has(refusal.code ?? ''),
    });
  }

  return (
    <div className="grid justify-items-start gap-2">
      <Button
        type="button"
        size="sm"
        className={WRAPPING_BUTTON}
        aria-describedby={describedBy}
        aria-disabled={busy || undefined}
        onClick={() => void rebook()}
      >
        {busy ? t('holding') : t('button')}
      </Button>
      <FormError message={failure?.text ?? null}>
        {failure?.chooseAgain ? (
          <p>
            <Link href={chooseHref} className="underline underline-offset-4">
              {t('chooseOther')}
            </Link>
          </p>
        ) : null}
      </FormError>
    </div>
  );
}
