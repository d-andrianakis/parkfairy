import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { ArrowLeft, CircleAlert, CircleCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ClientMessages } from '@/components/client-messages';
import { FocusHeading } from '@/components/focus-heading';
import { RemoveFavouriteButton } from '@/components/parking/favourite-button';
import { ListingCard } from '@/components/parking/listing-card';
import { SearchLink } from '@/components/parking/search-link';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadFavourites } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'Favourites',
  });
  return { title: t('metaTitle') };
}

/** The driver's favourite listings that are still live (5A.2); each is a card, with a way to let it go. */
export default async function FavouritesPage({
  params,
  searchParams,
}: LocaleParams & { searchParams: Promise<{ removed?: string | string[] }> }) {
  const locale = await localeFromParams(params);
  await requireSession('/favourites');
  const listings = await loadFavourites();
  const t = await getTranslations({ locale, namespace: 'Favourites' });
  // Back from letting one go: what the press did is said, where the focus lands.
  const { removed } = await searchParams;

  return (
    <div className="mx-auto grid w-full max-w-5xl content-start gap-6 px-4 py-10">
      <Link
        href="/account"
        className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      {typeof removed === 'string' && removed ? (
        // What the press just did, not an interruption: no role="alert". Keyed, so each removal
        // brings its own and takes the focus the button left.
        <Alert key={removed} role={undefined}>
          <CircleCheck aria-hidden />
          <div className="col-start-2 grid gap-1">
            <FocusHeading>{t('removedStatus')}</FocusHeading>
          </div>
        </Alert>
      ) : null}
      {listings === null ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('unavailable')}</AlertDescription>
        </Alert>
      ) : listings.length === 0 ? (
        <div className="grid gap-3">
          <p>{t('empty')}</p>
          <div>
            <Button asChild variant="outline">
              <SearchLink>{t('findParking')}</SearchLink>
            </Button>
          </div>
        </div>
      ) : (
        <ClientMessages namespaces={CLIENT_NAMESPACES.favourite}>
          <ul aria-label={t('listLabel')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing, index) => (
              <li key={listing.slug} className="grid content-start gap-2">
                <ListingCard
                  listing={listing}
                  headingLevel="h2"
                  headingId={`favourite-name-${listing.slug}`}
                  priority={index === 0}
                />
                <RemoveFavouriteButton
                  slug={listing.slug}
                  // The card's own heading names the listing: two buttons read apart.
                  describedBy={`favourite-name-${listing.slug}`}
                />
              </li>
            ))}
          </ul>
        </ClientMessages>
      )}
    </div>
  );
}
