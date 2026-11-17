'use client';

import './globals.css';

import { DEFAULT_LOCALE, isLocale } from '@parkfairy/contracts/locales';
import { useParams } from 'next/navigation';

import { GlobalErrorScreen } from '@/components/global-error-screen';

/**
 * Errors in the [locale] layout itself (its error.tsx only covers the pages below it). This
 * replaces the whole document, so it brings its own <html> and <body>.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  const param = useParams<{ locale?: string }>()?.locale;
  const locale = isLocale(param) ? param : DEFAULT_LOCALE;
  return (
    <html lang={locale}>
      <body className="min-h-dvh antialiased">
        <main>
          <GlobalErrorScreen locale={locale} retry={retry} />
        </main>
      </body>
    </html>
  );
}
