import { AREAS, CITIES } from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { Card, CardContent } from '@parkfairy/ui/components/card';
import { CalendarClock, Car, MapPinned, type LucideIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ListingCard } from '@/components/parking/listing-card';
import { SearchForm } from '@/components/parking/search-form';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadFeaturedListings } from '@/lib/api.server';
import { defaultWindow, today } from '@/lib/search';

const STEPS: { key: 'search' | 'compare' | 'park'; icon: LucideIcon }[] = [
  { key: 'search', icon: MapPinned },
  { key: 'compare', icon: CalendarClock },
  { key: 'park', icon: Car },
];

export default async function HomePage({ params }: LocaleParams) {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: 'Home' });
  const tAreas = await getTranslations({ locale, namespace: 'Areas' });
  const tCities = await getTranslations({ locale, namespace: 'Cities' });
  const featured = await loadFeaturedListings();

  return (
    <div className="flex flex-col gap-16 pb-20">
      <section className="border-b bg-muted/50">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:py-16 lg:grid-cols-[1fr_minmax(0,28rem)] lg:items-center">
          <div className="flex flex-col gap-4">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {t('title')}
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">{t('lead')}</p>
          </div>
          <Card>
            <CardContent>
              <h2 className="sr-only">{t('searchHeading')}</h2>
              <SearchForm
                values={{ area: '', latitude: '', longitude: '', ...defaultWindow() }}
                minDate={today()}
              />
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="areas-heading" className="mx-auto w-full max-w-5xl px-4">
        <h2 id="areas-heading" className="text-2xl font-semibold tracking-tight">
          {t('areasHeading')}
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {CITIES.map((city) => (
            <div key={city}>
              <h3 className="text-sm font-medium text-muted-foreground">{tCities(city)}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {AREAS.filter((area) => area.city === city).map((area) => (
                  <li key={area.id}>
                    <Button asChild variant="outline" size="sm">
                      <Link href={{ pathname: '/search', query: { area: area.id } }}>
                        {tAreas(area.id)}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {featured.length > 0 ? (
        <section aria-labelledby="featured-heading" className="mx-auto w-full max-w-5xl px-4">
          <h2 id="featured-heading" className="text-2xl font-semibold tracking-tight">
            {t('featuredHeading')}
          </h2>
          <p className="mt-1 text-muted-foreground">{t('featuredLead')}</p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((listing) => (
              <li key={listing.slug}>
                <ListingCard listing={listing} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="how-heading" className="mx-auto w-full max-w-5xl px-4">
        <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
          {t('howHeading')}
        </h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {STEPS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex flex-col gap-2">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="font-semibold">{t(`steps.${key}.title`)}</h3>
              <p className="text-sm text-muted-foreground">{t(`steps.${key}.text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="account-heading" className="mx-auto w-full max-w-5xl px-4">
        <Card>
          <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="account-heading" className="text-lg font-semibold">
                {t('accountHeading')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('accountText')}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/sign-up">{t('ctaSignUp')}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/sign-in">{t('ctaSignIn')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
