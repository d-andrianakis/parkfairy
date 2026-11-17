'use client';

import {
  cancelMyBooking,
  confirmMyBooking,
  payForMyBooking,
  settleMyPayment,
} from '@parkfairy/api-client';
import type { CheckoutKind } from '@parkfairy/contracts';
import { isVehiclePlate, VEHICLE_PLATE_LIMITS } from '@parkfairy/contracts/plates';
import { Button } from '@parkfairy/ui/components/button';
import { useTranslations } from 'next-intl';
import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { placeTag } from '@/components/parking/place-words';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { Link, useRouter } from '@/i18n/navigation';
import { attempt, CHOOSE_AGAIN, useBookingError } from '@/lib/booking-client';
import { forgetPlate, recallPlate, rememberPlate } from '@/lib/remembered-plate';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/** The contract's rules for the plate, without loading zod for one field. */
function plateProblem(plate: string): 'plateRequired' | 'plateInvalid' | null {
  if (plate.trim() === '') return 'plateRequired';
  return isVehiclePlate(plate.trim()) ? null : 'plateInvalid';
}

/** Stripe's fields and Stripe.js, loaded only when the driver goes to pay (decision #49). */
const loadPaymentStep = () => import('./payment-step');
const PaymentStep = lazy(loadPaymentStep);

