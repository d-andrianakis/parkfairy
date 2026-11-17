import type { OwnerBookingList, OwnerBookingListItem } from '@parkfairy/api-client';
import {
  OVERSTAY_NOTE_MAX,
  OVERSTAY_REPORT_DAYS,
  OWNER_BOOKING_STATUSES,
  OWNER_BOOKINGS_DEFAULT_DAYS,
  ownerBookingsReach,
} from '@parkfairy/contracts';
import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@parkfairy/ui/components/card';
import { Input } from '@parkfairy/ui/components/input';
import { Label } from '@parkfairy/ui/components/label';
import { NativeSelect, NativeSelectOption } from '@parkfairy/ui/components/native-select';
import { CircleAlert } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { PersonName, PlaceWords } from '@/components/parking/place-words';
import { StayRange } from '@/components/parking/stay-range';
import { Link } from '@/i18n/navigation';
import { BOOKING_LIST_HREF, ownerBookingsHref } from '@/lib/owner-href';

import { OverstayReport } from './overstay-report';

/** What is wrong with the days asked for: the last before the first, or over a year apart. */
export type WindowProblem = 'order' | 'span';

const FROM_ID = 'booking-list-from';
const TO_ID = 'booking-list-to';
const HINT_ID = 'booking-list-days-hint';
const ERROR_ID = 'booking-list-days-error';

/**
 * The bookings of every listing the account runs (5.1), a page at a time: what is coming, what is
 * over and what was called off, by listing and by the days stays start on. A GET form and links, so
 * it works without scripts, and a list rather than a table: it reads the same on a phone and to a
 * screen reader. The API sends only what the signed-in account runs (owner, co-owner or manager).
 *
 * Times are the app's zone, which is every listing's while listings are in Athens only
 * (`SUPPORTED_TIME_ZONES`); `StayRange` needs the booking's own zone the day another is allowed.
 */
