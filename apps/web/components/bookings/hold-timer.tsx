'use client';

import { extendMyHold } from '@parkfairy/api-client';
import { HOLD_MINUTES } from '@parkfairy/contracts/validation';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { Clock } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FormError } from '@/components/form-error';
import { useAnnouncer } from '@/components/use-announcer';
import { timeOptions } from '@/i18n/formats';
import { useRouter } from '@/i18n/navigation';
import { attempt, useBookingError } from '@/lib/booking-client';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/** How long before the hold ends the driver is warned: well past WCAG's 20 seconds. */
export const HOLD_WARNING_MS = 2 * 60_000;

/**
 * The hold's time limit, made adjustable (WCAG 2.2.1): confirming works only while it runs
 * (decision #37), so the driver can keep it for another HOLD_MINUTES at a press, up to the limit,
 * and is warned two minutes before it ends, without the focus moving from what they are doing.
 * When it ends the page is read again, and says so. No ticking clock: a countdown either speaks
 * all the time or never.
 */
export function HoldTimer({
  id,
  expiresAt,
  extensionsLeft,
}: {
  id: string;
  expiresAt: string;
  extensionsLeft: number;
}) {
  const t = useTranslations('Booking');
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const bookingError = useBookingError();
  const { announce, region } = useAnnouncer();
  const [until, setUntil] = useState(() => Date.parse(expiresAt));
  const [left, setLeft] = useState(extensionsLeft);
  const [warning, setWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const time = format.dateTime(new Date(until), timeOptions(locale));

  useEffect(() => {
    const now = Date.now();
    const warn = setTimeout(() => setWarning(true), Math.max(0, until - HOLD_WARNING_MS - now));
    // Ended: the server's page says so, and offers to choose again.
    const end = setTimeout(() => router.refresh(), Math.max(0, until - now));
    return () => {
      clearTimeout(warn);
      clearTimeout(end);
    };
  }, [until, router]);

  async function keep() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await attempt(() => extendMyHold({ path: { id } }));
    setBusy(false);
    if (outcome.ok && outcome.data) {
      const next = Date.parse(outcome.data.holdExpiresAt);
      setUntil(next);
      setLeft(outcome.data.holdExtensionsLeft);
      setWarning(false);
      announce(t('kept', { time: format.dateTime(new Date(next), timeOptions(locale)) }));
      // The sentence above, from the server, says the new time too.
      router.refresh();
      return;
    }
    setFailure(bookingError(outcome.ok ? {} : outcome.failure));
  }

  return (
    <div className="grid gap-3">
      {region}
      {warning ? (
        // The warning WCAG 2.2.1 asks for: spoken once, as it appears.
        <Alert>
          <Clock aria-hidden />
          <AlertDescription>{t('holdWarning', { time })}</AlertDescription>
        </Alert>
      ) : null}
      <FormError message={failure} />
      {left > 0 ? (
        <div>
          <Button
            type="button"
            variant="outline"
            className={WRAPPING_BUTTON}
            aria-disabled={busy || undefined}
            onClick={() => void keep()}
          >
            {busy ? t('keeping') : t('keep', { minutes: HOLD_MINUTES })}
          </Button>
        </div>
      ) : (
        <p className="text-sm">{t('holdLimit', { time })}</p>
      )}
    </div>
  );
}
