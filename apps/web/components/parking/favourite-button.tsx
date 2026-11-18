'use client';

import { favouriteListing, unfavouriteListing } from '@parkfairy/api-client';
import { Button } from '@parkfairy/ui/components/button';
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { attempt } from '@/lib/api-call';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/** What a refusal says: the codes this button can meet, else the general one. */
function useFavouriteError() {
  const t = useTranslations('Favourites');
  return (code: string | undefined) =>
    code === 'FAVOURITES_LIMIT_REACHED' || code === 'LISTING_NOT_FOUND'
      ? t(`errors.${code}`)
      : t('errors.generic');
}

/**
 * The listing page's heart (5A.2): keeps the listing among the driver's favourites, or lets it go.
 * A toggle button, so its state is `aria-pressed` and its name stays "Favourite"; what a press did
 * is said once in a status, and a refusal stays beside the button until the next press. Shown to a
 * signed-in driver only, so the answer to a press is never a sign-in redirect.
 */
export function FavouriteButton({ slug, initial }: { slug: string; initial: boolean }) {
  const t = useTranslations('Favourites');
  const error = useFavouriteError();
  const [favourite, setFavourite] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await attempt(() =>
      favourite ? unfavouriteListing({ path: { slug } }) : favouriteListing({ path: { slug } }),
    );
    setBusy(false);
    if (!outcome.ok) {
      setFailure(error(outcome.failure.code));
      return;
    }
    setFavourite(outcome.data.favourite);
    // Said again even when it repeats the last: the status is emptied first.
    setStatus('');
    requestAnimationFrame(() => setStatus(t(outcome.data.favourite ? 'saved' : 'removedStatus')));
  }

  return (
    <div className="grid justify-items-start gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={WRAPPING_BUTTON}
        aria-pressed={favourite}
        aria-disabled={busy || undefined}
        onClick={() => void toggle()}
      >
        <Heart aria-hidden className={favourite ? 'fill-current' : undefined} />
        {t('toggle')}
      </Button>
      <p role="status" className="sr-only">
        {status}
      </p>
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Lets a favourite go from the favourites page. Its name is the visible words, and `describedBy`
 * points at the listing's name so two buttons read apart. Once it is gone the page comes back with
 * a notice that says so (`?removed=`), which takes the focus the button leaves.
 */
export function RemoveFavouriteButton({
  slug,
  describedBy,
}: {
  slug: string;
  describedBy: string;
}) {
  const t = useTranslations('Favourites');
  const error = useFavouriteError();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await attempt(() => unfavouriteListing({ path: { slug } }));
    if (!outcome.ok) {
      setBusy(false);
      setFailure(error(outcome.failure.code));
      return;
    }
    // A different address for each, so a second removal brings its own notice.
    router.replace(`/favourites?removed=${encodeURIComponent(slug)}`);
    router.refresh();
  }

  return (
    <div className="grid justify-items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={WRAPPING_BUTTON}
        aria-describedby={describedBy}
        aria-disabled={busy || undefined}
        onClick={() => void remove()}
      >
        {busy ? t('removing') : t('remove')}
      </Button>
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
