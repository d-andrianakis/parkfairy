import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { ListingOwnersPanel } from '@/components/owner/listing-owners';
import { PlaceWords } from '@/components/parking/place-words';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { loadListingOwners } from '@/lib/owner.server';
import { ownersHref } from '@/lib/owner-href';
import { requireSession } from '@/lib/session';

interface OwnersPageProps {
  params: Promise<{ locale: string; id: string }>;
}

async function translations(locale: string) {
  return getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: 'Owner',
  });
}

/** Named for the listing, so an owner with several open in tabs can tell them apart. */
export async function generateMetadata({ params }: OwnersPageProps): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await translations(locale);
  // The same request as the page's: `loadListingOwners` is cached for the render.
  const owners = await loadListingOwners(id);
  const name = typeof owners === 'object' ? owners.name : null;
  return { title: name ? t('owners.metaTitle', { name }) : t('owners.title') };
}

/**
 * A listing's owners (#53–#56): every one of them may see this page and invite; the API says what
 * else the asking owner may do, and refuses the rest whatever the page shows.
 */
export default async function OwnersPage({ params }: OwnersPageProps) {
  const { locale, id } = await params;
  await requireSession(ownersHref(id));
  const owners = await loadListingOwners(id);
  if (owners === 'not-found') notFound();
  const t = await translations(locale);

  if (owners === 'unavailable') {
    return (
      <div className="mx-auto grid max-w-xl gap-4 px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{t('owners.title')}</h1>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('errors.generic')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { name, contentLocale } = owners;
  return (
    <div className="mx-auto grid w-full max-w-3xl content-start gap-6 px-4 py-10">
      <Link
        href="/owner"
        className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('step.back')}
      </Link>
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground" lang={name ? contentLocale : undefined}>
          {name ? <PlaceWords text={name} lang={contentLocale} /> : t('dashboard.untitled')}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{t('owners.title')}</h1>
        <p className="text-muted-foreground">{t('owners.lead')}</p>
      </div>
      <ListingOwnersPanel initial={owners} />
    </div>
  );
}
