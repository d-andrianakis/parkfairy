import { isValidationMessage, zonedParts } from '@parkfairy/contracts';
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
import { HoursExceptions } from '@/components/parking/hours-exceptions';
import { ListingPhotoImage } from '@/components/parking/listing-photo';
import { OpeningHours } from '@/components/parking/opening-hours';
import { SpaceList } from '@/components/parking/space-list';
import { StayRange } from '@/components/parking/stay-range';
import { timeOptions } from '@/i18n/formats';
import { Link } from '@/i18n/navigation';
import { localeFromParams } from '@/i18n/params';
import { loadListing } from '@/lib/api.server';
import { parseListingWindow, windowQuery, type SearchParams } from '@/lib/search';
import { validationArgs } from '@/lib/validation-args';

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
  const [firstPhoto, ...otherPhotos] = listing.photos;
  const photoAlt = (alt: string | null, number: number) =>
    alt || t('photoAlt', { name: listing.name, number });
  const { priceRules } = listing;
  const wallTime = (time: string) =>
    format.dateTime(new Date(`2000-01-01T${time}:00Z`), {
      ...timeOptions(locale),
      timeZone: 'UTC',
    });
  const dateRange = (from: string, to: string) =>
    format.dateTimeRange(new Date(`${from}T12:00:00Z`), new Date(`${to}T12:00:00Z`), {
      dateStyle: 'long',
    });
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

        {firstPhoto ? (
          <section aria-labelledby="photos-heading" className="grid gap-2">
            <h2 id="photos-heading" className="sr-only">
              {t('photosHeading')}
            </h2>
            <ListingPhotoImage
              photo={firstPhoto}
              alt={photoAlt(firstPhoto.alt, 1)}
              lang={firstPhoto.alt ? listing.contentLocale : undefined}
              sizes="(min-width: 1024px) 40rem, 100vw"
              className="aspect-[3/2] w-full rounded-xl object-cover"
              priority
            />
            {otherPhotos.length > 0 ? (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {otherPhotos.map((photo, index) => (
                  <li key={photo.key}>
                    <ListingPhotoImage
                      photo={photo}
                      alt={photoAlt(photo.alt, index + 2)}
                      lang={photo.alt ? listing.contentLocale : undefined}
                      sizes="(min-width: 1024px) 13rem, (min-width: 640px) 33vw, 50vw"
                      className="aspect-[3/2] w-full rounded-lg object-cover"
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

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
          {listing.hoursExceptions.length > 0 ? (
            <>
              <h3 id="exceptions-heading" className="mt-6 text-base font-semibold">
                {t('exceptionsHeading')}
              </h3>
              <div className="mt-2 max-w-md">
                <HoursExceptions
                  exceptions={listing.hoursExceptions}
                  today={zonedParts(new Date(), listing.timeZone).date}
                  labelledBy="exceptions-heading"
                />
              </div>
            </>
          ) : null}
        </section>

        <section aria-labelledby="spaces-heading">
          <h2 id="spaces-heading" className="text-xl font-semibold">
            {t('spacesHeading')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('spaceCount', { count: listing.spaceCount })}
          </p>
          <SpaceList listing={listing} labelledBy="spaces-heading" />
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
              {t(listing.spacePricesVary ? 'perHourFrom' : 'perHour', {
                price: money(listing.hourlyRate),
              })}
              {listing.dailyMax ? (
                <>
                  <br />
                  {t('dailyMax', { price: money(listing.dailyMax) })}
                </>
              ) : null}
              {priceRules.weekendRate ? (
                <>
                  <br />
                  {t('weekendRate', { price: money(priceRules.weekendRate) })}
                </>
              ) : null}
              {priceRules.night ? (
                <>
                  <br />
                  {t('nightRate', {
                    price: money(priceRules.night.rate),
                    from: wallTime(priceRules.night.from),
                    to: wallTime(priceRules.night.to),
                  })}
                </>
              ) : null}
              {priceRules.dated.map(({ startsOn, endsOn, rate }) => (
                <span key={startsOn} className="block">
                  {t('datedRate', {
                    price: money(rate),
                    range: dateRange(startsOn, endsOn),
                  })}
                </span>
              ))}
              {priceRules.longStay.map(({ minDays, percent }) => (
                <span key={minDays} className="block">
                  {t('longStay', { percent, days: minDays })}
                </span>
              ))}
              {listing.cancellationPolicy ? (
                <span className="mt-2 block">
                  <strong className="font-medium">{t('cancellationHeading')}: </strong>
                  {t(`cancellation.${listing.cancellationPolicy}`)}
                </span>
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
                      {t(listing.spacePricesVary ? 'totalPriceFrom' : 'totalPrice', {
                        price: money(availability.total),
                      })}
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
