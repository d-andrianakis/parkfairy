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
import { Link, useRouter } from '@/i18n/navigation';
import { forgetInviteToken, takeInviteToken } from '@/lib/invite-token';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { CALENDAR_HREF, INVITE_PATH, ownersHref } from '@/lib/owner-href';
import { forgetEverySentTo } from '@/lib/remembered-email';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

type View =
  | { kind: 'reading' }
  | { kind: 'missing' }
  | { kind: 'not-found' }
  | { kind: 'unavailable' }
  | { kind: 'open'; preview: InvitePreview; token: string }
  | { kind: 'accepted'; listingId: string; role: 'co_owner' | 'manager' };

/** Kept for the tab before signing in: signed out, the page has nothing else to do with it. */
export function KeepInviteToken() {
  useEffect(() => {
    takeInviteToken();
  }, []);
  return null;
}

/**
 * Signed in with another address than the one invited: out, and to signing in with it, back here
 * after. The invite's token stays in the tab; nothing else of this account does.
 */
function SwitchAccount() {
  const t = useTranslations('Owner.invite');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function switchAccount() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    // Better Auth's client only for this rare press, not in every first visit to the page.
    const outcome = await import('@/lib/auth-client')
      .then(({ authClient }) => authClient.signOut())
      .catch(() => ({ error: true }));
    if (outcome.error) {
      // Still signed in: going to sign in would only come back here.
      setPending(false);
      setFailed(true);
      return;
    }
    forgetEverySentTo();
    router.replace({ pathname: '/sign-in', query: { next: INVITE_PATH } });
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <FormError message={failed ? t('signOutFailed') : null} />
      <div>
        <Button
          type="button"
          variant="outline"
          className={WRAPPING_BUTTON}
          aria-disabled={pending || undefined}
          onClick={() => void switchAccount()}
        >
          {pending ? t('signingOut') : t('switchAccount')}
        </Button>
      </div>
    </div>
  );
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
      if (outcome.ok && outcome.data) {
        // Used or lapsed: nothing to keep in the tab (a shared computer keeps nothing).
        if (outcome.data.state !== 'open') forgetInviteToken();
        return { kind: 'open', preview: outcome.data, token };
      }
      if (!outcome.ok && outcome.failure.code === 'INVITE_NOT_FOUND') {
        forgetInviteToken();
        return { kind: 'not-found' };
      }
      return { kind: 'unavailable' };
    };
    void read().then((next) => {
      if (live) setView(next);
    });
    return () => {
      live = false;
    };
  }, []);

  async function accept(token: string, role: 'co_owner' | 'manager') {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const outcome = await attempt(() => acceptListingInvite({ body: { token } }));
    setSaving(false);
    if (outcome.ok && outcome.data) {
      forgetInviteToken();
      setView({ kind: 'accepted', listingId: outcome.data.listingId, role });
    } else setFailure(ownerError(outcome.ok ? {} : outcome.failure));
  }

  const said = (text: string) => (
    <Alert>
      <CircleAlert aria-hidden />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );

  if (view.kind === 'accepted') {
    return (
      <div className="grid gap-3">
        <FocusHeading>
          {view.role === 'manager' ? t('manager.accepted') : t('accepted')}
        </FocusHeading>
        <div>
          <Button asChild className={WRAPPING_BUTTON}>
            {view.role === 'manager' ? (
              <Link href={{ pathname: CALENDAR_HREF, query: { listing: view.listingId } }}>
                {t('manager.toListing')}
              </Link>
            ) : (
              <Link href={ownersHref(view.listingId)}>{t('toOwners')}</Link>
            )}
          </Button>
        </div>
      </div>
    );
  }

  const open = view.kind === 'open' && view.preview.state === 'open' ? view : null;
  /** What the invitation is: said in the status line that was "Reading…", the same element. */
  const lead = (() => {
    if (!open) return view.kind === 'reading' ? t('reading') : '';
    const { preview } = open;
    // What it invites them to be: the same sentences, in the manager's words.
    const key = (name: 'lead' | 'leadNoInviter' | 'leadUnnamed' | 'leadNoInviterUnnamed') =>
      (preview.role === 'manager' ? `manager.${name}` : name) as typeof name;
    const inviter = preview.invitedBy;
    const person = () => <PersonName name={inviter ?? ''} lang={locale} />;
    if (!preview.listingName) {
      return inviter
        ? t.rich(key('leadUnnamed'), { inviter, person })
        : t(key('leadNoInviterUnnamed'));
    }
    const name = preview.listingName;
    const listing = placeTag(name, preview.contentLocale);
    return inviter
      ? t.rich(key('lead'), { inviter, name, person, listing })
      : t.rich(key('leadNoInviter'), { name, listing });
  })();

  return (
    <div className="grid gap-4">
      {/* Read whole as it changes: its text becomes several nodes (a name, a listing's). */}
      <p
        role="status"
        aria-atomic="true"
        className={open ? undefined : 'text-muted-foreground empty:sr-only'}
      >
        {lead}
      </p>
      {view.kind === 'missing' ? said(t('missing')) : null}
      {view.kind === 'not-found' ? said(t('notFound')) : null}
      {view.kind === 'unavailable' ? said(ownerError({})) : null}
      {view.kind === 'open' && view.preview.state !== 'open' ? said(t(view.preview.state)) : null}
      {open ? (
        <>
          <p className="text-muted-foreground">
            {open.preview.role === 'manager' ? t('manager.meaning') : t('meaning')}
          </p>
          {open.preview.forYou ? (
            <div className="grid gap-2">
              <FormError message={failure} />
              <div>
                <Button
                  type="button"
                  className={WRAPPING_BUTTON}
                  aria-disabled={saving || undefined}
                  onClick={() => void accept(open.token, open.preview.role)}
                >
                  {saving ? t('accepting') : t('accept')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {said(t('notForYou'))}
              <SwitchAccount />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
