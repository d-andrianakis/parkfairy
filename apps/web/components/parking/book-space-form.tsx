'use client';

import { holdParkingSpace } from '@parkfairy/api-client';
import { type SizesCm, vehicleFitsSpace } from '@parkfairy/contracts/plates';
import { HOLD_MINUTES } from '@parkfairy/contracts/validation';
import { Button } from '@parkfairy/ui/components/button';
import { Label } from '@parkfairy/ui/components/label';
import { NativeSelect, NativeSelectOption } from '@parkfairy/ui/components/native-select';
import { RadioGroup, RadioGroupItem } from '@parkfairy/ui/components/radio-group';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/form-error';
import { getPathname, Link, useRouter } from '@/i18n/navigation';
import { attempt, useBookingError } from '@/lib/booking-client';
import { loadPage } from '@/lib/load-page';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

export interface SpaceOption {
  id: string;
  /** The space's name, marked up in the listing's language by the server. */
  label: ReactNode;
  /** Its features and price for the stay, rendered by the server. */
  details: ReactNode;
  /** The largest vehicle it takes; null is no stated limit, which fits anything (5A.1). */
  limits?: SizesCm;
}

/** One of the driver's saved vehicles, as the picker needs it: its name in a list, and its size. */
export interface VehicleOption extends SizesCm {
  id: string;
  label: string;
}

/**
 * The spaces free for the stay, one to pick (decision #9), and the press that holds it for ten
 * minutes (decision #3) before the booking's own page asks for the car. The labels come rendered
 * from the server, so this ships no catalog but its own few words. Another driver may take the
 * space first: then the page is read again and the space is gone. The refusal keeps its place, in
 * the same element, whatever the refresh brings; if it took the last space, the focus goes to the
 * section's heading (`labelledBy`, focusable), since the button pressed is gone. A space picked that
 * has gone isn't swapped for another in silence: nothing is picked, and Book asks for one.
 */
