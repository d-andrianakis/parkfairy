'use client';

import { settleMyPayment } from '@parkfairy/api-client';
import { Button } from '@parkfairy/ui/components/button';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FocusHeading } from '@/components/focus-heading';
import { keepFocusThroughUrlChange } from '@/components/route-focus';
import { timeOptions } from '@/i18n/formats';
import { useRouter } from '@/i18n/navigation';
import { attempt } from '@/lib/booking-client';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/**
 * When the page looks again: soon, then less often, about six minutes in all. Under the settle
 * route's limit (ten a minute) with room for a press, and a look waits for the one before.
 */
export const LOOKS_MS = [
  3_000, 5_000, 10_000, 15_000, 30_000, 30_000, 60_000, 60_000, 60_000, 60_000,
];

type Seen = 'booked' | 'refunded' | 'unpaid' | 'waiting' | 'unknown';

/**
 * A payment the bank is still deciding on, or one the page came back to from the bank before
 * Stripe's webhook did. The page asks the API to settle it now and then, quietly (no look changes
 * what is announced, or the button), and moves on once there is something to say: booked,
 * refunded (decision #3), or not paid after all. A press says what it found.
 */
export function PaymentPending({
  id,
  focus,
  now = false,
}: {
  id: string;
  /** Just paid, or back from the bank: the heading takes the focus. */
  focus: boolean;
  /** Look at once (back from the bank), not after the first wait. */
  now?: boolean;
}) {
  const t = useTranslations('Booking');
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const [pressed, setPressed] = useState(false);
  const [said, setSaid] = useState('');
  const [stopped, setStopped] = useState(false);
  const inFlight = useRef(false);

  const look = useCallback(async (): Promise<Seen> => {
    if (inFlight.current) return 'unknown';
    inFlight.current = true;
    const outcome = await attempt(() => settleMyPayment({ path: { id } }));
    inFlight.current = false;
    if (!outcome.ok || !outcome.data) return 'unknown';
    const { status, payment } = outcome.data;
    if (status === 'confirmed') return 'booked';
    if (payment === 'refunding' || payment === 'refunded') return 'refunded';
    // Called off at Stripe (the hold lapsed, 4.2): it can't be paid now.
    if (payment === 'pending' || payment === 'canceled' || payment === null) return 'unpaid';
    return 'waiting';
  }, [id]);

  /** Somewhere new to say it; a look nobody asked for leaves the focus where it is. */
  const moveOn = useCallback(
    (seen: Seen, asked: boolean) => {
      if (seen === 'waiting' || seen === 'unknown') return false;
      if (!asked) keepFocusThroughUrlChange();
      router.replace(`/bookings/${id}?done=${seen === 'unpaid' ? 'unpaid' : 'paid'}`);
      return true;
    },
    [id, router],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let step = 0;
    let gone = false;
    const next = () => {
      if (gone) return;
      if (step >= LOOKS_MS.length) {
        setStopped(true);
        return;
      }
      timer = setTimeout(() => void run(), LOOKS_MS[step++]);
    };
    const run = async () => {
      // A hidden tab waits until it is seen again.
      if (document.hidden) {
        document.addEventListener('visibilitychange', run, { once: true });
        return;
      }
      const seen = await look();
      if (!gone && !moveOn(seen, false)) next();
    };
    if (now) void run();
    else next();
    return () => {
      gone = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', run);
    };
  }, [look, moveOn, now]);

  async function press() {
    if (pressed) return;
    setPressed(true);
    const seen = await look();
    setPressed(false);
    if (!moveOn(seen, true)) {
      setSaid(
        t('paymentStillChecking', { time: format.dateTime(new Date(), timeOptions(locale)) }),
      );
    }
  }

  return (
    <div className="grid gap-3">
      {focus ? (
        <FocusHeading className="text-xl">{t('paymentProcessing')}</FocusHeading>
      ) : (
        <h2 className="text-xl font-semibold">{t('paymentProcessing')}</h2>
      )}
      <p>{t('paymentProcessingLead')}</p>
      <div>
        <Button
          type="button"
          variant="outline"
          className={WRAPPING_BUTTON}
          // Its own presses only: a look in the background never makes it "unavailable".
          aria-disabled={pressed || undefined}
          onClick={() => void press()}
        >
          {t('checkAgain')}
        </Button>
      </div>
      {/* Said once, for a press or when the looks stop; empty until then. */}
      <p role="status" className="text-sm text-muted-foreground">
        {said || (stopped ? t('paymentChecksStopped') : '')}
      </p>
    </div>
  );
}
