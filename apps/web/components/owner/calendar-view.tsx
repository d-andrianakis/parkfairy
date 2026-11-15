import type { OwnerCalendar } from '@parkfairy/api-client';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@parkfairy/ui/components/card';
import { Label } from '@parkfairy/ui/components/label';
import { NativeSelect, NativeSelectOption } from '@parkfairy/ui/components/native-select';
import { CircleAlert } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { PersonName, PlaceWords } from '@/components/parking/place-words';
import { StayRange } from '@/components/parking/stay-range';
import { Link } from '@/i18n/navigation';
import { CALENDAR_HREF, ownerBookingsHref } from '@/lib/owner-href';

/**
 * The owner's calendar (5.1): the bookings of a month, a day at a time, as a list. Every owner's
 * listing is one of its choices; the API sends only what the signed-in owner owns. A list rather
 * than a grid: it reads the same on a phone and to a screen reader, and has nothing to tab through.
 */
export function CalendarView({ calendar }: { calendar: OwnerCalendar }) {
  const t = useTranslations('Owner.calendar');
  const untitled = useTranslations('Owner.dashboard')('untitled');
  const format = useFormatter();
  const locale = useLocale();
  const [year = 1970, number = 1] = calendar.month.split('-').map(Number);
  // Mid-month, in UTC: a month's name doesn't move with any time zone.
  const monthName = format.dateTime(new Date(Date.UTC(year, number - 1, 15)), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dayName = (date: string) => {
    const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
    return format.dateTime(new Date(Date.UTC(y, m - 1, d, 12)), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  };
  const monthHref = (month: string) => ({
    pathname: CALENDAR_HREF,
    query: { month, ...(calendar.listing ? { listing: calendar.listing } : {}) },
  });
  const alone = calendar.listing !== null;

  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="month" value={calendar.month} />
        <div className="grid gap-1.5">
          <Label htmlFor="calendar-listing">{t('filterLabel')}</Label>
          <NativeSelect
            // Uncontrolled: a different listing in the address is a different select.
            key={calendar.listing ?? 'all'}
            id="calendar-listing"
            name="listing"
            defaultValue={calendar.listing ?? ''}
            className="max-w-full"
          >
            <NativeSelectOption value="">{t('filterAll')}</NativeSelectOption>
            {calendar.listings.map((listing) => (
              <NativeSelectOption key={listing.id} value={listing.id} lang={listing.contentLocale}>
                {listing.name ?? untitled}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          {t('filterApply')}
        </Button>
      </form>

      <nav
        aria-label={t('monthsLabel')}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        {calendar.previous ? (
          <Button asChild variant="outline" size="sm">
            <Link href={monthHref(calendar.previous)}>{t('previous')}</Link>
          </Button>
        ) : (
          <span />
        )}
        <p className="text-lg font-semibold">{monthName}</p>
        {calendar.next ? (
          <Button asChild variant="outline" size="sm">
            <Link href={monthHref(calendar.next)}>{t('next')}</Link>
          </Button>
        ) : (
          <span />
        )}
      </nav>

      {calendar.truncated ? (
        <Alert role={undefined}>
          <CircleAlert aria-hidden />
          <AlertDescription>{t('truncated')}</AlertDescription>
        </Alert>
      ) : null}

      {calendar.days.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        calendar.days.map((day) => (
          <div key={day.date} className="grid gap-3">
            <h2 id={`day-${day.date}`} className="text-xl font-semibold">
              <time dateTime={day.date}>{dayName(day.date)}</time>
            </h2>
            <ul className="grid gap-3">
              {day.bookings.map((booking) => {
                const facts: [string, React.ReactNode][] = [
                  [t('time'), <StayRange key="time" start={booking.start} end={booking.end} />],
                  [
                    t('space'),
                    <span key="space" lang={booking.listing.contentLocale} className="font-mono">
                      <PlaceWords text={booking.spaceLabel} lang={booking.listing.contentLocale} />
                    </span>,
                  ],
                  ...(alone
                    ? []
                    : ([
                        [
                          t('listing'),
                          <span key="listing" lang={booking.listing.contentLocale}>
                            {booking.listing.name ? (
                              <PlaceWords
                                text={booking.listing.name}
                                lang={booking.listing.contentLocale}
                              />
                            ) : (
                              untitled
                            )}
                          </span>,
                        ],
                      ] as [string, React.ReactNode][])),
                  [
                    t('driver'),
                    <PersonName
                      key="driver"
                      name={booking.driverName}
                      lang={locale}
                      className="wrap-anywhere"
                    />,
                  ],
                  [
                    t('plate'),
                    <span key="plate" className="font-mono">
                      {booking.vehiclePlate}
                    </span>,
                  ],
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
                          {facts.map(([term, value]) => (
                            <div key={term} className="grid gap-0.5 sm:contents">
                              <dt className="text-sm text-muted-foreground">{term}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="text-sm">
                          <Link
                            href={ownerBookingsHref(booking.listing.id)}
                            className="text-primary underline underline-offset-4 hover:decoration-2"
                          >
                            {t('manage')}
                            <span className="sr-only"> {booking.listing.name ?? untitled}</span>
                          </Link>
                        </p>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </>
  );
}
