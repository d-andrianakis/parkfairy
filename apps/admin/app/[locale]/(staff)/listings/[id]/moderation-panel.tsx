'use client';

import {
  ADMIN_REASON_NOTE_MAX,
  AdminReasonInputSchema,
  AdminSuspendListingInputSchema,
  OWNER_LIMITS,
} from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Checkbox } from '@parkfairy/ui/components/checkbox';
import { FieldDescription, FieldLabel } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { FocusHeading } from '@/components/focus-heading';
import { NoteConfirm } from '@/components/note-confirm';
import { StaleNotice } from '@/components/stale-notice';
import { useRouter } from '@/i18n/navigation';
import { reinstateListing, suspendListing } from '@/lib/admin-client';

type Done = 'suspended' | 'reinstated';

/** What the note must be, built once: the contract's own rules for it. */
const SUSPEND_NOTE = AdminSuspendListingInputSchema.pick({ note: true });

/** What the page found out meanwhile, when the change was refused as out of date. */
const STALE = new Set(['NOT_PUBLISHED', 'NOT_SUSPENDED', 'LISTING_NOT_FOUND']);

/**
 * Staff taking a live listing down, or bringing it back (#78–#81). Suspending is a note its owners
 * read and a choice about the bookings that are upcoming, said each time; reinstating is a note for
 * the log. Either asks once more, and then gives way to a heading that takes the focus.
 */
export function ModerationPanel({
  id,
  own,
  canSuspend,
  canReinstate,
  upcomingBookings,
}: {
  id: string;
  own: boolean;
  canSuspend: boolean;
  canReinstate: boolean;
  upcomingBookings: number;
}) {
  const t = useTranslations('AdminModeration');
  const router = useRouter();
  const checkbox = useId();
  const [done, setDone] = useState<Done | null>(null);
  const [cancelBookings, setCancelBookings] = useState(false);
  // The reason a change was refused as out of date: kept above what the refreshed page now offers.
  const [stale, setStale] = useState<string | null>(null);

  if (done) {
    return (
      <div className="grid gap-2">
        <FocusHeading level="h3">{t(`done.${done}.title`)}</FocusHeading>
        <p className="text-sm text-muted-foreground">{t(`done.${done}.text`)}</p>
      </div>
    );
  }
  const notice = own ? (
    <Notice>{t('own')}</Notice>
  ) : !canSuspend && !canReinstate ? (
    <Notice>{t('none')}</Notice>
  ) : null;
  const refused = stale ? <StaleNotice message={stale} /> : null;

  if (notice) {
    return (
      <>
        {refused}
        {notice}
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

  if (canSuspend) {
    const count = cancelBookings ? upcomingBookings : 0;
    return (
      <section aria-labelledby="suspend-heading" className="grid gap-3">
        {refused}
        <h3 id="suspend-heading" className="font-semibold">
          {t('suspend.heading')}
        </h3>
        <p className="max-w-prose text-sm text-muted-foreground">{t('suspend.text')}</p>
        <NoteConfirm
          key="suspend"
          schema={SUSPEND_NOTE}
          labels={{
            note: t('suspend.note'),
            hint: t('suspend.hint', { max: OWNER_LIMITS.reviewNote }),
            submit: t('suspend.submit'),
            question: count > 0 ? t('suspend.questionCancel', { count }) : t('suspend.question'),
            confirm: t('suspend.confirm'),
            busy: t('suspend.busy'),
            cancel: t('cancel'),
          }}
          extra={
            upcomingBookings > 0 ? (
              <div className="flex items-start gap-3">
                <Checkbox
                  id={checkbox}
                  checked={cancelBookings}
                  aria-describedby={`${checkbox}-hint`}
                  onCheckedChange={(value) => setCancelBookings(value === true)}
                />
                <div className="grid gap-1">
                  <FieldLabel htmlFor={checkbox}>
                    {t('suspend.cancelBookings', { count: upcomingBookings })}
                  </FieldLabel>
                  <FieldDescription id={`${checkbox}-hint`}>
                    {t('suspend.cancelHint')}
                  </FieldDescription>
                </div>
              </div>
            ) : null
          }
          run={(note) => suspendListing(id, note, upcomingBookings > 0 && cancelBookings)}
          onDone={() => finished('suspended')}
          onStale={outOfDate}
          onAttempt={() => setStale(null)}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="reinstate-heading" className="grid gap-3">
      {refused}
      <h3 id="reinstate-heading" className="font-semibold">
        {t('reinstate.heading')}
      </h3>
      <p className="max-w-prose text-sm text-muted-foreground">{t('reinstate.text')}</p>
      <NoteConfirm
        // Its own state: what was asked for suspending is not what is asked for lifting.
        key="reinstate"
        schema={AdminReasonInputSchema}
        labels={{
          note: t('reinstate.note'),
          hint: t('reinstate.hint', { max: ADMIN_REASON_NOTE_MAX }),
          submit: t('reinstate.submit'),
          question: t('reinstate.question'),
          confirm: t('reinstate.confirm'),
          busy: t('reinstate.busy'),
          cancel: t('cancel'),
        }}
        run={(note) => reinstateListing(id, note)}
        onDone={() => finished('reinstated')}
        onStale={outOfDate}
        onAttempt={() => setStale(null)}
      />
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    // Said on the page, not announced as it loads: it is not an error.
    <Alert role="note">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
