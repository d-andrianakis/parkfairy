import { buttonVariants } from '@parkfairy/ui/components/button';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import './globals.css';

/**
 * 404 for URLs that match no route. The root layout lives under [locale], so Next.js
 * renders this page on its own, without layouts; the locale comes from the proxy's
 * negotiation (URL prefix, cookie, or Accept-Language).
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('NotFound');
  return { title: t('metaTitle') };
}

export default async function GlobalNotFound() {
  const locale = await getLocale();
  const t = await getTranslations('NotFound');

  return (
    <html lang={locale}>
      <body className="min-h-dvh antialiased">
        <main className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24">
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
          <a href={`/${locale}`} className={buttonVariants()}>
            {t('home')}
          </a>
        </main>
      </body>
    </html>
  );
}
