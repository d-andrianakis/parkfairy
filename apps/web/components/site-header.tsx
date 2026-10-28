'use client';

import { Button } from '@parkfairy/ui/components/button';
import { CircleParking } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { LocaleSwitcher } from './locale-switcher';

export function SiteHeader() {
  const t = useTranslations('Header');
  const tLayout = useTranslations('Layout');
  const { data: session, isPending } = authClient.useSession();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          aria-label={tLayout('homeLink')}
          className="flex items-center gap-2 font-semibold"
        >
          <CircleParking className="size-5 text-primary" aria-hidden />
          {tLayout('brand')}
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <nav aria-label={t('accountNav')} className="flex items-center gap-2">
            {isPending ? null : session ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/account">{t('account')}</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/sign-in">{t('signIn')}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/sign-up">{t('signUp')}</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
