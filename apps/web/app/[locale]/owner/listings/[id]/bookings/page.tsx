import { BOOKING_REFERENCE_PATTERN, parseBookingsCursor } from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@parkfairy/ui/components/card';
import { ArrowLeft, CircleAlert, CircleCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { FocusHeading } from '@/components/focus-heading';
import { CancelListingBooking } from '@/components/owner/cancel-listing-booking';
import { PlaceWords } from '@/components/parking/place-words';
import { StayRange } from '@/components/parking/stay-range';
import { Link, redirect } from '@/i18n/navigation';
import { localeFromParams } from '@/i18n/params';
import { loadOwnerBookings } from '@/lib/bookings.server';
import { closuresHref, ownerBookingsHref } from '@/lib/owner-href';
import { requireSession } from '@/lib/session';

interface OwnerBookingsPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{
    after?: string | string[];
    before?: string | string[];
    cancelled?: string | string[];
  }>;
}

/**
 * Where in the list the page starts: `after` or `before` a place a page gave out (keyset paging),
 * or the first page for anything else, an old `?page=` link included.
 */
async function placeOf(
  searchParams: OwnerBookingsPageProps['searchParams'],
): Promise<{ after: string; before: string }> {
  const { after, before } = await searchParams;
  const valid = (place: string | string[] | undefined) =>
    typeof place === 'string' && parseBookingsCursor(place) !== null ? place : '';
  const [from, to] = [valid(after), valid(before)];
  return from && to ? { after: '', before: '' } : { after: from, before: to };
}

/** Named for the listing, so an owner with several open in tabs can tell them apart. */
export async function generateMetadata({
  params,
  searchParams,
}: OwnerBookingsPageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Owner' });
  // The same request as the page's: `loadOwnerBookings` is cached for the render.
  const { after, before } = await placeOf(searchParams);
  const listing = await loadOwnerBookings((await params).id, after, before);
  const name = typeof listing === 'object' ? listing.name : null;
  return { title: name ? t('bookings.metaTitle', { name }) : t('bookings.title') };
}

/**
 * A listing's confirmed bookings that haven't ended, with who is coming in which car (decisions
 * #34, #35), and a way to call one off before it begins: what closing that time takes (#27).
 */
export default async function OwnerBookingsPage({ params, searchParams }: OwnerBookingsPageProps) {
  const locale = await localeFromParams(params);
  const { id } = await params;
  await requireSession(ownerBookingsHref(id));
  const place = await placeOf(searchParams);
  const listing = await loadOwnerBookings(id, place.after, place.before);
  if (listing === 'not-found') notFound();
  // A booking just called off here: said once the page comes back without it.
  const { cancelled } = await searchParams;
  const justCancelled =
    typeof cancelled === 'string' && BOOKING_REFERENCE_PATTERN.test(cancelled) ? cancelled : null;
  // Nothing left from this place (the last one here called off, or ended): the first page instead.
  if (
    typeof listing === 'object' &&
    listing.bookings.length === 0 &&
    (place.after || place.before)
  ) {
    redirect({
      href: {
        pathname: ownerBookingsHref(id),
        query: justCancelled ? { cancelled: justCancelled } : {},
      },
      locale,
    });
  }
  const t = await getTranslations({ locale, namespace: 'Owner' });

  if (listing === 'unavailable') {
    return (
      <div className="mx-auto grid max-w-xl gap-4 px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{t('bookings.title')}</h1>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('bookings.unavailable')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const format = await getFormatter({ locale });
  const money = ({ amountMinor, currency }: { amountMinor: number; currency: string }) =>
    format.number(amountMinor / 100, { style: 'currency', currency });
  const pageHref = (query: { after: string } | { before: string }) => ({
    pathname: ownerBookingsHref(id),
    query,
  });
  // A cancel comes back to this same page: places don't move when a booking goes.
  const here = place.after ? { after: place.after } : place.before ? { before: place.before } : {};
  const nameLang = listing.name ? listing.contentLocale : undefined;

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
        <p className="text-sm text-muted-foreground" lang={nameLang}>
          {listing.name ? (
            <PlaceWords text={listing.name} lang={listing.contentLocale} />
          ) : (
            t('dashboard.untitled')
          )}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{t('bookings.title')}</h1>
        <p className="text-muted-foreground">{t('bookings.lead')}</p>
        <p className="text-sm">
          <Link
            href={closuresHref(id)}
            className="text-primary underline underline-offset-4 hover:decoration-2"
          >
            {t('bookings.closuresLink')}
          </Link>
        </p>
      </div>
      {justCancelled ? (
        // What replaced the card the owner pressed in: it takes the focus, and says it. Keyed by
        // the booking: a second cancel changes only the query, which keeps the page's components,
        // and a reused heading would neither take the focus nor be read.
        <Alert key={justCancelled} role={undefined}>
          <CircleCheck aria-hidden />
          <div className="col-start-2">
            <FocusHeading>{t('bookings.cancelled', { reference: justCancelled })}</FocusHeading>
          </div>
        </Alert>
      ) : null}

      {listing.bookings.length === 0 ? (
        <p>{t('bookings.empty')}</p>
      ) : (
        <ul className="grid gap-3">
          {listing.bookings.map((booking) => {
            const facts: [string, ReactNode][] = [
              [
                t('bookings.space'),
                <span key="space" lang={listing.contentLocale} className="font-mono">
                  <PlaceWords text={booking.spaceLabel} lang={listing.contentLocale} />
                </span>,
              ],
              [
                t('bookings.stay'),
                <StayRange key="stay" start={booking.start} end={booking.end} />,
              ],
              // The driver's own words, in a language nobody told us. Greek script can only be
              // Greek, so that is marked on an English page.
              [
                t('bookings.driver'),
                // Isolated: a name in a right-to-left script mustn't reorder the line around it.
                <bdi key="driver" className="wrap-anywhere">
                  <PlaceWords text={booking.driverName} lang={locale} />
                </bdi>,
              ],
              [
                t('bookings.plate'),
                <span key="plate" className="font-mono">
                  {booking.vehiclePlate}
                </span>,
              ],
              [t('bookings.total'), money(booking.total)],
            ];
            return (
              <li key={booking.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="leading-snug">
                      <h2>{t('bookings.cardTitle', { reference: booking.reference })}</h2>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <dl className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
                      {facts.map(([term, value]) => (
                        <div key={term} className="grid gap-0.5 sm:contents">
                          <dt className="text-sm text-muted-foreground">{term}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {booking.cancellable ? (
                      <CancelListingBooking
                        listingId={listing.id}
                        bookingId={booking.id}
                        reference={booking.reference}
                        place={here}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('bookings.underWay')}</p>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {listing.previous || listing.next ? (
        <nav aria-label={t('bookings.pagesLabel')} className="flex flex-wrap justify-between gap-2">
          {listing.previous ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref({ before: listing.previous })}>{t('bookings.previous')}</Link>
            </Button>
          ) : (
            <span />
          )}
          {listing.next ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref({ after: listing.next })}>{t('bookings.next')}</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