export function BookingListView({
  list,
  asked,
  problem,
}: {
  list: OwnerBookingList;
  /** The days as the address gave them: what the fields show, whatever window the list reads. */
  asked: { from: string; to: string };
  /** The address asked for days the API refuses; the list below is then of no days at all. */
  problem: WindowProblem | null;
}) {
  const t = useTranslations('Owner.bookingList');
  const untitled = useTranslations('Owner.dashboard')('untitled');
  const format = useFormatter();
  const locale = useLocale();
  const reach = ownerBookingsReach();
  const day = (date: string) => {
    const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
    return format.dateTime(new Date(Date.UTC(y, m - 1, d, 12)), {
      dateStyle: 'long',
      timeZone: 'UTC',
    });
  };
  const money = ({ amountMinor, currency }: { amountMinor: number; currency: string }) =>
    format.number(amountMinor / 100, { style: 'currency', currency });
  const filters = {
    ...(list.listing ? { listing: list.listing } : {}),
    ...(asked.from ? { from: asked.from } : {}),
    ...(asked.to ? { to: asked.to } : {}),
  };
  const pageHref = (place: { after: string } | { before: string }) => ({
    pathname: BOOKING_LIST_HREF,
    query: { status: list.status, ...filters, ...place },
  });
  const nameOf = (listing: OwnerBookingListItem['listing']) =>
    listing.name ? (
      <span lang={listing.contentLocale}>
        <PlaceWords text={listing.name} lang={listing.contentLocale} />
      </span>
    ) : (
      untitled
    );

  // A window the wrong way round (a first day ahead of today's past stays) is no days: say only
  // where it starts.
  const window =
    list.from && list.to && list.from <= list.to
      ? t('windowBoth', { from: day(list.from), to: day(list.to) })
      : list.from
        ? t('windowFrom', { from: day(list.from) })
        : list.to
          ? t('windowTo', { to: day(list.to) })
          : null;
  // The order is the last day's to put right; a span is either's.
  const invalid = { from: problem === 'span', to: problem !== null };
  const describedBy = (hint: boolean) =>
    [problem ? ERROR_ID : '', hint ? HINT_ID : ''].filter(Boolean).join(' ') || undefined;

  return (
    <>
      <nav aria-label={t('statusLabel')}>
        <ul className="flex flex-wrap gap-2">
          {OWNER_BOOKING_STATUSES.map((status) => (
            <li key={status}>
              <Button asChild variant={status === list.status ? 'default' : 'outline'} size="sm">
                <Link
                  href={{
                    pathname: BOOKING_LIST_HREF,
                    query: { status, ...(list.listing ? { listing: list.listing } : {}) },
                  }}
                  aria-current={status === list.status ? 'page' : undefined}
                >
                  {t(`status.${status}`)}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      {problem ? (
        // Before the form, linking to the field to put right (as the search page's summary).
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle className="line-clamp-none">{t('windowProblem')}</AlertTitle>
          <AlertDescription>
            <a id={ERROR_ID} href={`#${TO_ID}`} className="underline underline-offset-4">
              {t(problem === 'order' ? 'windowOrder' : 'windowSpan')}
            </a>
          </AlertDescription>
        </Alert>
      ) : null}

      <form method="get" className="grid gap-4" aria-label={t('filterLabel')}>
        <input type="hidden" name="status" value={list.status} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="booking-list-listing">{t('listing')}</Label>
            <NativeSelect
              // Uncontrolled: a different listing in the address is a different select.
              key={list.listing ?? 'all'}
              id="booking-list-listing"
              name="listing"
              defaultValue={list.listing ?? ''}
              className="max-w-full"
            >
              <NativeSelectOption value="">{t('filterAll')}</NativeSelectOption>
              {list.listings.map((listing) => (
                <NativeSelectOption
                  key={listing.id}
                  value={listing.id}
                  // Its owner's words are in the listing's language; "unnamed" is ours.
                  lang={listing.name ? listing.contentLocale : undefined}
                >
                  {listing.name ?? untitled}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <fieldset className="flex min-w-0 flex-wrap items-end gap-3">
            <legend className="mb-1.5 text-sm font-medium">{t('daysLegend')}</legend>
            <div className="grid gap-1.5">
              <Label htmlFor={FROM_ID}>{t('from')}</Label>
              <Input
                // Uncontrolled, and a group's days are its own: another group starts them over.
                key={`${list.status}-${asked.from}`}
                id={FROM_ID}
                name="from"
                type="date"
                defaultValue={asked.from}
                min={reach.min}
                max={reach.max}
                aria-describedby={describedBy(true)}
                aria-invalid={invalid.from || undefined}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={TO_ID}>{t('to')}</Label>
              <Input
                key={`${list.status}-${asked.to}`}
                id={TO_ID}
                name="to"
                type="date"
                defaultValue={asked.to}
                min={reach.min}
                max={reach.max}
                aria-describedby={describedBy(false)}
                aria-invalid={invalid.to || undefined}
              />
            </div>
          </fieldset>
          <Button type="submit" variant="outline">
            {t('apply')}
          </Button>
        </div>
        <p id={HINT_ID} className="text-sm text-muted-foreground">
          {t('daysHint', { days: OWNER_BOOKINGS_DEFAULT_DAYS })}
        </p>
      </form>

      <section aria-labelledby="booking-list-results" className="grid gap-4">
        <h2 id="booking-list-results" className="text-xl font-semibold">
          {t(`metaTitles.${list.status}`)}
        </h2>
        {problem ? null : (
          <>
            {window ? <p className="text-sm text-muted-foreground">{window}</p> : null}
            {list.status === 'past' && list.bookings.length > 0 ? (
              <p className="max-w-prose text-sm text-muted-foreground">
                {t('overstay.hint', { days: OVERSTAY_REPORT_DAYS })}
              </p>
            ) : null}
            {list.bookings.length === 0 ? (
              <p>{t(`empty.${list.status}`)}</p>
            ) : (
              <ul className="grid gap-3">
                {list.bookings.map((booking) => {
                  const facts: [string, ReactNode][] = [
                    [t('state'), t(`states.${booking.state}`)],
                    [t('listing'), nameOf(booking.listing)],
                    [
                      t('space'),
                      <span key="space" lang={booking.listing.contentLocale} className="font-mono">
                        <PlaceWords
                          text={booking.spaceLabel}
                          lang={booking.listing.contentLocale}
                        />
                      </span>,
                    ],
                    [t('stay'), <StayRange key="stay" start={booking.start} end={booking.end} />],
                    [
                      t('driver'),
                      <PersonName key="driver" name={booking.driverName} lang={locale} />,
                    ],
                    [
                      t('plate'),
                      <span key="plate" className="font-mono">
                        {booking.vehiclePlate}
                      </span>,
                    ],
                    [t('total'), money(booking.total)],
                    ...(booking.state === 'cancelled' && booking.cancelledBy
                      ? ([[t('cancelledBy'), t(`by.${booking.cancelledBy}`)]] as [
                          string,
                          ReactNode,
                        ][])
                      : []),
                    ...(booking.state === 'cancelled' && booking.cancelledAt
                      ? ([
                          [
                            t('cancelledAt'),
                            <time key="cancelledAt" dateTime={booking.cancelledAt}>
                              {format.dateTime(new Date(booking.cancelledAt), {
                                dateStyle: 'long',
                              })}
                            </time>,
                          ],
                        ] as [string, ReactNode][])
                      : []),
                  ];
                  return (
                    <li key={booking.id}>
                      <Card>
                        <CardHeader>
                          <CardTitle className="leading-snug">
                            <h3>{t('bookingTitle', { reference: booking.reference })}</h3>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-4">
                          <dl className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
                            {facts.map(([term, value], index) => (
                              <div key={index} className="grid gap-0.5 sm:contents">
                                <dt className="text-sm text-muted-foreground">{term}</dt>
                                {/* Names and labels are their owners' words, however long. */}
                                <dd className="wrap-anywhere">{value}</dd>
                              </div>
                            ))}
                          </dl>
                          {booking.state === 'upcoming' || booking.state === 'underWay' ? (
                            <p className="text-sm">
                              <Link
                                href={ownerBookingsHref(booking.listing.id)}
                                className="text-primary underline underline-offset-4 hover:decoration-2"
                              >
                                {t.rich('manage', {
                                  reference: booking.reference,
                                  // Which booking, for a list of links read out of their cards.
                                  hidden: (chunks) => <span className="sr-only">{chunks}</span>,
                                })}
                              </Link>
                            </p>
                          ) : null}
                          {booking.state === 'ended' ? (
                            <OverstayReport
                              listingId={booking.listing.id}
                              bookingId={booking.id}
                              reference={booking.reference}
                              canReport={booking.canReportOverstay}
                              overstay={booking.overstay}
                              noteMax={OVERSTAY_NOTE_MAX}
                            />
                          ) : null}
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}

            {list.previous || list.next ? (
              <nav aria-label={t('pagesLabel')} className="flex flex-wrap justify-between gap-2">
                {list.previous ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={pageHref({ before: list.previous })}>{t('previous')}</Link>
                  </Button>
                ) : (
                  <span />
                )}
                {list.next ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={pageHref({ after: list.next })}>{t('next')}</Link>
                  </Button>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
