'use client';

import { holdParkingSpace } from '@parkfairy/api-client';
import { HOLD_MINUTES } from '@parkfairy/contracts/validation';
import { Button } from '@parkfairy/ui/components/button';
import { Label } from '@parkfairy/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@parkfairy/ui/components/radio-group';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FormError } from '@/components/form-error';
import { useRouter } from '@/i18n/navigation';
import { attempt, useBookingError } from '@/lib/booking-client';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

export interface SpaceOption {
  id: string;
  /** The space's name, marked up in the listing's language by the server. */
  label: ReactNode;
  /** Its features and price for the stay, rendered by the server. */
  details: ReactNode;
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
}: {
  listing: string;
  start: string;
  end: string;
  spaces: SpaceOption[];
  /** The cheapest, picked to begin with, so one press books it. */
  initial: string;
  labelledBy: string;
}) {
  const t = useTranslations('BookSpace');
  const router = useRouter();
  const bookingError = useBookingError();
  const firstRadio = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ text: string; code?: string } | null>(null);
  const spaceId = spaces.some((space) => space.id === picked) ? picked : '';
  const noneLeft = spaces.length === 0;

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
    setSaving(true);
    setFailure(null);
    const outcome = await attempt(() =>
      holdParkingSpace({ body: { listing, spaceId, start, end } }),
    );
    if (outcome.ok && outcome.data) {
      router.push(`/bookings/${outcome.data.id}`);
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
                  aria-describedby={`space-${space.id}-details`}
                  className="mt-1"
                />
                <div className="grid min-w-0 gap-1">
                  <Label htmlFor={`space-${space.id}`} className="font-mono font-medium">
                    {space.label}
                  </Label>
                  <div id={`space-${space.id}-details`} className="grid gap-1 text-sm">
                    {space.details}
                  </div>
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
