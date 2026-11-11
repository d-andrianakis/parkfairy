'use client';

import { createOwnerListing, deleteOwnerListing } from '@parkfairy/api-client';
import { Button } from '@parkfairy/ui/components/button';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FormError } from '@/components/form-error';
import { placeTag } from '@/components/parking/place-words';
import { useRouter } from '@/i18n/navigation';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { listingStepHref } from '@/lib/owner-href';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { useFocusAfterRender, useStepNavigation } from './navigation';

/** Starts a draft on the server and opens its first step. */
export function NewListingButton({ label }: { label: string }) {
  const go = useStepNavigation();
  const ownerError = useOwnerError();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function create() {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const outcome = await attempt(() => createOwnerListing());
    if (outcome.ok && outcome.data) go(listingStepHref(outcome.data.id, 'location'));
    else {
      setFailure(ownerError(outcome.ok ? {} : outcome.failure));
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3">
      <FormError message={failure} />
      <div>
        <Button
          type="button"
          className={WRAPPING_BUTTON}
          aria-disabled={saving || undefined}
          onClick={() => void create()}
        >
          <Plus aria-hidden />
          {label}
        </Button>
      </div>
    </div>
  );
}

/**
 * Two presses, in place: a draft may hold hours of work, and there is no undo. The question takes
 * the focus, which is what makes it read out. Once the draft is gone the card goes with it, so
 * the region here speaks first and the focus moves up to the page's heading.
 */
export function DeleteDraftButton({
  id,
  name,
  contentLocale,
}: {
  id: string;
  name: string | null;
  /** The language the owner wrote the name in. */
  contentLocale: string;
}) {
  const t = useTranslations('Owner.dashboard');
  // The owner's name for it, read in the language they wrote it in.
  const listing = placeTag(name ?? '', contentLocale);
  const router = useRouter();
  const ownerError = useOwnerError();
  const focusAfter = useFocusAfterRender();
  const question = useRef<HTMLParagraphElement>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const button = `delete-${id}`;

  useEffect(() => {
    if (asking) question.current?.focus();
  }, [asking]);

  async function remove() {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const outcome = await attempt(() => deleteOwnerListing({ path: { id } }));
    if (outcome.ok) {
      setDeleted(true);
      focusAfter('owner-heading');
      router.refresh();
    } else {
      setFailure(ownerError(outcome.failure));
      setSaving(false);
    }
  }

  return (
    <>
      <p role="status" className="sr-only">
        {deleted ? t('deleted') : null}
      </p>
      {asking ? (
        <div className="grid gap-2">
          <FormError message={failure} />
          <p ref={question} tabIndex={-1} className="text-sm outline-none">
            {name ? t.rich('deleteQuestion', { name, listing }) : t('deleteQuestionUnnamed')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className={WRAPPING_BUTTON}
              aria-disabled={saving || undefined}
              onClick={() => void remove()}
            >
              {t('deleteConfirm')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={WRAPPING_BUTTON}
              onClick={() => {
                setAsking(false);
                focusAfter(button);
              }}
            >
              {t('deleteCancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          id={button}
          type="button"
          variant="ghost"
          size="sm"
          className={WRAPPING_BUTTON}
          onClick={() => setAsking(true)}
        >
          <Trash2 aria-hidden />
          {/* One flex item: the button's gap would otherwise open around the name. */}
          <span>{name ? t.rich('deleteDraft', { name, listing }) : t('deleteDraftUnnamed')}</span>
        </Button>
      )}
    </>
  );
}