export function BookSpaceForm({
  listing,
  start,
  end,
  spaces,
  initial,
  labelledBy,
  vehicles = [],
}: {
  listing: string;
  start: string;
  end: string;
  spaces: SpaceOption[];
  /** The driver's saved vehicles (5A.2): the first is chosen to begin with. None is no choice shown. */
  vehicles?: VehicleOption[];
  /** The cheapest, picked to begin with, so one press books it. */
  initial: string;
  labelledBy: string;
}) {
  const t = useTranslations('BookSpace');
  const router = useRouter();
  const locale = useLocale();
  const bookingError = useBookingError();
  const firstRadio = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState(initial);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ text: string; code?: string } | null>(null);
  const spaceId = spaces.some((space) => space.id === picked) ? picked : '';
  const noneLeft = spaces.length === 0;
  const vehicle = vehicles.find((candidate) => candidate.id === vehicleId);
  /** Too small for the vehicle chosen: said by the space, and refused here before it is asked of the API. */
  const tooSmall = (space: SpaceOption) =>
    vehicle !== undefined && space.limits !== undefined && !vehicleFitsSpace(vehicle, space.limits);

  // The last space went with the refresh: the Book button pressed is gone too.
  useEffect(() => {
    if (noneLeft && failure) document.getElementById(labelledBy)?.focus();
  }, [noneLeft, failure, labelledBy]);

  async function book(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!spaceId) {
      setFailure({ text: t('pickOne') });
      firstRadio.current?.focus();
      return;
    }
    const chosen = spaces.find((space) => space.id === spaceId);
    if (vehicle && chosen && tooSmall(chosen)) {
      setFailure({ text: t('pickFits', { vehicle: vehicle.label }) });
      firstRadio.current?.focus();
      return;
    }
    setSaving(true);
    setFailure(null);
    const outcome = await attempt(() =>
      holdParkingSpace({
        body: { listing, spaceId, start, end, ...(vehicle ? { vehicleId: vehicle.id } : {}) },
      }),
    );
    if (outcome.ok && outcome.data) {
      if (outcome.data.checkout === 'payment') {
        loadPage(getPathname({ href: `/bookings/${outcome.data.id}`, locale }));
      } else {
        router.push(`/bookings/${outcome.data.id}`);
      }
      return;
    }
    const refusal = outcome.ok ? {} : outcome.failure;
    setFailure({ text: bookingError(refusal), code: refusal.code });
    setSaving(false);
    // What the space list shows has changed: read it again.
    if (refusal.code === 'SPACE_TAKEN' || refusal.code === 'SPACE_NOT_FOUND') router.refresh();
  }

  const taken = failure?.code === 'SPACE_TAKEN' || failure?.code === 'SPACE_NOT_FOUND';
  return (
    <div className="mt-3 grid gap-4">
      <FormError message={failure ? (noneLeft && taken ? t('noneLeft') : failure.text) : null} />
      {noneLeft ? null : (
        <form onSubmit={(event) => void book(event)} className="grid gap-4">
          {vehicles.length > 0 ? (
            <div className="grid max-w-sm gap-1.5">
              <Label htmlFor="book-vehicle">{t('vehicleLabel')}</Label>
              <NativeSelect
                id="book-vehicle"
                value={vehicleId}
                aria-describedby="book-vehicle-hint"
                onChange={(event) => {
                  setVehicleId(event.target.value);
                  if (failure?.code === undefined) setFailure(null);
                }}
                className="w-full"
              >
                <NativeSelectOption value="">{t('vehicleNone')}</NativeSelectOption>
                {vehicles.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <p id="book-vehicle-hint" className="text-sm text-muted-foreground">
                {t('vehicleHint')}{' '}
                <Link
                  href="/account/vehicles"
                  className="text-primary underline underline-offset-4"
                >
                  {t('manageVehicles')}
                </Link>
              </p>
            </div>
          ) : null}
          {/* What the vehicle chosen does to the list, said when it changes: the warnings are on the radios. */}
          <p role="status" className="sr-only">
            {vehicle && spaces.length > 0
              ? t('tooSmallCount', { count: spaces.filter(tooSmall).length })
              : ''}
          </p>
          <RadioGroup
            value={spaceId}
            onValueChange={(value) => {
              setPicked(value);
              if (failure?.code === undefined) setFailure(null);
            }}
            aria-labelledby={labelledBy}
            className="grid gap-2 sm:grid-cols-2"
          >
            {spaces.map((space, index) => (
              <div
                key={space.id}
                className="flex items-start gap-3 rounded-lg border px-3 py-2 has-[[data-state=checked]]:border-primary"
              >
                <RadioGroupItem
                  ref={index === 0 ? firstRadio : undefined}
                  id={`space-${space.id}`}
                  value={space.id}
                  aria-describedby={`space-${space.id}-details${tooSmall(space) ? ` space-${space.id}-fit` : ''}`}
                  className="mt-1"
                />
                <div className="grid min-w-0 gap-1">
                  <Label htmlFor={`space-${space.id}`} className="font-mono font-medium">
                    {space.label}
                  </Label>
                  <div id={`space-${space.id}-details`} className="grid gap-1 text-sm">
                    {space.details}
                  </div>
                  {tooSmall(space) ? (
                    // Words, not a colour: the space can still be looked at, and the refusal says why.
                    <p
                      id={`space-${space.id}-fit`}
                      className="text-sm font-medium text-destructive"
                    >
                      {t('tooSmall')}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </RadioGroup>
          <div className="grid gap-2">
            <div>
              <Button
                type="submit"
                className={WRAPPING_BUTTON}
                aria-disabled={saving || undefined}
                aria-describedby="book-space-hint"
              >
                {saving ? t('booking') : t('book')}
              </Button>
            </div>
            <p id="book-space-hint" className="text-sm text-muted-foreground">
              {t('holdHint', { minutes: HOLD_MINUTES })}
            </p>
          </div>
        </form>
      )}
    </div>
  );
}
