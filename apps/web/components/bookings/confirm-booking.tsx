'use client';

import { cancelMyBooking, confirmMyBooking } from '@parkfairy/api-client';
import { isVehiclePlate, VEHICLE_PLATE_LIMITS } from '@parkfairy/contracts/plates';
import { Button } from '@parkfairy/ui/components/button';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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

/** Where the focus goes and shows, though it is no control: the question asked in its place. */
const FOCUS_TARGET =
  'rounded-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * The car, and the press that turns the hold into a booking: until Phase 4 it charges nothing
 * (decision #33). Done, the page comes back confirmed with its own notice, which takes the focus.
 * Letting the space go asks first, in place (the question takes the focus; "No, keep it" gives it
 * back), then returns the driver to the listing for the same times, which says the space went. A
 * plate typed on an earlier hold in this tab comes back filled in.
 */
export function ConfirmBooking({
  id,
  chooseAgainHref,
  space,
  spaceLocale,
}: {
  id: string;
  chooseAgainHref: string;
  /** The space held, in the owner's language, for the question before letting it go. */
  space: string;
  spaceLocale: string;
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
    if (busy) return;
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
    setBusy('confirm');
    rememberPlate(plate.trim());
    const outcome = await attempt(() =>
      confirmMyBooking({ path: { id }, body: { vehiclePlate: plate.trim() } }),
    );
    if (outcome.ok) {
      forgetPlate();
      router.replace(`/bookings/${id}?done=confirmed`);
      return;
    }
    setBusy(null);
    const { code, message } = outcome.failure;
    if (code === 'VALIDATION_FAILED') {
      setError(validation(Array.isArray(message) ? message[0] : message));
      plateRef.current?.focus();
      return;
    }
    setFailure({ text: bookingError(outcome.failure), chooseAgain: CHOOSE_AGAIN.has(code ?? '') });
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
    <form noValidate onSubmit={(event) => void confirm(event)} className="grid gap-4">
      {invalid.region}
      <FormField
        ref={plateRef}
        id="vehicle-plate"
        label={t('plateLabel')}
        hint={t('plateHint')}
        error={error}
        // Kept as typed, so a hold that ends meanwhile costs no retyping (3.3.7).
        onChange={(event) => rememberPlate(event.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={VEHICLE_PLATE_LIMITS.input}
        className="max-w-xs font-mono"
      />
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
        <Button
          type="submit"
          className={WRAPPING_BUTTON}
          aria-disabled={busy !== null || undefined}
        >
          {busy === 'confirm' ? t('confirming') : t('confirm')}
        </Button>
        {asking ? null : (
          <Button
            ref={releaseButton}
            type="button"
            variant="outline"
            className={WRAPPING_BUTTON}
            aria-disabled={busy !== null || undefined}
            onClick={() => {
              if (busy) return;
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
  );
}
