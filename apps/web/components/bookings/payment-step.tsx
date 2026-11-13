'use client';

import { settleMyPayment } from '@parkfairy/api-client';
import { Button } from '@parkfairy/ui/components/button';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
// The pure entry: nothing is loaded until `loadStripe` is called (the main one loads on import).
import type { Stripe } from '@stripe/stripe-js';
import { loadStripe } from '@stripe/stripe-js/pure';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { FocusHeading } from '@/components/focus-heading';
import { FormError } from '@/components/form-error';
import { getPathname, useRouter } from '@/i18n/navigation';
import { attempt } from '@/lib/booking-client';
import { setPaying } from '@/lib/payment-progress';
import { forgetPlate } from '@/lib/remembered-plate';
import { stripeAppearance } from '@/lib/stripe-appearance';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/** One Stripe.js per key and language, loaded the first time a driver goes to pay. */
const loaded = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string, locale: 'el' | 'en'): Promise<Stripe | null> {
  const id = `${key}:${locale}`;
  let stripe = loaded.get(id);
  if (!stripe) {
    // A failure is forgotten, so "Try again" loads it again.
    stripe = loadStripe(key, { locale }).catch(() => {
      loaded.delete(id);
      return null;
    });
    loaded.set(id, stripe);
  }
  return stripe;
}

/** Dark as the page is: the theme chosen, or the system's when none was (`globals.css`). */
function useDark(): boolean {
  const read = () => {
    const root = document.documentElement.classList;
    if (root.contains('dark')) return true;
    if (root.contains('light')) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(read());
    media.addEventListener('change', update);
    // A theme switched on the page changes the root's class.
    const watcher = new MutationObserver(update);
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      media.removeEventListener('change', update);
      watcher.disconnect();
    };
  }, []);
  return dark;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Stripe's Payment Element and the press that pays (decision #49), loaded only when the driver
 * goes to pay: Stripe.js comes from Stripe, as its terms require, on the one page whose CSP allows
 * it. Card details never touch our pages. Paid, the page asks the API to settle the booking (the
 * webhook would too) and comes back with what happened: booked, still with the bank, or refunded.
 */
export default function PaymentStep({
  id,
  clientSecret,
  publishableKey,
  amount,
  onPaying,
}: {
  id: string;
  clientSecret: string;
  publishableKey: string;
  /** The total, written out in the page's language. */
  amount: string;
  /** Told when a payment is under way, and when it is over either way. */
  onPaying?: (paying: boolean) => void;
}) {
  const t = useTranslations('Booking');
  const locale = useLocale() as 'el' | 'en';
  const dark = useDark();
  const [stripe] = useState(() => stripeFor(publishableKey, locale));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void stripe.then((ready) => {
      if (live && !ready) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [stripe]);

  return (
    <section aria-labelledby="payment-heading" className="grid gap-4">
      <div className="grid gap-1">
        {/* It replaces the "Continue" press: the focus follows, unless the driver moved on. */}
        <FocusHeading id="payment-heading" className="text-xl">
          {t('paymentHeading')}
        </FocusHeading>
        <p>{t('paymentLead', { amount })}</p>
      </div>
      {failed ? (
        <LoadFailed
          onRetry={() => {
            // A fresh page load of Stripe.js is the only way to try again.
            window.location.reload();
          }}
        />
      ) : (
        <Elements
          stripe={stripe}
          options={{ clientSecret, locale, appearance: stripeAppearance(dark, reducedMotion()) }}
        >
          <PayForm
            id={id}
            amount={amount}
            onPaying={onPaying}
            onLoadError={() => setFailed(true)}
          />
        </Elements>
      )}
    </section>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('Booking');
  return (
    <div className="grid gap-3">
      <FormError message={t('paymentLoadFailed')} />
      <div>
        <Button type="button" variant="outline" className={WRAPPING_BUTTON} onClick={onRetry}>
          {t('paymentRetry')}
        </Button>
      </div>
    </div>
  );
}

function PayForm({
  id,
  amount,
  onPaying,
  onLoadError,
}: {
  id: string;
  amount: string;
  onPaying?: (paying: boolean) => void;
  onLoadError: () => void;
}) {
  const t = useTranslations('Booking');
  const locale = useLocale();
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Empty at first, so saying it is a change a screen reader reads; gone once ready.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 50);
    return () => clearTimeout(timer);
  }, []);
  const loading = shown && !ready ? t('paymentLoading') : '';

  const paying = (value: boolean) => {
    setBusy(value);
    setPaying(value);
    onPaying?.(value);
  };

  // Gone (the page moved on): nothing is under way any more.
  useEffect(() => () => setPaying(false), []);

  async function pay(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || !ready || busy) return;
    paying(true);
    setFailure(null);
    // Where a bank that needs its own page (3-D Secure) sends the driver back to.
    const back = getPathname({
      href: { pathname: `/bookings/${id}`, query: { done: 'paid' } },
      locale,
    });
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: new URL(back, window.location.origin).toString() },
    });
    if (error && (error.type === 'card_error' || error.type === 'validation_error')) {
      // Stripe's own words for a card or a field, in the driver's language.
      paying(false);
      setFailure(error.message ?? t('paymentFailed'));
      return;
    }
    // Paid, or not known: the API asks Stripe, and the page says what it found.
    const settled = await attempt(() => settleMyPayment({ path: { id } }));
    if (error) {
      const payment = settled.ok ? settled.data?.payment : undefined;
      const paid = payment !== undefined && payment !== 'pending' && payment !== 'canceled';
      if (!paid) {
        paying(false);
        // Called off at Stripe (the hold ended an hour ago): paying again can't work, so the
        // page says what happened instead of offering another try.
        if (payment === 'canceled') {
          router.replace(`/bookings/${id}?done=unpaid`);
          return;
        }
        setFailure(settled.ok ? t('paymentFailed') : t('paymentUncertain'));
        return;
      }
    }
    forgetPlate();
    router.replace(`/bookings/${id}?done=paid`);
  }

  return (
    <form noValidate onSubmit={(event) => void pay(event)} className="grid gap-4">
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {loading}
      </p>
      <PaymentElement onReady={() => setReady(true)} onLoadError={onLoadError} />
      <FormError message={failure} />
      {/* Only once the fields are there: a press before would do nothing, and say nothing. */}
      {ready ? (
        <div>
          <Button type="submit" className={WRAPPING_BUTTON} aria-disabled={busy || undefined}>
            {busy ? t('paying') : t('pay', { amount })}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