/** Where the focus goes and shows, though it is no control: the question asked in its place. */
const FOCUS_TARGET =
  'rounded-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * The car, and the press that turns the hold into a booking. Where drivers pay (`checkout` is
 * `payment`, decision #49), it keeps the plate and opens Stripe's Payment Element below; on a local
 * run without Stripe it is the stand-in that charges nothing (#33). Done, the page comes back with
 * its own notice, which takes the focus.
 * Letting the space go asks first, in place (the question takes the focus; "No, keep it" gives it
 * back), then returns the driver to the listing for the same times, which says the space went. A
 * plate typed on an earlier hold in this tab comes back filled in.
 */
export function ConfirmBooking({
  id,
  chooseAgainHref,
  space,
  spaceLocale,
  checkout = 'confirm',
  payment = null,
}: {
  id: string;
  chooseAgainHref: string;
  /** The space held, in the owner's language, for the question before letting it go. */
  space: string;
  spaceLocale: string;
  checkout?: CheckoutKind;
  /** For paying: Stripe's publishable key (null: none here) and the total, written out. */
  payment?: { publishableKey: string | null; amount: string } | null;
}) {
  const t = useTranslations('Booking');
  const validation = useValidationMessage();
  const bookingError = useBookingError();
  const router = useRouter();
  const invalid = useInvalidSubmitStatus();
  const plateRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<{ text: string; chooseAgain: boolean } | null>(null);
  const [busy, setBusy] = useState<'confirm' | 'release' | null>(null);
  /** Once the payment is asked for: the Payment Element's secret. */
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  /** A payment under way: letting the space go now would only mean a refund. */
  const [underWay, setUnderWay] = useState(false);
  const paying = checkout === 'payment';
  const [asking, setAsking] = useState(false);
  /** Counts the times "No, keep it" was pressed: each one gives the focus back. */
  const [returning, setReturning] = useState(0);
  const question = useRef<HTMLParagraphElement>(null);
  const releaseButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asking) question.current?.focus();
    else if (returning > 0) releaseButton.current?.focus();
  }, [asking, returning]);

  // After hydration, as storage isn't there for the server render: into the field itself, which
  // is the one place the plate lives (it is read when sent), unless something is typed already.
  useEffect(() => {
    const field = plateRef.current;
    const remembered = recallPlate();
    if (field && remembered && !field.value) field.value = remembered;
  }, []);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    // Kept with the payment: Enter in the field asks for nothing more.
    if (busy || clientSecret) return;
    setFailure(null);
    const plate = plateRef.current?.value ?? '';
    const problem = plateProblem(plate);
    if (problem) {
      setError(validation(problem));
      invalid.report(1);
      plateRef.current?.focus();
      return;
    }
    setError(undefined);
    invalid.clear();
    rememberPlate(plate.trim());
    if (paying && !payment?.publishableKey) {
      setFailure({ text: t('paymentUnavailable'), chooseAgain: false });
      return;
    }
    setBusy('confirm');
    if (paying) {
      const asked = await attempt(() =>
        payForMyBooking({ path: { id }, body: { vehiclePlate: plate.trim() } }),
      );
      if (asked.ok && asked.data) {
        if (asked.data.status === 'pending') {
          setClientSecret(asked.data.clientSecret);
          setBusy(null);
          // Going to pay may have kept the hold longer: the page's times say so.
          router.refresh();
          return;
        }
        // Paid already (another tab, a press before a reload): settled, not paid twice.
        await attempt(() => settleMyPayment({ path: { id } }));
        router.replace(`/bookings/${id}?done=paid`);
        return;
      }
      setBusy(null);
      if (!asked.ok) setFailureFrom(asked.failure);
      return;
    }
    const outcome = await attempt(() =>
      confirmMyBooking({ path: { id }, body: { vehiclePlate: plate.trim() } }),
    );
    if (outcome.ok) {
      forgetPlate();
      router.replace(`/bookings/${id}?done=confirmed`);
      return;
    }
    setBusy(null);
    setFailureFrom(outcome.failure);
  }

  function setFailureFrom(failure: Parameters<typeof bookingError>[0]) {
    const { code, message } = failure;
    if (code === 'VALIDATION_FAILED') {
      setError(validation(Array.isArray(message) ? message[0] : message));
      plateRef.current?.focus();
      return;
    }
    setFailure({ text: bookingError(failure), chooseAgain: CHOOSE_AGAIN.has(code ?? '') });
  }

  async function release() {
    if (busy) return;
    setFailure(null);
    setBusy('release');
    const outcome = await attempt(() => cancelMyBooking({ path: { id }, body: {} }));
    if (outcome.ok) {
      // The listing says the space went, and its notice takes the focus.
      router.push(`${chooseAgainHref}${chooseAgainHref.includes('?') ? '&' : '?'}released=1`);
      return;
    }
    setBusy(null);
    setFailure({ text: bookingError(outcome.failure), chooseAgain: false });
  }

  return (
    <>
      <form noValidate onSubmit={(event) => void confirm(event)} className="grid gap-4">
        {invalid.region}
        <FormField
          ref={plateRef}
          id="vehicle-plate"
          label={t('plateLabel')}
          hint={clientSecret ? t('plateKept') : t('plateHint')}
          error={error}
          // Kept as typed, so a hold that ends meanwhile costs no retyping (3.3.7).
          onChange={(event) => rememberPlate(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={VEHICLE_PLATE_LIMITS.input}
          className={`max-w-xs font-mono ${clientSecret ? 'bg-muted' : ''}`}
          // Kept with the payment once it is asked for; "Change" opens it again.
          readOnly={clientSecret !== null}
          // The payment's code, fetched while the plate is typed rather than after.
          onFocus={paying ? () => void loadPaymentStep() : undefined}
        />
        {clientSecret ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={WRAPPING_BUTTON}
              aria-disabled={underWay || undefined}
              onClick={() => {
                if (underWay) return;
                // Asked for again with the new plate: the same payment, kept with it.
                setClientSecret(null);
                plateRef.current?.focus();
              }}
            >
              {t('changePlate')}
            </Button>
          </div>
        ) : null}
        <FormError message={failure?.text ?? null}>
          {failure?.chooseAgain ? (
            <p>
              <Link href={chooseAgainHref} className="underline underline-offset-4">
                {t('chooseAnother')}
              </Link>
            </p>
          ) : null}
        </FormError>
        <div className="flex flex-wrap gap-2">
          {clientSecret ? null : (
            <Button
              type="submit"
              className={WRAPPING_BUTTON}
              aria-disabled={busy !== null || undefined}
            >
              {paying
                ? busy === 'confirm'
                  ? t('continuing')
                  : t('continueToPayment')
                : busy === 'confirm'
                  ? t('confirming')
                  : t('confirm')}
            </Button>
          )}
          {asking ? null : (
            <Button
              ref={releaseButton}
              type="button"
              variant="outline"
              className={WRAPPING_BUTTON}
              aria-disabled={busy !== null || underWay || undefined}
              onClick={() => {
                if (busy || underWay) return;
                setFailure(null);
                setAsking(true);
              }}
            >
              {t('release')}
            </Button>
          )}
        </div>
        {asking ? (
          <div className="grid gap-3">
            <p ref={question} tabIndex={-1} className={FOCUS_TARGET}>
              {t.rich('releaseQuestion', {
                space: placeTag(space, spaceLocale),
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                className={WRAPPING_BUTTON}
                aria-disabled={busy !== null || undefined}
                onClick={() => void release()}
              >
                {busy === 'release' ? t('releasing') : t('releaseConfirm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={WRAPPING_BUTTON}
                // Once the space is being let go, "keep it" would say what isn't true.
                aria-disabled={busy === 'release' || undefined}
                onClick={() => {
                  if (busy === 'release') return;
                  setAsking(false);
                  setReturning((times) => times + 1);
                }}
              >
                {t('releaseKeep')}
              </Button>
            </div>
          </div>
        ) : null}
      </form>
      {clientSecret && payment?.publishableKey ? (
        <Suspense fallback={<p role="status">{t('paymentLoading')}</p>}>
          <PaymentStep
            id={id}
            clientSecret={clientSecret}
            publishableKey={payment.publishableKey}
            amount={payment.amount}
            onPaying={setUnderWay}
          />
        </Suspense>
      ) : null}
    </>
  );
}
