'use client';

import { Button } from '@parkfairy/ui/components/button';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

/**
 * Unexpected failures inside a page, in the page language (Next's built-in screen is English).
 * `retry` re-fetches and re-renders the page. Details stay in the server logs (`error.digest`).
 */
export default function LocaleError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('Error');
  const heading = useRef<HTMLHeadingElement>(null);
  // Say what happened, also when a retry fails again and this screen comes back.
  useEffect(() => heading.current?.focus(), []);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24">
      <title>{t('title')}</title>
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-3xl font-semibold tracking-tight outline-none"
      >
        {t('title')}
      </h1>
      <p className="text-muted-foreground">{t('description')}</p>
      <Button
        onClick={() => {
          // The button unmounts with this screen; keep focus somewhere meaningful.
          document.getElementById('main-content')?.focus();
          retry();
        }}
      >
        {t('retry')}
      </Button>
    </div>
  );
}
