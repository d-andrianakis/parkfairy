import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ClientMessages } from '@/components/client-messages';
import { RouteFocus } from '@/components/route-focus';
import { SessionRefresh } from '@/components/session-refresh';
import { SiteHeader } from '@/components/site-header';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { routing } from '@/i18n/routing';
import { getLayoutSession } from '@/lib/session';
import { sessionRefreshDue } from '@/lib/session-refresh';
import { themeClassName } from '@/lib/theme';
import { getTheme } from '@/lib/theme.server';
import '../globals.css';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'Metadata',
  });
  return {
    title: { default: t('title'), template: `%s · ${t('title')}` },
    description: t('description'),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Pages carry a per-request CSP nonce, so they must render per request (see proxy.ts).
  await headers();
  const t = await getTranslations({ locale, namespace: 'Layout' });
  const theme = await getTheme();
  const session = await getLayoutSession();

  return (
    <html lang={locale} className={themeClassName(theme)}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-[3px] focus:ring-ring/50"
        >
          {t('skipToContent')}
        </a>
        {/* Client components in the header and the error page; pages add their own. */}
        <ClientMessages namespaces={CLIENT_NAMESPACES.root}>
          <RouteFocus />
          {session && sessionRefreshDue(session.session.expiresAt) ? <SessionRefresh /> : null}
          <SiteHeader theme={theme} signedIn={Boolean(session)} />
          <main id="main-content" tabIndex={-1} className="outline-none">
            {children}
          </main>
        </ClientMessages>
      </body>
    </html>
  );
}
