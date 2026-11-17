'use client';

import { ADMIN_REASON_NOTE_MAX, AdminReasonInputSchema } from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { FocusHeading } from '@/components/focus-heading';
import { NoteConfirm } from '@/components/note-confirm';
import { StaleNotice } from '@/components/stale-notice';
import { useRouter } from '@/i18n/navigation';
import { reinstateUser, suspendUser } from '@/lib/admin-client';

type Done = 'suspended' | 'reinstated';

/** The codes that say the page behind this is out of date: someone else got there first. */
const STALE = new Set(['ALREADY_SUSPENDED', 'NOT_SUSPENDED', 'USER_NOT_FOUND', 'STAFF_ACCOUNT']);

/**
 * Staff suspending an account, or lifting it (#79–#81). The note is for the audit log alone, and the
 * person is told without it. Nothing the account holds is touched (#80): staff are shown how many
 * live listings it is the primary owner of, which stay live until suspended one by one.
 */
export function AccountModerationPanel({
  id,
  own,
  staff,
  canSuspend,
  canReinstate,
  liveListings,
}: {
  id: string;
  own: boolean;
  staff: boolean;
  canSuspend: boolean;
  canReinstate: boolean;
  liveListings: number;
}) {
  const t = useTranslations('AdminAccount');
  const router = useRouter();
  const [done, setDone] = useState<Done | null>(null);
  const [stale, setStale] = useState<string | null>(null);

  if (done) {
    return (
      <div className="grid gap-2">
        <FocusHeading level="h3">{t(`done.${done}.title`)}</FocusHeading>
        <p className="text-sm text-muted-foreground">{t(`done.${done}.text`)}</p>
      </div>
    );
  }
  const refused = stale ? <StaleNotice message={stale} /> : null;
  if (own || staff || (!canSuspend && !canReinstate)) {
    return (
      <>
        {refused}
        <Alert role="note">
          <AlertDescription>{own ? t('own') : staff ? t('staff') : t('none')}</AlertDescription>
        </Alert>
      </>
    );
  }

  const finished = (result: Done) => {
    setDone(result);
    router.refresh();
  };
  const outOfDate = (code: string | undefined, message: string) => {
    if (!code || !STALE.has(code)) return false;
    setStale(message);
    router.refresh();
    return true;
  };

  const suspending = canSuspend;
  const kind = suspending ? 'suspend' : 'reinstate';
  return (
    <section aria-labelledby={`${kind}-account-heading`} className="grid gap-3">
      {refused}
      <h3 id={`${kind}-account-heading`} className="font-semibold">
        {t(`${kind}.heading`)}
      </h3>
      <p className="max-w-prose text-sm text-muted-foreground">{t(`${kind}.text`)}</p>
      {suspending && liveListings > 0 ? (
        <Alert role="note">
          <AlertDescription>{t('suspend.liveListings', { count: liveListings })}</AlertDescription>
        </Alert>
      ) : null}
      <NoteConfirm
        // Its own state: what was asked for suspending is not what is asked for lifting.
        key={kind}
        schema={AdminReasonInputSchema}
        labels={{
          note: t(`${kind}.note`),
          hint: t(`${kind}.hint`, { max: ADMIN_REASON_NOTE_MAX }),
          submit: t(`${kind}.submit`),
          question: t(`${kind}.question`),
          confirm: t(`${kind}.confirm`),
          busy: t(`${kind}.busy`),
          cancel: t('cancel'),
        }}
        run={(note) => (suspending ? suspendUser(id, note) : reinstateUser(id, note))}
        onDone={() => finished(suspending ? 'suspended' : 'reinstated')}
        onStale={outOfDate}
        onAttempt={() => setStale(null)}
      />
    </section>
  );
}
