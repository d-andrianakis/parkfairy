'use client';

import { Button } from '@parkfairy/ui/components/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';

/** Ends this session and goes to sign-in. Staff sessions are not left lying about. */
export function SignOutButton() {
  const t = useTranslations('Header');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      // Loaded now, not with every page: it is 13 KiB nobody needs until they leave.
      const { authClient } = await import('@/lib/auth-client');
      await authClient.signOut();
    } catch {
      // Nothing to tell: the page is re-read below, and the server says whether a session is left.
    }
    router.replace('/sign-in');
    router.refresh();
    setBusy(false);
  }

  // aria-disabled, not disabled: a disabled button drops keyboard focus to <body>.
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={busy || undefined}
      onClick={signOut}
    >
      {busy ? t('signingOut') : t('signOut')}
    </Button>
  );
}
