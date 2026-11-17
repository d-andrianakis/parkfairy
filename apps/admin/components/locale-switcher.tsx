'use client';

import { Button } from '@parkfairy/ui/components/button';
import { cn } from '@parkfairy/ui/lib/utils';
import { useLocale, useTranslations } from 'next-intl';

import { LOCALE_ENDONYMS } from '@/i18n/locales';
import { Link, usePathname, useSearchParams } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

/**
 * Plain links rather than a <select>: switching language is navigation, and links keep it
 * keyboard/screen-reader friendly without a change of context on input (WCAG 3.2.2). The page's
 * own query (a queue's status and place, the log's filter) goes along: none of it names a language.
 */
export function LocaleSwitcher() {
  const t = useTranslations('LocaleSwitcher');
  const current = useLocale();
  const pathname = usePathname();
  const query = Object.fromEntries(useSearchParams() ?? []);

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
