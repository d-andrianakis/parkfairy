import { Button } from '@parkfairy/ui/components/button';
import { CircleParking } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { Theme } from '@/lib/theme';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';

/**
 * Server-rendered with the session the layout already read, so the account links are right
 * on the first paint (no client session fetch, no layout shift) and the Better Auth client
 * stays out of every page's bundle.
 */
export function SiteHeader({ theme, signedIn }: { theme: Theme; signedIn: boolean }) {
  const t = useTranslations('Header');
  const tLayout = useTranslations('Layout');

  return (
    <header className="border-b">
      {/* Items wrap on narrow screens so the page never scrolls sideways at 320px (WCAG
          1.4.10). Below `sm` the account links get their own row. */}
      <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center justify-end gap-x-2 gap-y-1 px-4 py-2">
        <Link
          href="/"
          aria-label={tLayout('homeLink')}
          className="mr-auto flex items-center gap-2 font-semibold"
        >
          <CircleParking className="size-5 text-primary" aria-hidden />
          {tLayout('brand')}
        </Link>
        <LocaleSwitcher signedIn={signedIn} />
        <ThemeToggle initialTheme={theme} />
        <nav
          aria-label={t('accountNav')}
          className="flex min-h-8 flex-wrap items-center justify-end gap-2 max-sm:basis-full"
        >
          <Button asChild variant="ghost" size="sm">
            <Link href="/owner">{t('listParking')}</Link>
          </Button>
          {signedIn ? (
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
    </header>
  );
}
