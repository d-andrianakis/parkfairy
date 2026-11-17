import {
  daysBetween,
  OWNER_BOOKING_STATUSES,
  OWNER_BOOKINGS_WINDOW_DAYS,
  OwnerBookingListQuerySchema,
  type OwnerBookingStatus,
  parseBookingsCursor,
} from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { BookingListView, type WindowProblem } from '@/components/owner/booking-list-view';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadOwnerBookingList } from '@/lib/bookings.server';
import { BOOKING_LIST_HREF } from '@/lib/owner-href';
import { requireSession } from '@/lib/session';

type Param = string | string[] | undefined;
interface BookingListPageProps extends LocaleParams {
  searchParams: Promise<Record<'status' | 'listing' | 'from' | 'to' | 'after' | 'before', Param>>;
}

/**
 * What the address asks for, or nothing for any part that isn't one: a stale or mistyped link shows
 * the first page rather than an error, and a form's empty fields are none. Each part is one if the
 * API's own schema takes it alone. Two days the API would refuse together (backwards, or over a year
 * apart) are kept, to be told so, not silently dropped.
 */
async function askedFor(searchParams: BookingListPageProps['searchParams']) {
  const raw = await searchParams;
  const one = (value: Param) => (typeof value === 'string' ? value : '');
  const status: OwnerBookingStatus =
    OWNER_BOOKING_STATUSES.find((known) => known === raw.status) ?? 'upcoming';
  const part = (name: 'listing' | 'from' | 'to', value: Param) => {
    const found = one(value);
    return found && OwnerBookingListQuerySchema.safeParse({ [name]: found }).success ? found : '';
  };
  const place = (value: Param) => {
    const found = one(value);
    return parseBookingsCursor(found) ? found : '';
  };
  const after = place(raw.after);
  const before = place(raw.before);
  const from = part('from', raw.from);
  const to = part('to', raw.to);
  const problem: WindowProblem | null =
    from && to
      ? from > to
        ? 'order'
        : daysBetween(from, to) >= OWNER_BOOKINGS_WINDOW_DAYS
          ? 'span'
          : null
      : null;
  return {
    status,
    listing: part('listing', raw.listing),
    from,
    to,
    problem,
    // Both places at once is a mangled link: the first page.
    after: after && before ? '' : after,
    before: after && before ? '' : before,
  };
}

/**
 * Named for the group, so moving between them is heard, and for refused days, which a reload
 * would otherwise leave unsaid (the title is what is announced after the form is sent).
 */
export async function generateMetadata({
  params,
  searchParams,
}: BookingListPageProps): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'Owner.bookingList',
  });
  const { status, problem } = await askedFor(searchParams);
  const title = t(`metaTitles.${status}`);
  return { title: problem ? t('errorTitle', { title }) : title };
}

/**
 * The bookings of every listing the signed-in account runs, in one list (5.1). The API reads them
 * for the person signed in; a listing that isn't theirs shows nothing, as one that doesn't exist.
 */
export default async function OwnerBookingListPage({ params, searchParams }: BookingListPageProps) {
  const locale = await localeFromParams(params);
  await requireSession(BOOKING_LIST_HREF);
  const asked = await askedFor(searchParams);
  const refused = asked.problem !== null;
  const list = await loadOwnerBookingList(
    asked.status,
    asked.listing,
    // Days the API would refuse read no days: the filters still load, with the reason.
    refused ? '' : asked.from,
    refused ? '' : asked.to,
    refused ? '' : asked.after,
    refused ? '' : asked.before,
  );
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
        <h1 className="text-3xl font-semibold tracking-tight">{t('bookingList.title')}</h1>
        <p className="text-muted-foreground">{t('bookingList.lead')}</p>
      </div>
      {list ? (
        <BookingListView
          list={list}
          asked={{ from: asked.from, to: asked.to }}
          problem={asked.problem}
        />
      ) : (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('bookingList.unavailable')}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
