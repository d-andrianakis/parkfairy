import { DEFAULT_TIME_ZONE, type Locale } from '@parkfairy/contracts';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { pickMessages, type Namespace } from '@/components/client-messages';
import el from '../messages/el.json';
import en from '../messages/en.json';

export const catalogs = { el, en } satisfies Record<Locale, unknown>;

type Options = { locale?: Locale; namespaces?: readonly Namespace[] } & Omit<
  RenderOptions,
  'wrapper'
>;

/**
 * Renders with the real message catalogs. Client components pass `namespaces` (via `rendererFor`)
 * to get only what their subtree ships, so a namespace missing from `CLIENT_NAMESPACES` fails a
 * test instead of showing raw keys.
 */
export function renderWithProviders(
  ui: ReactElement,
  { locale = 'en', namespaces, ...options }: Options = {},
) {
  const messages = namespaces ? pickMessages(catalogs[locale], namespaces) : catalogs[locale];
  function Providers({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages} timeZone={DEFAULT_TIME_ZONE}>
        {children}
      </NextIntlClientProvider>
    );
  }
  return render(ui, { ...options, wrapper: Providers });
}

/** A renderer for components inside one <ClientMessages> subtree (see CLIENT_NAMESPACES). */
export function rendererFor(namespaces: readonly Namespace[]) {
  return (ui: ReactElement, options: Omit<Options, 'namespaces'> = {}) =>
    renderWithProviders(ui, { ...options, namespaces });
}
