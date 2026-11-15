import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ClientMessages } from '@/components/client-messages';
import { RouteFocus } from '@/components/route-focus';
import { SiteHeader } from '@/components/site-header';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { routing } from '@/i18n/routing';
import { getLayoutSession, standingOf } from '@/lib/session';
import '../globals.css';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'Metadata',
  });
  return {
    title: { default: t('title'), template: `%s · ${t('title')}` },
    description: t('description'),
    // Staff screens are for no search engine.
    robots: { index: false, follow: false },
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
  const session = await getLayoutSession();

  return (
    // The theme follows the system (prefers-color-scheme); there is no theme cookie here.
    <html lang={locale}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-[3px] focus:ring-ring/50"
        >
          {t('skipToContent')}
        </a>
        <ClientMessages namespaces={CLIENT_NAMESPACES.root}>
          <RouteFocus />
          <SiteHeader
            signedIn={Boolean(session)}
            staff={session ? standingOf(session.user) === 'staff' : false}
          />
          <main id="main-content" tabIndex={-1} className="outline-none">
            {children}
          </main>
        </ClientMessages>
      </body>
    </html>
  );
}
