'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';

import { ADMIN_REASON_NOTE_MAX, AdminReasonInputSchema } from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ChangePanel } from '@/components/change-panel';
import { resolveOverstay } from '@/lib/admin-client';

/**
 * Closing an overstay report (5.2c4, #76): a note, one more question, and a heading that takes the
 * focus. Nothing else follows from it: no money moves and nobody is told. Kept mounted while the page
 * refreshes, so the heading that says it is done stays.
 */
export function OverstayActions({
  id,
  canResolve,
  own,
}: {
  id: string;
  canResolve: boolean;
  own: boolean;
}) {
  const t = useTranslations('AdminOverstay');
  const [touched, setTouched] = useState(false);
  return (
    <div className="grid gap-8">
      {!canResolve && !touched ? (
        <Alert role="note">
          <AlertDescription>{t(own ? 'own' : 'nothing')}</AlertDescription>
        </Alert>
      ) : null}
      <ChangePanel
        available={canResolve}
        onFinished={() => setTouched(true)}
        id="resolve"
        heading={t('resolve.heading')}
        text={t('resolve.text')}
        schema={AdminReasonInputSchema}
        labels={{
          note: t('resolve.note'),
          hint: t('hint', { max: ADMIN_REASON_NOTE_MAX }),
          submit: t('resolve.submit'),
          question: t('resolve.question'),
          confirm: t('resolve.confirm'),
          busy: t('resolve.busy'),
          cancel: t('notYet'),
        }}
        run={(note) => resolveOverstay(id, note)}
        done={{ title: t('resolve.doneTitle'), text: t('resolve.doneText') }}
        stale={['ALREADY_RESOLVED', 'OVERSTAY_NOT_FOUND']}
      />
    </div>
  );
}
