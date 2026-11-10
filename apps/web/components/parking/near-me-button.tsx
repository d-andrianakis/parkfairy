'use client';

import { Button } from '@parkfairy/ui/components/button';
import { LocateFixed } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type MouseEvent } from 'react';

type State = 'idle' | 'locating' | 'denied' | 'unavailable';

function setField(form: HTMLFormElement, name: string, value: string) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
}

/**
 * Fills the search form's hidden position fields from the browser's location and submits.
 * Coordinates are rounded to ~100 m: precise enough to sort by distance, and that is all
 * that ends up in the shareable URL.
 */
export function NearMeButton() {
  const t = useTranslations('SearchForm');
  const [state, setState] = useState<State>('idle');
  const messageId = useId();

  function locate(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form || state === 'locating') return;
    if (!('geolocation' in navigator)) {
      setState('unavailable');
      return;
    }
    setState('locating');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setField(form, 'latitude', coords.latitude.toFixed(3));
        setField(form, 'longitude', coords.longitude.toFixed(3));
        setField(form, 'area', '');
        setField(form, 'place', '');
        setState('idle');
        form.requestSubmit();
      },
      (error) => setState(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { maximumAge: 5 * 60_000, timeout: 10_000 },
    );
  }

  const message = {
    idle: '',
    locating: t('locating'),
    denied: t('locationDenied'),
    unavailable: t('locationUnavailable'),
  }[state];

  return (
    <>
      <Button
        type="button"
        variant="outline"
        // Inside the location field, which turns its text red when invalid.
        className="text-foreground"
        onClick={locate}
        // Not `disabled`: that would drop keyboard focus to <body> while locating.
        aria-disabled={state === 'locating' || undefined}
        aria-describedby={message ? messageId : undefined}
      >
        <LocateFixed aria-hidden />
        {t('nearMe')}
      </Button>
      {/* Always in the accessibility tree (sr-only, not hidden, while empty), so screen
          readers announce each change. */}
      <p
        id={messageId}
        aria-live="polite"
        className="basis-full text-sm text-muted-foreground empty:sr-only"
      >
        {message}
      </p>
    </>
  );
}
