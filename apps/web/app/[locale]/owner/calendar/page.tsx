import {
  CALENDAR_MONTH_PATTERN,
  CALENDAR_MONTHS_AWAY,
  currentMonth,
  monthsBetween,
} from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { CalendarView } from '@/components/owner/calendar-view';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadOwnerCalendar } from '@/lib/bookings.server';
import { CALENDAR_HREF } from '@/lib/owner-href';
import { requireSession } from '@/lib/session';

interface CalendarPageProps extends LocaleParams {
  searchParams: Promise<{ month?: string | string[]; listing?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The month and listing the address asks for, or none for anything that isn't one: a stale or
 * mistyped link shows this month rather than an error, and the filter's empty "all" is none.
 */
async function askedFor(searchParams: CalendarPageProps['searchParams']) {
  const { month, listing } = await searchParams;
  return {
    month:
      typeof month === 'string' &&
      CALENDAR_MONTH_PATTERN.test(month) &&
      Math.abs(monthsBetween(currentMonth(), month)) <= CALENDAR_MONTHS_AWAY
        ? month
        : '',
    listing: typeof listing === 'string' && UUID.test(listing) ? listing : '',
  };
}

/** Named for the month, so a screen reader hears where Previous or Next month took it. */
export async function generateMetadata({
  params,
  searchParams,
}: CalendarPageProps): Promise<Metadata> {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: 'Owner.calendar' });
  const format = await getFormatter({ locale });
  const { month } = await askedFor(searchParams);
  const [year = 1970, number = 1] = (month || currentMonth()).split('-').map(Number);
  return {
    title: t('metaTitleMonth', {
      month: format.dateTime(new Date(Date.UTC(year, number - 1, 15)), {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    }),
  };
}

/**
 * The bookings of the signed-in owner's listings, a month at a time (5.1). The API reads them for
 * the person signed in; a listing that isn't theirs shows nothing, as one that doesn't exist.
 */
export default async function OwnerCalendarPage({ params, searchParams }: CalendarPageProps) {
  const locale = await localeFromParams(params);
  await requireSession(CALENDAR_HREF);
  const { month, listing } = await askedFor(searchParams);
  const calendar = await loadOwnerCalendar(month, listing);
  const t = await getTranslations({ locale, namespace: 'Owner' });

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
        <h1 className="text-3xl font-semibold tracking-tight">{t('calendar.title')}</h1>
        <p className="text-muted-foreground">{t('calendar.lead')}</p>
      </div>
      {calendar ? (
        <CalendarView calendar={calendar} />
      ) : (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('calendar.unavailable')}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
