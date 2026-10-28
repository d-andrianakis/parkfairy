'use client';

import { Button } from '@parkfairy/ui/components/button';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const t = useTranslations('Account');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    // Drop every cached response that belonged to the signed-out user.
    queryClient.clear();
    router.replace('/');
    router.refresh();
  }

  return (
    <Button variant="outline" onClick={signOut} disabled={pending}>
      {pending ? t('signingOut') : t('signOut')}
    </Button>
  );
}
