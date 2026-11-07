import { DEFAULT_TIME_ZONE, zonedParts } from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { HoursExceptionsForm } from '@/components/owner/hours-exceptions-form';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { loadOtherListings, loadOwnerClosures } from '@/lib/owner.server';
import { requireSession } from '@/lib/session';

interface ClosuresPageProps {
  params: Promise<{ locale: string; id: string }>;
}

async function translations(locale: string) {
  return getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: 'Owner',
  });
}

/** Named for the listing, so an owner with several open in tabs can tell them apart. */
export async function generateMetadata({ params }: ClosuresPageProps): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await translations(locale);
  // The same request as the page's: `loadOwnerClosures` is cached for the render.
  const listing = await loadOwnerClosures(id);
  const name = typeof listing === 'object' ? listing.name : null;
  return { title: name ? t('closures.metaTitle', { name }) : t('closures.title') };
}

/**
 * Closures and special hours of one listing. Not a step: nothing here is needed to send a listing
 * in, and unlike the steps it stays open once staff have the listing or it is live (decision #24).
 */
export default async function ClosuresPage({ params }: ClosuresPageProps) {
  const { locale, id } = await params;
  await requireSession(`/owner/listings/${id}/closures`);

  // Two small reads: this listing's closures, and the owner's others they can be given to.
  const [listing, others] = await Promise.all([loadOwnerClosures(id), loadOtherListings(id)]);
  if (listing === 'not-found') notFound();
  const t = await translations(locale);

  if (listing === 'unavailable') {
    return (
      <div className="mx-auto grid max-w-xl gap-4 px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{t('closures.title')}</h1>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('errors.generic')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { name, contentLocale } = listing;
  const otherListings = others.map((other) => ({
    id: other.id,
    name: other.name,
    contentLocale: other.contentLocale,
  }));
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
          {name ?? t('dashboard.untitled')}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{t('closures.title')}</h1>
        <p className="text-muted-foreground">{t('closures.lead')}</p>
        <p className="text-muted-foreground">{t('closures.anyTime')}</p>
      </div>
      <HoursExceptionsForm
        id={listing.id}
        exceptions={listing.exceptions}
        today={zonedParts(new Date(), DEFAULT_TIME_ZONE).date}
        otherListings={otherListings}
      />
    </div>
  );
}
