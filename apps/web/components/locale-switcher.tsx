'use client';

import type { Locale } from '@parkfairy/contracts';
import { cn } from '@parkfairy/ui/lib/utils';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALE_ENDONYMS } from '@/i18n/locales';
import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { authClient } from '@/lib/auth-client';

/**
 * Plain links rather than a <select>: switching language is navigation, and links keep it
 * keyboard/screen-reader friendly without a change-of-context on input (WCAG 3.2.2).
 */
export function LocaleSwitcher() {
  const t = useTranslations('LocaleSwitcher');
  const current = useLocale();
  const pathname = usePathname();
  const { data: session } = authClient.useSession();

  function rememberPreference(locale: Locale) {
    // Keep the account's language (used for emails) in step with the UI choice.
    if (session && locale !== current) void authClient.updateUser({ locale });
  }

  return (
    <nav aria-label={t('label')}>
      <ul className="flex items-center gap-1 text-sm">
        {routing.locales.map((locale) => {
          const isCurrent = locale === current;
          return (
            <li key={locale}>
              <Link
                href={pathname}
                locale={locale}
                hrefLang={locale}
                lang={locale}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => rememberPreference(locale)}
                className={cn(
                  'rounded-md px-2 py-1 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  isCurrent && 'font-semibold underline underline-offset-4',
                )}
              >
                {LOCALE_ENDONYMS[locale]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
