import { DEFAULT_TIME_ZONE, type Locale } from '@parkfairy/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { pickMessages, type Namespace } from '@/components/client-messages';
import el from '../messages/el.json';
import en from '../messages/en.json';

export const catalogs = { el, en } satisfies Record<Locale, unknown>;

type Options = { locale?: Locale; namespaces?: readonly Namespace[] } & Omit<
  RenderOptions,
  'wrapper'
>;

/**
 * Renders with the real message catalogs and a fresh, non-retrying query client. Client
 * components pass `namespaces` (via `rendererFor`) to get only what their subtree ships.
 */
export function renderWithProviders(
  ui: ReactElement,
  { locale = 'en', namespaces, ...options }: Options = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale={locale}
        messages={namespaces ? pickMessages(catalogs[locale], namespaces) : catalogs[locale]}
        timeZone={DEFAULT_TIME_ZONE}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
    options,
  );
}

/** A renderer for components inside one <ClientMessages> subtree (see CLIENT_NAMESPACES). */
export function rendererFor(namespaces: readonly Namespace[]) {
  return (ui: ReactElement, options: Omit<Options, 'namespaces'> = {}) =>
    renderWithProviders(ui, { ...options, namespaces });
}
