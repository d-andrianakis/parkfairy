import { isValidationMessage } from '@parkfairy/contracts';
import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { Badge } from '@parkfairy/ui/components/badge';
import { Button } from '@parkfairy/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@parkfairy/ui/components/card';
import { Separator } from '@parkfairy/ui/components/separator';
import { CircleAlert, CircleCheck, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { FeatureBadges } from '@/components/parking/feature-badges';
import { OpeningHours } from '@/components/parking/opening-hours';
import { StayRange } from '@/components/parking/stay-range';
import { Link } from '@/i18n/navigation';
import { localeFromParams } from '@/i18n/params';
import { loadListing } from '@/lib/api.server';
import { parseListingWindow, windowQuery, type SearchParams } from '@/lib/search';
import { validationArgs } from '@/lib/validation-args';

/** Big garages list hundreds of spaces; drivers don't pick one until booking. */
const SPACES_SHOWN = 48;

interface ListingPageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<SearchParams>;
}

/** Same arguments as the page, so React's cache() makes it one API request. */
async function load({ params, searchParams }: ListingPageProps) {
  const { slug } = await params;
  const parsed = parseListingWindow(await searchParams);
  const listing = await loadListing(slug, parsed.window?.start, parsed.window?.end);
  return { parsed, listing };
}

export async function generateMetadata(props: ListingPageProps): Promise<Metadata> {
  const { listing } = await load(props);
  if (typeof listing !== 'string') return { title: listing.name };
  const t = await getTranslations({
    locale: await localeFromParams(props.params),
    namespace: 'Listing',
  });
  return listing === 'unavailable' ? { title: t('unavailableTitle') } : {};
}

export default async function ListingPage(props: ListingPageProps) {
  const locale = await localeFromParams(props.params);
  const { parsed, listing } = await load(props);
  if (listing === 'not-found') notFound();

  const t = await getTranslations({ locale, namespace: 'Listing' });
  const tAreas = await getTranslations({ locale, namespace: 'Areas' });
  const tValidation = await getTranslations({ locale, namespace: 'Validation' });
  const tForms = await getTranslations({ locale, namespace: 'Forms' });
  const tSearchForm = await getTranslations({ locale, namespace: 'SearchForm' });
  const format = await getFormatter({ locale });

  if (listing === 'unavailable') {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{t('unavailableTitle')}</h1>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('unavailable')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const money = (amount: { amountMinor: number; currency: string }) =>
    format.number(amount.amountMinor / 100, { style: 'currency', currency: amount.currency });
  const availability = listing.availability;
  const available = availability ? availability.open && availability.freeSpaces > 0 : false;
  // Both ends can fail the same way, so each message says which end it is about.
  const windowErrors = (['start', 'end'] as const).flatMap((part) => {
    const key = parsed.errors[part];
    if (!key || !isValidationMessage(key)) return [];
    const message = tValidation(key, validationArgs(key));
    const field = tSearchForm(part === 'start' ? 'from' : 'until');
    return [{ part, text: tForms('fieldError', { field, message }) }];
  });
  const searchHere = {
    pathname: '/search',
    query: { area: listing.area, ...(parsed.window ? windowQuery(parsed.values) : {}) },
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Link
            href={searchHere}
            className="w-fit text-sm text-primary underline underline-offset-4 hover:decoration-2"
          >
            {t('moreNear', { area: tAreas(listing.area) })}
          </Link>
          <h1 lang={listing.contentLocale} className="text-3xl font-semibold tracking-tight">
            {listing.name}
          </h1>
          <p lang={listing.contentLocale} className="text-muted-foreground">
            {listing.address}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">
              <MapPin aria-hidden />
              {tAreas(listing.area)}
            </Badge>
            <FeatureBadges features={listing.features} />
          </div>
        </div>

        {listing.description ? (
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-xl font-semibold">
              {t('aboutHeading')}
            </h2>
            <p lang={listing.contentLocale} className="mt-2">
              {listing.description}
            </p>
          </section>
        ) : null}

        <section aria-labelledby="hours-heading">
          <h2 id="hours-heading" className="text-xl font-semibold">
            {t('openingHoursHeading')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('localTime')}</p>
          <div className="mt-3 max-w-md">
            <OpeningHours periods={listing.openingHours} />
          </div>
        </section>

        <section aria-labelledby="spaces-heading">
          <h2 id="spaces-heading" className="text-xl font-semibold">
            {t('spacesHeading')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('spaceCount', { count: listing.spaceCount })}
          </p>
          <ul aria-labelledby="spaces-heading" className="mt-3 grid gap-2 sm:grid-cols-2">
            {listing.spaces.slice(0, SPACES_SHOWN).map((space) => (
              <li
                key={space.label}
                className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
              >
                {/* Owner content: Greek "Α1" looks like Latin "A1" but is read differently. */}
                <span lang={listing.contentLocale} className="font-mono font-medium">
                  {space.label}
                </span>
                <FeatureBadges features={space.features} />
              </li>
            ))}
          </ul>
          {listing.spaces.length > SPACES_SHOWN ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('moreSpaces', { count: listing.spaces.length - SPACES_SHOWN })}
            </p>
          ) : null}
        </section>
      </div>

      <aside aria-labelledby="price-heading" className="flex flex-col gap-4 self-start">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="price-heading" className="text-lg">
                {t('priceHeading')}
              </h2>
            </CardTitle>
            <CardDescription>
              {t('perHour', { price: money(listing.hourlyRate) })}
              {listing.dailyMax ? (
                <>
                  <br />
                  {t('dailyMax', { price: money(listing.dailyMax) })}
                </>
              ) : null}
            </CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="flex flex-col gap-4">
            {availability ? (
              <>
                <div>
                  <h3 className="text-sm font-medium">{t('yourStay')}</h3>
                  <p className="text-sm text-muted-foreground">
                    <StayRange start={availability.start} end={availability.end} />
                  </p>
                </div>
                {/* Page content, not an interruption: no role="alert". */}
                <Alert role={undefined} variant={available ? 'default' : 'destructive'}>
                  {available ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
                  {available ? (
                    <AlertTitle className="line-clamp-none">
                      {t('totalPrice', { price: money(availability.total) })}
                    </AlertTitle>
                  ) : null}
                  <AlertDescription>
                    {availability.open
                      ? t('openForStay', { count: availability.freeSpaces })
                      : t('closedForStay')}
                  </AlertDescription>
                </Alert>
              </>
            ) : windowErrors.length > 0 ? (
              <Alert role={undefined} variant="destructive">
                <CircleAlert aria-hidden />
                <AlertDescription>
                  {windowErrors.map(({ part, text }) => (
                    <p key={part}>{text}</p>
                  ))}
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noWindow')}</p>
            )}
            <Button asChild variant={availability ? 'outline' : 'default'}>
              <Link href={searchHere}>{t(availability ? 'changeDates' : 'chooseDates')}</Link>
            </Button>
            <p className="text-sm text-muted-foreground">{t('bookingSoon')}</p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
