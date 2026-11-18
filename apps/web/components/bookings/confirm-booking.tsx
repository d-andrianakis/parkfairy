'use client';

import {
  cancelMyBooking,
  confirmMyBooking,
  payForMyBooking,
  type SavedVehicle,
  saveMyVehicle,
  settleMyPayment,
} from '@parkfairy/api-client';
import type { CheckoutKind } from '@parkfairy/contracts';
import {
  isVehiclePlate,
  normalizeVehiclePlate,
  VEHICLE_PLATE_LIMITS,
} from '@parkfairy/contracts/plates';
import { VEHICLE_LIMITS } from '@parkfairy/contracts/validation';
import { Button } from '@parkfairy/ui/components/button';
import { Label } from '@parkfairy/ui/components/label';
import { NativeSelect, NativeSelectOption } from '@parkfairy/ui/components/native-select';
import { useTranslations } from 'next-intl';
import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { CheckboxField } from '@/components/owner/fields';
import { placeTag } from '@/components/parking/place-words';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { Link, useRouter } from '@/i18n/navigation';
import { attempt, CHOOSE_AGAIN, useBookingError } from '@/lib/booking-client';
import { forgetPlate, recallPlate, rememberPlate } from '@/lib/remembered-plate';
import { useValidationMessage } from '@/lib/use-validation-message';
import { vehicleLabel } from '@/lib/vehicle-label';
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
  vehicles: savedVehicles = [],
  initialVehicleId = null,
}: {
  id: string;
  chooseAgainHref: string;
  /** The space held, in the owner's language, for the question before letting it go. */
  space: string;
  spaceLocale: string;
  checkout?: CheckoutKind;
  /** For paying: Stripe's publishable key (null: none here) and the total, written out. */
  payment?: { publishableKey: string | null; amount: string } | null;
  /** The driver's saved vehicles (5A.2): one to pick instead of typing a plate. */
  vehicles?: Pick<SavedVehicle, 'id' | 'plate' | 'name'>[];
  /** The vehicle the space was held for, offered first (null: the first saved one). */
  initialVehicleId?: string | null;
}) {
  const t = useTranslations('Booking');
  const validation = useValidationMessage();
  const bookingError = useBookingError();
  const router = useRouter();
  const invalid = useInvalidSubmitStatus();
  const plateRef = useRef<HTMLInputElement>(null);
  const vehicleRef = useRef<HTMLSelectElement>(null);
  /** The saved vehicles, which a vehicle saved here joins. */
  const [vehicles, setVehicles] = useState(savedVehicles);
  /** The saved vehicle chosen, or empty for a plate typed here. */
  const [choice, setChoice] = useState(
    vehicles.find((vehicle) => vehicle.id === initialVehicleId)?.id ?? vehicles[0]?.id ?? '',
  );
  const [saveIt, setSaveIt] = useState(false);
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
  /** Counts the presses of "Change": each puts the focus back on the car, once it can take it. */
  const [changing, setChanging] = useState(0);
  const question = useRef<HTMLParagraphElement>(null);
  const releaseButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asking) question.current?.focus();
    else if (returning > 0) releaseButton.current?.focus();
  }, [asking, returning]);

  // After the render that opens the car again: a select kept with the payment is disabled until then.
  useEffect(() => {
    if (changing > 0) (choice ? vehicleRef : plateRef).current?.focus();
    // Only a press of "Change" moves the focus, not a different car chosen after it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changing]);

  // After hydration, as storage isn't there for the server render: into the field itself, which
  // is the one place the plate lives (it is read when sent), unless something is typed already.
  useEffect(() => {
    const field = plateRef.current;
    const remembered = recallPlate();
    if (field && remembered && !field.value) field.value = remembered;
  }, [choice]);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    // Kept with the payment: Enter in the field asks for nothing more.
    if (busy || clientSecret) return;
    setFailure(null);
    // A saved vehicle is the answer by itself; otherwise the plate typed is read and checked.
    const plate = choice ? '' : (plateRef.current?.value ?? '');
    const problem = choice ? null : plateProblem(plate);
    if (problem) {
      setError(validation(problem));
      invalid.report(1);
      plateRef.current?.focus();
      return;
    }
    setError(undefined);
    invalid.clear();
    if (!choice) rememberPlate(plate.trim());
    if (paying && !payment?.publishableKey) {
      setFailure({ text: t('paymentUnavailable'), chooseAgain: false });
      return;
    }
    setBusy('confirm');
    const car = await carFor(plate.trim());
    if (paying) {
      const asked = await attempt(() => payForMyBooking({ path: { id }, body: car }));
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
    const outcome = await attempt(() => confirmMyBooking({ path: { id }, body: car }));
    if (outcome.ok) {
      forgetPlate();
      router.replace(`/bookings/${id}?done=confirmed`);
      return;
    }
    setBusy(null);
    setFailureFrom(outcome.failure);
  }

  /**
   * What says which car it is: the vehicle chosen, a saved one the typed plate is the same as, one
   * saved now because the driver asked, or the plate alone. A saved vehicle is what the API checks
   * against the space (5A.2), so a typed plate that is one is sent as it. A save that fails (the
   * list is full, or it was saved in another tab) only means the booking goes ahead with the plate.
   */
  async function carFor(plate: string): Promise<{ vehicleId: string } | { vehiclePlate: string }> {
    if (choice) return { vehicleId: choice };
    const normalized = normalizeVehiclePlate(plate);
    const same = vehicles.find((vehicle) => vehicle.plate === normalized);
    if (same) return { vehicleId: same.id };
    if (saveIt && vehicles.length < VEHICLE_LIMITS.perDriver) {
      const saved = await attempt(() => saveMyVehicle({ body: { plate } }));
      if (saved.ok) {
        setVehicles(saved.data.vehicles);
        const found = saved.data.vehicles.find((vehicle) => vehicle.plate === normalized);
        if (found) return { vehicleId: found.id };
      }
    }
    return { vehiclePlate: plate };
  }

  function setFailureFrom(failure: Parameters<typeof bookingError>[0]) {
    const { code, message } = failure;
    // With a saved vehicle chosen there is no plate field to say it at.
    if (code === 'VALIDATION_FAILED' && plateRef.current) {
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
        {vehicles.length > 0 ? (
          <div className="grid max-w-sm gap-1.5">
            <Label htmlFor="booking-vehicle">{t('vehicleLabel')}</Label>
            <NativeSelect
              ref={vehicleRef}
              id="booking-vehicle"
              value={choice}
              aria-describedby={choice ? 'booking-vehicle-chosen' : undefined}
              // Kept with the payment once it is asked for; "Change" opens it again.
              disabled={clientSecret !== null}
              onChange={(event) => {
                setChoice(event.target.value);
                setFailure(null);
                setError(undefined);
              }}
              onFocus={paying ? () => void loadPaymentStep() : undefined}
              className="w-full"
            >
              {vehicles.map((vehicle) => (
                <NativeSelectOption key={vehicle.id} value={vehicle.id}>
                  {vehicleLabel(vehicle)}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value="">{t('vehicleOther')}</NativeSelectOption>
            </NativeSelect>
            {choice ? (
              <p id="booking-vehicle-chosen" className="text-sm text-muted-foreground">
                {t('vehicleChosen', {
                  plate: vehicles.find((vehicle) => vehicle.id === choice)?.plate ?? '',
                })}{' '}
                {clientSecret ? t('plateKept') : null}
              </p>
            ) : null}
          </div>
        ) : null}
        {choice ? null : (
          <>
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
            {vehicles.length < VEHICLE_LIMITS.perDriver ? (
              <CheckboxField
                id="booking-save-vehicle"
                label={t('saveVehicle')}
                checked={saveIt}
                onChange={setSaveIt}
                disabled={clientSecret !== null}
              />
            ) : null}
          </>
        )}
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
                setChanging((times) => times + 1);
              }}
            >
              {t(choice ? 'changeVehicle' : 'changePlate')}
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
