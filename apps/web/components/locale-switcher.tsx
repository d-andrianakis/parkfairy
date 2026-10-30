'use client';

import type { Locale } from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { cn } from '@parkfairy/ui/lib/utils';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALE_ENDONYMS } from '@/i18n/locales';
import { Link, usePathname, useSearchParams } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { SEARCH_PARAM_KEYS } from '@/lib/search-params';

/** Query parameters worth keeping in the other language; anything else (tokens…) is dropped. */
const CARRIED_PARAMS: readonly string[] = [...SEARCH_PARAM_KEYS, 'next'];

/**
 * Plain links rather than a <select>: switching language is navigation, and links keep it
 * keyboard/screen-reader friendly without a change-of-context on input (WCAG 3.2.2).
 */
export function LocaleSwitcher({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations('LocaleSwitcher');
  const current = useLocale();
  const pathname = usePathname();
  // Same page in the other language, search and stay window included.
  const query = Object.fromEntries(
    [...(useSearchParams() ?? [])].filter(([key]) => CARRIED_PARAMS.includes(key)),
  );

  function rememberPreference(locale: Locale) {
    // Keep the account's language (used for emails) in step with the UI choice. The auth
    // client loads only here, so it stays out of every page's bundle. Best effort.
    if (!signedIn || locale === current) return;
    void import('@/lib/auth-client')
      .then(({ authClient }) => authClient.updateUser({ locale }))
      .catch(() => {});
  }

  return (
    <nav aria-label={t('label')}>
      <ul className="flex items-center gap-1 text-sm">
        {routing.locales.map((locale) => {
          const isCurrent = locale === current;
          return (
            <li key={locale}>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className={cn(isCurrent && 'font-semibold underline underline-offset-4')}
              >
                <Link
                  href={{ pathname, query }}
                  locale={locale}
                  hrefLang={locale}
                  lang={locale}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => rememberPreference(locale)}
                >
                  {LOCALE_ENDONYMS[locale]}
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
