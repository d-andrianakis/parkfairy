import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { Card, CardContent } from '@parkfairy/ui/components/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@parkfairy/ui/components/empty';
import { findArea, type Locale, type ParkingSearchResult } from '@parkfairy/contracts';
import { CircleAlert, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ClientMessages } from '@/components/client-messages';
import { ListingCard } from '@/components/parking/listing-card';
import type { ResultPin } from '@/components/parking/results-map';
import { ResultsMapToggle } from '@/components/parking/results-map-toggle';
import { SEARCH_FIELD_IDS, SearchForm } from '@/components/parking/search-form';
import { StayRange } from '@/components/parking/stay-range';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { getPathname, redirect } from '@/i18n/navigation';
import { localeFromParams } from '@/i18n/params';
import { loadSearchResults, lookupPlace } from '@/lib/api.server';
import { mapboxToken } from '@/lib/maps.server';
import {
  parseSearch,
  today,
  windowQuery,
  type ParsedSearch,
  type SearchParams,
} from '@/lib/search';
import { validationArgs } from '@/lib/validation-args';

interface SearchPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}

type Placed = ParsedSearch & {
  /** Words not looked up, as the request came from another site: the visitor presses Search. */
  pending?: string;
};

/**
 * A place with no position yet is looked up once (decision #40): found, the browser goes on to the
 * same search at its position, so reloading or sharing the results costs no second look-up. Only
 * for a search made here or typed in: a link or image on another site would otherwise spend a
 * billed look-up from every visitor who loads it (security review, 3.2).
 */
async function placed(search: ParsedSearch, locale: Locale): Promise<Placed> {
  if (!search.lookup) return search;
  const site = (await headers()).get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') {
    return { ...search, pending: search.lookup };
  }
  const found = await lookupPlace(search.lookup, locale);
  if (typeof found === 'object') {
    redirect({
      href: {
        pathname: '/search',
        query: {
          place: found.label,
          placeLocale: locale,
          latitude: String(found.latitude),
          longitude: String(found.longitude),
          ...windowQuery(search.values),
        },
      },
      locale,
    });
  }
  return {
    ...search,
    errors: {
      ...search.errors,
      place: found === 'not-found' ? 'placeNotFound' : 'placeUnavailable',
    },
  };
}

/** Parses the search and loads results; React's cache() shares the requests with metadata. */
async function load({ params, searchParams }: SearchPageProps) {
  const locale = await localeFromParams(params);
  // Without Mapbox nothing can look a place up (decision #42).
  const lookups = mapboxToken() !== null;
  const search = await placed(parseSearch(await searchParams, Date.now(), { lookups }), locale);
  const query = search.query;
  const response = query
    ? await loadSearchResults(query.area, query.latitude, query.longitude, query.start, query.end)
    : undefined;
  const t = await getTranslations({ locale, namespace: 'Search' });
  const tAreas = await getTranslations({ locale, namespace: 'Areas' });
  const place = query && !query.area ? search.values.place : '';
  // The place's words in the language Mapbox gave them, which a language switch may have kept.
  const placeLang = search.values.placeLocale || locale;
  const plain = (key: 'titlePlace' | 'lookupPending', words: string) =>
    t.markup(key, { place: () => words });
  const rich = (key: 'titlePlace' | 'lookupPending', words: string): ReactNode =>
    t.rich(key, { place: () => <span lang={placeLang}>{words}</span> });
  const title = query?.area
    ? t('titleArea', { area: tAreas(query.area) })
    : place
      ? plain('titlePlace', place)
      : query
        ? t('titleNearYou')
        : t('title');
  const heading = place ? rich('titlePlace', place) : title;
  return { locale, search, response, title, heading, rich, t };
}

/** The title is what is announced after a search: say where, how many, or that it failed. */
export async function generateMetadata(props: SearchPageProps): Promise<Metadata> {
  const { search, response, title, t } = await load(props);
  if (search.pending) return { title };
  if ((search.submitted && !search.query) || response === null) {
    return { title: t('errorTitle', { title }) };
  }
  if (response) return { title: t('resultsTitle', { title, count: response.results.length }) };
  return { title };
}

/** A character no listing name holds, to find where the name goes in a pin's label. */
const NAME_HERE = '\u{E000}';

