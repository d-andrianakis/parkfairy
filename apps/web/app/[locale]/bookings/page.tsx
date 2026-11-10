import { BOOKINGS_MAX_PAGE } from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Badge } from '@parkfairy/ui/components/badge';
import { Button } from '@parkfairy/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@parkfairy/ui/components/card';
import { CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { StayRange } from '@/components/parking/stay-range';
import { SearchLink } from '@/components/parking/search-link';
import { Link } from '@/i18n/navigation';
import { localeFromParams } from '@/i18n/params';
import { loadBookings } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';

interface BookingsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ when?: string | string[]; page?: string | string[] }>;
}

const LISTS = ['upcoming', 'past'] as const;

export async function generateMetadata({ params }: BookingsPageProps): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'Bookings',
  });
  return { title: t('metaTitle') };
}

/** The driver's bookings, upcoming or past, a page at a time; each links to its own page. */
export default async function BookingsPage({ params, searchParams }: BookingsPageProps) {
  const locale = await localeFromParams(params);
  await requireSession('/bookings');
  const query = await searchParams;
  const when = query.when === 'past' ? 'past' : 'upcoming';
  const asked = Number(typeof query.page === 'string' ? query.page : 1);
  const page = Number.isInteger(asked) ? Math.min(Math.max(asked, 1), BOOKINGS_MAX_PAGE) : 1;
  const list = await loadBookings(when, page);
  const t = await getTranslations({ locale, namespace: 'Bookings' });
  const tBooking = await getTranslations({ locale, namespace: 'Booking' });
  const format = await getFormatter({ locale });
  const money = ({ amountMinor, currency }: { amountMinor: number; currency: string }) =>
    format.number(amountMinor / 100, { style: 'currency', currency });
  const hrefFor = (list: (typeof LISTS)[number], to = 1) => ({
    pathname: '/bookings',
    query: {
      ...(list === 'past' ? { when: 'past' } : {}),
      ...(to > 1 ? { page: String(to) } : {}),
    },
  });

  return (
    <div className="mx-auto grid w-full max-w-2xl content-start gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{t('heading')}</h1>
      <nav aria-label={t('tabsLabel')}>
        <ul className="flex flex-wrap gap-2">
          {LISTS.map((item) => (
            <li key={item}>
              <Button asChild size="sm" variant={item === when ? 'default' : 'outline'}>
                <Link href={hrefFor(item)} aria-current={item === when ? 'page' : undefined}>
                  {t(item)}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      {list === null ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('unavailable')}</AlertDescription>
        </Alert>
      ) : list.bookings.length === 0 ? (
        <div className="grid gap-3">
          <p>{t(when === 'past' ? 'emptyPast' : 'emptyUpcoming')}</p>
          <div>
            <Button asChild variant="outline">
              <SearchLink>{t('findParking')}</SearchLink>
            </Button>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3">
          {list.bookings.map((booking) => (
            <li key={booking.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="leading-snug">
                    <h2>
                      <Link
                        href={`/bookings/${booking.id}`}
                        aria-describedby={`stay-${booking.id}`}
                        className="underline underline-offset-4 hover:decoration-2"
                      >
                        <span
                          lang={booking.listing.name ? booking.listing.contentLocale : undefined}
                        >
                          {booking.listing.name ?? tBooking('unnamed')}
                        </span>
                      </Link>
                    </h2>
                  </CardTitle>
                  {/* Describes the link: two bookings at one place read apart. */}
                  <CardDescription id={`stay-${booking.id}`}>
                    <StayRange start={booking.start} end={booking.end} />
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <Badge variant="outline">{tBooking(`status.${booking.status}`)}</Badge>
                  <span>
                    {t.rich('space', {
                      label: booking.spaceLabel,
                      space: (chunks) => (
                        <span lang={booking.listing.contentLocale} className="font-mono">
                          {chunks}
                        </span>
                      ),
                    })}
                  </span>
                  <span>{money(booking.total)}</span>
                  <span className="text-muted-foreground">
                    {t('reference', { reference: booking.reference })}
                  </span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {list && (page > 1 || list.hasMore) ? (
        <nav aria-label={t('pagesLabel')} className="flex flex-wrap justify-between gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={hrefFor(when, page - 1)}>{t('previous')}</Link>
            </Button>
          ) : (
            <span />
          )}
          {list.hasMore ? (
            <Button asChild variant="outline" size="sm">
              <Link href={hrefFor(when, page + 1)}>{t('next')}</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
