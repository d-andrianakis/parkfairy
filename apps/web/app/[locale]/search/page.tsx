import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { Card, CardContent } from '@parkfairy/ui/components/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@parkfairy/ui/components/empty';
import { CircleAlert, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ListingCard } from '@/components/parking/listing-card';
import { SEARCH_FIELD_IDS, SearchForm } from '@/components/parking/search-form';
import { StayRange } from '@/components/parking/stay-range';
import { localeFromParams } from '@/i18n/params';
import { loadSearchResults } from '@/lib/api.server';
import { parseSearch, today, windowQuery, type SearchParams } from '@/lib/search';
import { validationArgs } from '@/lib/validation-args';

interface SearchPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}

/** Parses the search and loads results; React's cache() shares the request with metadata. */
async function load({ params, searchParams }: SearchPageProps) {
  const locale = await localeFromParams(params);
  const search = parseSearch(await searchParams);
  const query = search.query;
  const response = query
    ? await loadSearchResults(query.area, query.latitude, query.longitude, query.start, query.end)
    : undefined;
  const t = await getTranslations({ locale, namespace: 'Search' });
  const tAreas = await getTranslations({ locale, namespace: 'Areas' });
  const title = query?.area
    ? t('titleArea', { area: tAreas(query.area) })
    : query
      ? t('titleNearYou')
      : t('title');
  return { locale, search, response, title, t };
}

/** The title is what is announced after a search: say where, how many, or that it failed. */
export async function generateMetadata(props: SearchPageProps): Promise<Metadata> {
  const { search, response, title, t } = await load(props);
  if ((search.submitted && !search.query) || response === null) {
    return { title: t('errorTitle', { title }) };
  }
  if (response) return { title: t('resultsTitle', { title, count: response.results.length }) };
  return { title };
}

export default async function SearchPage(props: SearchPageProps) {
  const { locale, search, response, title, t } = await load(props);
  const tValidation = await getTranslations({ locale, namespace: 'Validation' });
  const tForms = await getTranslations({ locale, namespace: 'Forms' });
  const tSearchForm = await getTranslations({ locale, namespace: 'SearchForm' });
  const invalid = search.submitted && !search.query;
  // Each link names its field: two identical "Enter a valid date and time" links would not say which.
  const fieldNames = { area: 'where', start: 'from', end: 'until' } as const;
  const problems = (['area', 'start', 'end'] as const).flatMap((field) => {
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
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
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
            <SearchForm values={search.values} errors={search.errors} minDate={today()} />
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
              <ul className="grid gap-4 sm:grid-cols-2">
                {response.results.map((result, index) => (
                  <li key={result.slug}>
                    <ListingCard
                      priority={index === 0}
                      listing={result}
                      query={windowQuery(search.values)}
                      headingLevel="h3"
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
        {!search.submitted ? <p className="text-muted-foreground">{t('prompt')}</p> : null}
      </section>
    </div>
  );
}