export default async function SearchPage(props: SearchPageProps) {
  const { locale, search, response, heading, rich, t } = await load(props);
  const tValidation = await getTranslations({ locale, namespace: 'Validation' });
  const tForms = await getTranslations({ locale, namespace: 'Forms' });
  const tSearchForm = await getTranslations({ locale, namespace: 'SearchForm' });
  const tMap = await getTranslations({ locale, namespace: 'ResultsMap' });
  const format = await getFormatter({ locale });
  const token = mapboxToken();
  const invalid = search.submitted && !search.query && !search.pending;
  const pending = search.pending ? rich('lookupPending', search.pending) : null;
  const results = response?.results ?? [];
  const listingQuery = windowQuery(search.values);
  // Without a token there is no map, and no numbers on the cards.
  const mapped = token !== null && results.length > 0;
  const pins = results.map((result: ParkingSearchResult, index): ResultPin => {
    // The name is the owner's, in their language: split out, so the pin can mark it with `lang`.
    const [before = '', after = ''] = tMap
      .markup('pin', {
        number: index + 1,
        from: String(result.spacePricesVary),
        price: format.number(result.total.amountMinor / 100, {
          style: 'currency',
          currency: result.total.currency,
        }),
        name: () => NAME_HERE,
      })
      .split(NAME_HERE);
    return {
      number: index + 1,
      label: { before, name: result.name, nameLang: result.contentLocale, after },
      href: getPathname({
        href: { pathname: `/parking/${result.slug}`, query: listingQuery },
        locale,
      }),
      latitude: result.latitude,
      longitude: result.longitude,
    };
  });
  const area = search.query?.area ? findArea(search.query.area) : undefined;
  const center = area
    ? { latitude: area.latitude, longitude: area.longitude }
    : search.query?.latitude !== undefined && search.query.longitude !== undefined
      ? { latitude: search.query.latitude, longitude: search.query.longitude }
      : null;
  // Each link names its field: two identical "Enter a valid date and time" links would not say which.
  const fieldNames = { area: 'where', place: 'addressName', start: 'from', end: 'until' } as const;
  const problems = (['area', 'place', 'start', 'end'] as const).flatMap((field) => {
    const key = search.errors[field];
    if (!key) return [];
    const message = tValidation(key, validationArgs(key));
    return [
      { field, text: tForms('fieldError', { field: tSearchForm(fieldNames[field]), message }) },
    ];
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
          {search.query ? (
            <p className="text-muted-foreground">
              <StayRange start={search.query.start} end={search.query.end} />
            </p>
          ) : null}
        </div>
        {invalid ? (
          // Before the form, linking to each field (GOV.UK error-summary pattern).
          <Alert variant="destructive" className="max-w-2xl">
            <CircleAlert aria-hidden />
            <AlertTitle className="line-clamp-none">{t('invalid')}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {problems.map(({ field, text }) => (
                  <li key={field}>
                    <a
                      href={`#${SEARCH_FIELD_IDS[field]}`}
                      className="underline underline-offset-4"
                    >
                      {text}
                    </a>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <section aria-labelledby="search-form-heading" className="self-start">
        <Card>
          <CardContent>
            <h2 id="search-form-heading" className="mb-4 text-lg font-semibold">
              {t('formHeading')}
            </h2>
            <SearchForm
              values={search.values}
              errors={search.errors}
              minDate={today()}
              addressSearch={token !== null}
            />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="results-heading" className="flex flex-col gap-4">
        <h2 id="results-heading" className="sr-only">
          {t('resultsHeading')}
        </h2>
        {response === null ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{t('unavailable')}</AlertDescription>
          </Alert>
        ) : null}
        {pending ? <p>{pending}</p> : null}
        {response ? (
          <>
            <p className="text-sm font-medium" data-testid="result-count">
              {t('resultCount', { count: response.results.length })}
            </p>
            {response.results.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchX aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
                  <EmptyDescription>{t('emptyText')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <MapAround
                token={mapped ? token : null}
                pins={pins}
                center={center}
                show={t('showMap')}
                hide={t('hideMap')}
              >
                {/* Numbered, as the pins are; `role` keeps that in Safari, which drops it unstyled. */}
                <ol role="list" className="grid gap-4 sm:grid-cols-2">
                  {results.map((result, index) => (
                    <li key={result.slug}>
                      <ListingCard
                        priority={index === 0}
                        listing={result}
                        query={listingQuery}
                        headingLevel="h3"
                        number={mapped ? index + 1 : undefined}
                      />
                    </li>
                  ))}
                </ol>
              </MapAround>
            )}
          </>
        ) : null}
        {!search.submitted ? <p className="text-muted-foreground">{t('prompt')}</p> : null}
      </section>
    </div>
  );
}

/** The results list, with "Show the map" above it where there is a token (decision #41). */
function MapAround({
  token,
  children,
  ...props
}: Omit<Parameters<typeof ResultsMapToggle>[0], 'token'> & { token: string | null }) {
  if (!token) return children;
  return (
    <ClientMessages namespaces={CLIENT_NAMESPACES.resultsMap}>
      <ResultsMapToggle token={token} {...props}>
        {children}
      </ResultsMapToggle>
    </ClientMessages>
  );
}
