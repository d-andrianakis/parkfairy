'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import {
  deleteListingPhoto,
  reorderListingPhotos,
  updateListingPhoto,
} from '@parkfairy/api-client';
import {
  PHOTO_CONTENT_TYPES,
  PHOTO_LIMITS,
  PHOTO_WIDTHS,
  photoUrl,
  type OwnerListing,
  type OwnerPhoto,
} from '@parkfairy/contracts';
import { Badge } from '@parkfairy/ui/components/badge';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { Progress } from '@parkfairy/ui/components/progress';
import { ArrowLeft, ArrowRight, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ChangeEvent } from 'react';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useAnnouncer } from '@/components/use-announcer';
import { Link } from '@/i18n/navigation';
import { listingStepHref } from '@/lib/owner';
import { attempt, uploadFile, useOwnerError, type Outcome } from '@/lib/owner-client';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { useOptionalLabel } from './fields';
import { useFocusAfterRender } from './navigation';
import { SaveStatus, useAutosave } from './save-status';

const THUMBNAIL = PHOTO_WIDTHS[0];

interface Uploading {
  name: string;
  percent: number;
}

export function PhotosStep({ listing }: { listing: OwnerListing }) {
  const t = useTranslations('Owner.photos');
  const tStep = useTranslations('Owner.step');
  const ownerError = useOwnerError();
  const optional = useOptionalLabel();
  const { announce, region } = useAnnouncer();
  const focusAfter = useFocusAfterRender();
  const [photos, setPhotos] = useState<OwnerPhoto[]>(listing.photos);
  const [uploading, setUploading] = useState<Uploading | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const { state, autosave, remember } = useAutosave(async (photoId, alt) => {
    const outcome = await attempt(() =>
      updateListingPhoto({
        path: { id: listing.id, photoId },
        body: { alt: alt as string },
      }),
    );
    return outcome.ok;
  });

  useEffect(() => {
    for (const { id, alt } of listing.photos) remember(id, alt ?? '');
  }, [listing.photos, remember]);

  const remaining = PHOTO_LIMITS.maxPerListing - photos.length;
  // aria-disabled, never disabled: that would drop the focus from a control still in use.
  const unavailable = uploading !== null || remaining <= 0;

  /** One at a time: a phone on mobile data shouldn't push ten photos at once. */
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = ''; // so choosing the same file again fires a change
    const found: string[] = [];
    let added = 0;
    for (const file of files) {
      if (file.size > PHOTO_LIMITS.maxBytes) {
        found.push(t('tooLarge', { name: file.name }));
        continue;
      }
      setUploading({ name: file.name, percent: 0 });
      announce(t('uploading', { name: file.name }));
      const outcome: Outcome<OwnerPhoto> = await uploadFile(
        `/api/v1/owner/listings/${listing.id}/photos`,
        file,
        (percent) => setUploading({ name: file.name, percent }),
      );
      if (outcome.ok) {
        const photo = outcome.data;
        setPhotos((current) => [...current, photo]);
        added++;
      } else found.push(t('failed', { name: file.name, reason: ownerError(outcome.failure) }));
    }
    setUploading(null);
    setProblems(found);
    if (added > 0) announce(t('uploaded', { count: added }));
  }

  async function move(index: number, by: -1 | 1) {
    if (index + by < 0 || index + by >= photos.length) return;
    const moved = [...photos];
    const [photo] = moved.splice(index, 1);
    if (!photo) return;
    moved.splice(index + by, 0, photo);
    setPhotos(moved);
    announce(t('moved', { position: index + by + 1, total: moved.length }));
    const outcome = await attempt(() =>
      reorderListingPhotos({
        path: { id: listing.id },
        body: { ids: moved.map((item) => item.id) },
      }),
    );
    if (!outcome.ok) {
      setPhotos(photos);
      setProblems([ownerError(outcome.failure)]);
    }
  }

  async function remove(photo: OwnerPhoto) {
    const outcome = await attempt(() =>
      deleteListingPhoto({ path: { id: listing.id, photoId: photo.id } }),
    );
    if (outcome.ok) {
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      setProblems([]);
      announce(t('removed'));
      focusAfter('photo-chooser'); // the button that had the focus has gone
    } else setProblems([ownerError(outcome.failure)]);
  }

  return (
    <FieldGroup>
      {problems.length > 0 ? <FormError message={problems.join(' ')} /> : null}
      {region}
      <p className="text-sm text-muted-foreground">
        {t('tips', { max: PHOTO_LIMITS.maxPerListing })}
      </p>

      <FormField
        id="photo-chooser"
        label={t('choose')}
        hint={t('chooseHint', { remaining })}
        type="file"
        multiple
        accept={PHOTO_CONTENT_TYPES.join(',')}
        aria-disabled={unavailable || undefined}
        onClick={(event) => {
          if (unavailable) event.preventDefault();
        }}
        onChange={(event) => void upload(event)}
      />

      {uploading ? (
        <div className="grid gap-1">
          <p className="text-sm wrap-anywhere" aria-hidden>
            {t('uploadingPercent', { name: uploading.name, percent: uploading.percent })}
          </p>
          <Progress
            value={uploading.percent}
            aria-label={t('uploading', { name: uploading.name })}
          />
        </div>
      ) : null}

      {photos.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {photos.map((photo, index) => (
            <li key={photo.id} className="grid content-start gap-3 rounded-lg border p-3">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- stored sizes, no optimiser */}
                <img
                  src={photoUrl(photo.key, THUMBNAIL)}
                  alt={photo.alt || t('photoAlt', { number: index + 1 })}
                  lang={photo.alt ? listing.location.contentLocale : undefined}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  className="aspect-[3/2] w-full rounded-md object-cover"
                  style={{ backgroundColor: photo.color }}
                />
                {index === 0 ? <Badge className="absolute top-2 left-2">{t('cover')}</Badge> : null}
              </div>
              <FormField
                id={`photo-alt-${photo.id}`}
                label={optional(t('alt', { number: index + 1 }))}
                hint={t('altHint')}
                lang={listing.location.contentLocale}
                maxLength={PHOTO_LIMITS.alt}
                defaultValue={photo.alt ?? ''}
                onBlur={(event) => autosave(photo.id, event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={WRAPPING_BUTTON}
                  aria-disabled={index === 0 || undefined}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowLeft aria-hidden />
                  {t('earlier', { number: index + 1 })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={WRAPPING_BUTTON}
                  aria-disabled={index === photos.length - 1 || undefined}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowRight aria-hidden />
                  {t('later', { number: index + 1 })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={WRAPPING_BUTTON}
                  onClick={() => void remove(photo)}
                >
                  <Trash2 aria-hidden />
                  {t('remove', { number: index + 1 })}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      )}

      <SaveStatus state={state} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" className={WRAPPING_BUTTON}>
          <Link href="/owner">{tStep('saveLater')}</Link>
        </Button>
        {photos.length > 0 ? (
          <Button asChild className={WRAPPING_BUTTON}>
            <Link href={listingStepHref(listing.id, 'proof')}>{tStep('continue')}</Link>
          </Button>
        ) : null}
      </div>
    </FieldGroup>
  );
}
