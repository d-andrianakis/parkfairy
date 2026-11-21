'use client';

import { Button } from '@parkfairy/ui/components/button';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { timeOptions } from '@/i18n/formats';
import { canKeepPasses, forgetPass, keepPass, keptUntil } from '@/lib/offline-pass';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/**
 * "Keep this pass offline" (5A.3): an opt-in copy of this page on this device, until `until` (a day
 * after the stay), for a car park with no signal. It says what that keeps, and when it ends, and can
 * be taken away. Where the browser can't keep pages it says so instead of offering a button that fails.
 * What a press did is said in a status; the button stays where it is, so the focus stays with it.
 */
export function OfflinePass({
  path,
  until,
  owner,
}: {
  path: string;
  until: string;
  /** The account it is kept for: another account's visit takes it off the device. */
  owner: string;
}) {
  const t = useTranslations('Pass');
  const format = useFormatter();
  const locale = useLocale();
  // What the browser can do isn't known to the server: nothing is drawn until hydration says.
  const support = useSyncExternalStore(
    () => () => undefined,
    () => (canKeepPasses() ? 'yes' : 'no'),
    () => 'unknown',
  );
  const [kept, setKept] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState(false);

  // What it already holds on this device is read once it is known that it can hold anything.
  useEffect(() => {
    if (support === 'yes') void keptUntil(path).then(setKept);
  }, [path, support]);

  /** Said again even when it repeats the last: the status is emptied first. */
  function say(text: string) {
    setStatus('');
    requestAnimationFrame(() => setStatus(text));
  }

  // The site's own clock (24-hour in Greek), in the zone the booking's times are shown in.
  const when = (date: Date) =>
    format.dateTime(date, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...timeOptions(locale),
    });

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setFailure(false);
    try {
      if (kept) {
        await forgetPass(path);
        setKept(null);
        say(t('removed'));
      } else {
        const end = new Date(until);
        await keepPass(path, end, owner);
        setKept(end);
        say(t('kept', { when: when(end) }));
      }
    } catch {
      setFailure(true);
    } finally {
      setBusy(false);
    }
  }

  if (support === 'unknown') return null;
  if (support === 'no') {
    return <p className="text-sm text-muted-foreground">{t('unsupported')}</p>;
  }
  return (
    <div className="grid justify-items-start gap-2">
      <Button
        type="button"
        variant="outline"
        className={WRAPPING_BUTTON}
        aria-describedby="offline-pass-hint"
        aria-disabled={busy || undefined}
        onClick={() => void toggle()}
      >
        {busy ? t(kept ? 'removing' : 'keeping') : kept ? t('removeOffline') : t('keepOffline')}
      </Button>
      {/* Always said, kept or not: it is what a driver weighs when deciding to take it away. */}
      <p id="offline-pass-hint" className="text-sm text-muted-foreground">
        {t('keepHint')}
      </p>
      {kept ? <p className="text-sm font-medium">{t('kept', { when: when(kept) })}</p> : null}
      <p role="status" className="sr-only">
        {status}
      </p>
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {t('error')}
        </p>
      ) : null}
    </div>
  );
}
