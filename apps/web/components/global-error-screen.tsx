'use client';

import type { Locale } from '@parkfairy/contracts/locales';
import { Button } from '@parkfairy/ui/components/button';
import { useEffect, useRef } from 'react';
import { ERROR_FALLBACK } from '@/messages/error-fallback';

/**
 * What app/global-error.tsx shows when the root layout itself fails: no layout means no
 * next-intl provider, so the few strings come bundled (see messages/error-fallback.ts) and
 * the screen works even when other script chunks cannot load.
 */
export function GlobalErrorScreen({ locale, retry }: { locale: Locale; retry: () => void }) {
  const t = ERROR_FALLBACK[locale];
  const heading = useRef<HTMLHeadingElement>(null);
  // Say what happened, also when a retry fails again and this screen comes back.
  useEffect(() => heading.current?.focus(), []);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24">
      <title>{t.title}</title>
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-3xl font-semibold tracking-tight outline-none"
      >
        {t.title}
      </h1>
      <p className="text-muted-foreground">{t.description}</p>
      <Button onClick={() => retry()}>{t.retry}</Button>
    </div>
  );
}
