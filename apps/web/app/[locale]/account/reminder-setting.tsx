'use client';

import { setMyReminders } from '@parkfairy/api-client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { CheckboxField } from '@/components/owner/fields';
import { attempt } from '@/lib/api-call';

/**
 * The one switch for the reminders around a stay (5A.3). Saved as it is pressed, the answer said in
 * a status; a failure puts the box back as it was and says so beside it.
 */
export function ReminderSetting({ initial }: { initial: boolean }) {
  const t = useTranslations('Account');
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);

  async function change(next: boolean) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setOn(next);
    const outcome = await attempt(() => setMyReminders({ body: { reminderEmails: next } }));
    setBusy(false);
    if (!outcome.ok) {
      setOn(!next);
      setFailed(true);
      return;
    }
    // Said again even when it repeats the last: the status is emptied first.
    setStatus('');
    requestAnimationFrame(() =>
      setStatus(t(outcome.data.reminderEmails ? 'remindersOn' : 'remindersOff')),
    );
  }

  return (
    <div className="grid gap-2">
      <CheckboxField
        id="reminder-emails"
        label={t('remindersLabel')}
        checked={on}
        onChange={(next) => void change(next)}
        // Never `disabled` while saving: that takes the focus from the box. `change` ignores a repeat.
        hint={t('remindersHint')}
      />
      <p role="status" className="sr-only">
        {status}
      </p>
      {failed ? (
        <p role="alert" className="ps-6 text-sm text-destructive">
          {t('remindersError')}
        </p>
      ) : null}
    </div>
  );
}
