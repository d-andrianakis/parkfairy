'use client';

import type { Locale } from '@parkfairy/contracts/locales';
import { Button } from '@parkfairy/ui/components/button';
import { useEffect, useState } from 'react';

type ErrorMessages = (typeof import('@/messages/en.json'))['Error'];

// Fetched only when this screen shows, so the catalogs stay out of every page's bundle.
const catalogs: Record<Locale, () => Promise<{ default: { Error: ErrorMessages } }>> = {
  el: () => import('@/messages/el.json'),
  en: () => import('@/messages/en.json'),
};

/**
 * What app/global-error.tsx shows when the root layout itself fails: no layout means no
 * next-intl provider, so the strings come straight from the catalog.
 */
export function GlobalErrorScreen({ locale, retry }: { locale: Locale; retry: () => void }) {
  const [t, setT] = useState<ErrorMessages | null>(null);
  useEffect(() => {
    catalogs[locale]()
      .then((catalog) => setT(catalog.default.Error))
      .catch(() => {});
  }, [locale]);

  if (!t) return null;
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24">
      <title>{t.title}</title>
      <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
      <p className="text-muted-foreground">{t.description}</p>
      <Button onClick={() => retry()}>{t.retry}</Button>
    </div>
  );
}
