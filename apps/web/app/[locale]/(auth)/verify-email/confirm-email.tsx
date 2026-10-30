'use client';

import { Button } from '@parkfairy/ui/components/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FocusHeading } from '@/components/focus-heading';
import { Link } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { EmailLinkForm } from '../email-link-form';

/**
 * Confirms on a press, not on opening the page: mail scanners fetch links, and one must not
 * confirm an account that a stranger created with this address.
 */
export function ConfirmEmail({ token }: { token: string }) {
  const t = useTranslations('VerifyEmail');
  const [state, setState] = useState<'idle' | 'confirming' | 'confirmed' | 'failed'>('idle');

  async function confirm() {
    if (state === 'confirming') return;
    setState('confirming');
    const { error } = await authClient.verifyEmail({ query: { token } });
    setState(error ? 'failed' : 'confirmed');
  }

  if (state === 'confirmed') {
    return (
      <div className="grid gap-4">
        <div className="grid gap-2">
          <FocusHeading retitle>{t('confirmedTitle')}</FocusHeading>
          <p className="text-sm text-muted-foreground">{t('confirmedBody')}</p>
        </div>
        <Button asChild className={WRAPPING_BUTTON}>
          <Link href="/sign-in">{t('signIn')}</Link>
        </Button>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="grid gap-4">
        <FocusHeading retitle>{t('failedTitle')}</FocusHeading>
        <EmailLinkForm purpose="verify-email" intro={t('failedBody')} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('confirmBody')}</p>
      {/* aria-disabled, not disabled: a disabled button drops keyboard focus to <body>. */}
      <Button
        type="button"
        className={WRAPPING_BUTTON}
        aria-disabled={state === 'confirming' || undefined}
        onClick={() => void confirm()}
      >
        {state === 'confirming' ? t('confirming') : t('confirm')}
      </Button>
    </div>
  );
}
