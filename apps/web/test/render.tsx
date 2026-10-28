import { DEFAULT_TIME_ZONE, type Locale } from '@parkfairy/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import el from '../messages/el.json';
import en from '../messages/en.json';

export const catalogs = { el, en } satisfies Record<Locale, unknown>;

/** Renders with the real message catalogs and a fresh, non-retrying query client. */
export function renderWithProviders(
  ui: ReactElement,
  { locale = 'en', ...options }: { locale?: Locale } & Omit<RenderOptions, 'wrapper'> = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale={locale}
        messages={catalogs[locale]}
        timeZone={DEFAULT_TIME_ZONE}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
    options,
  );
}
