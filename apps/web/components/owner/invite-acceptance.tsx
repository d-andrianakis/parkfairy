'use client';

import {
  acceptListingInvite,
  previewListingInvite,
  type InvitePreview,
} from '@parkfairy/api-client';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FocusHeading } from '@/components/focus-heading';
import { FormError } from '@/components/form-error';
import { PersonName, placeTag } from '@/components/parking/place-words';
import { Link } from '@/i18n/navigation';
import { forgetInviteToken, takeInviteToken } from '@/lib/invite-token';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { ownersHref } from '@/lib/owner-href';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

type View =
  | { kind: 'reading' }
  | { kind: 'missing' }
  | { kind: 'not-found' }
  | { kind: 'unavailable' }
  | { kind: 'open'; preview: InvitePreview; token: string }
  | { kind: 'accepted'; listingId: string };

/** Kept for the tab before signing in: signed out, the page has nothing else to do with it. */
export function KeepInviteToken() {
  useEffect(() => {
    takeInviteToken();
  }, []);
  return null;
}

/**
 * The invite page, signed in (#56): what the invite is, and Accept for the account it was sent to.
 * The API decides who may accept; this only says what it said.
 */
export function InviteAcceptance() {
  const t = useTranslations('Owner.invite');
  const locale = useLocale();
  const ownerError = useOwnerError();
  const [view, setView] = useState<View>({ kind: 'reading' });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const token = takeInviteToken();
    const read = async (): Promise<View> => {
      if (!token) return { kind: 'missing' };
      const outcome = await attempt(() => previewListingInvite({ body: { token } }));
      if (outcome.ok && outcome.data) return { kind: 'open', preview: outcome.data, token };
      return !outcome.ok && outcome.failure.code === 'INVITE_NOT_FOUND'
        ? { kind: 'not-found' }
        : { kind: 'unavailable' };
    };
    void read().then((next) => {
      if (live) setView(next);
    });
    return () => {
      live = false;
    };
  }, []);

  async function accept(token: string) {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const outcome = await attempt(() => acceptListingInvite({ body: { token } }));
    setSaving(false);
    if (outcome.ok && outcome.data) {
      forgetInviteToken();
      setView({ kind: 'accepted', listingId: outcome.data.listingId });
    } else setFailure(ownerError(outcome.ok ? {} : outcome.failure));
  }

  const said = (text: string) => (
    <Alert>
      <CircleAlert aria-hidden />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );

  switch (view.kind) {
    case 'reading':
      return (
        <p role="status" className="text-muted-foreground">
          {t('reading')}
        </p>
      );
    case 'missing':
      return said(t('missing'));
    case 'not-found':
      return said(t('notFound'));
    case 'unavailable':
      return said(ownerError({}));
    case 'accepted':
      return (
        <div className="grid gap-3">
          <FocusHeading>{t('accepted')}</FocusHeading>
          <div>
            <Button asChild className={WRAPPING_BUTTON}>
              <Link href={ownersHref(view.listingId)}>{t('toOwners')}</Link>
            </Button>
          </div>
        </div>
      );
    case 'open': {
      const { preview, token } = view;
      if (preview.state !== 'open') return said(t(preview.state));
      const name = preview.listingName ?? '';
      const listing = placeTag(name, preview.contentLocale);
      return (
        <div className="grid gap-4">
          <p role="status">
            {preview.invitedBy
              ? t.rich('lead', {
                  inviter: preview.invitedBy,
                  name,
                  who: () => <PersonName name={preview.invitedBy ?? ''} lang={locale} />,
                  listing,
                })
              : t.rich('leadNoInviter', { name, listing })}
          </p>
          <p className="text-muted-foreground">{t('meaning')}</p>
          {preview.forYou ? (
            <div className="grid gap-2">
              <FormError message={failure} />
              <div>
                <Button
                  type="button"
                  className={WRAPPING_BUTTON}
                  aria-disabled={saving || undefined}
                  onClick={() => void accept(token)}
                >
                  {saving ? t('accepting') : t('accept')}
                </Button>
              </div>
            </div>
          ) : (
            said(t('notForYou'))
          )}
        </div>
      );
    }
  }
}
