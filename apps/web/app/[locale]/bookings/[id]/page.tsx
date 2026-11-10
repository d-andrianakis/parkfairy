import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Badge } from '@parkfairy/ui/components/badge';
import { Button } from '@parkfairy/ui/components/button';
import { Card, CardContent } from '@parkfairy/ui/components/card';
import { ArrowLeft, CircleAlert, CircleCheck } from 'lucide-react';
import { HOLD_MINUTES } from '@parkfairy/contracts/validation';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { BookingFacts } from '@/components/bookings/booking-facts';
import { CancelBooking } from '@/components/bookings/cancel-booking';
import { ConfirmBooking } from '@/components/bookings/confirm-booking';
import { HoldTimer } from '@/components/bookings/hold-timer';
import { ClientMessages } from '@/components/client-messages';
import { FocusHeading } from '@/components/focus-heading';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { timeOptions } from '@/i18n/formats';
import { Link } from '@/i18n/navigation';
import { localeFromParams } from '@/i18n/params';
import { listingStayHref } from '@/lib/booking-links';
import { loadBooking } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';

interface BookingPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ done?: string | string[] }>;
}

export async function generateMetadata({ params }: BookingPageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Booking' });
  // The same request as the page's: `loadBooking` is cached for the render.
  const booking = await loadBooking((await params).id);
  return { title: typeof booking === 'object' ? t(`title.${booking.status}`) : t('metaTitle') };
}

/**
 * One of the driver's bookings. Held, it asks for the car and confirms (decision #3; until Phase 4
 * without payment, #33). Confirmed, it shows the reference and, until the stay begins, a way to
 * cancel by the terms booked with. `?done=` names what was just done here, so its notice can take
 * the focus once the page comes back.
 */
export default async function BookingPage({ params, searchParams }: BookingPageProps) {
  const locale = await localeFromParams(params);
  const { id } = await params;
  // Both at once: signed out, the redirect wins, and the API's 401 is never shown.
  const [, booking] = await Promise.all([requireSession(`/bookings/${id}`), loadBooking(id)]);
  if (booking === 'not-found') notFound();
  const t = await getTranslations({ locale, namespace: 'Booking' });

  if (booking === 'unavailable') {
    return (
      <div className="mx-auto grid max-w-xl gap-4 px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{t('metaTitle')}</h1>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('unavailable')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { done } = await searchParams;
  const format = await getFormatter({ locale });
  const money = ({ amountMinor, currency }: { amountMinor: number; currency: string }) =>
    format.number(amountMinor / 100, { style: 'currency', currency });
  // The request's own clock, read once: what this render says about holds and stays.
  const now = new Date().getTime();
  const pending = booking.status === 'held' || booking.status === 'expired';
  const heldUntil = Date.parse(booking.holdExpiresAt);
  // Ended, swept or not: only choosing again books it (decision #37).
  const ended = booking.status === 'expired' || heldUntil <= now;
  const clock = (instant: number) => format.dateTime(new Date(instant), timeOptions(locale));
  const spaceLabel = (chunks: ReactNode) => (
    <span lang={booking.listing.contentLocale}>{chunks}</span>
  );
  const again = listingStayHref(booking.listing.slug, booking.start, booking.end);
  const notice =
    done === 'confirmed' && booking.status === 'confirmed'
      ? { heading: t('confirmed'), lead: t('confirmedLead') }
      : done === 'cancelled' && booking.status === 'cancelled'
        ? { heading: t('cancelledNotice'), lead: null }
        : null;

  return (
    <div className="mx-auto grid w-full max-w-2xl content-start gap-6 px-4 py-10">
      <Link
        href="/bookings"
        className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('allBookings')}
      </Link>
      <div className="grid gap-2">
        <div>
          <Badge variant="outline">{t(`status.${booking.status}`)}</Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{t(`title.${booking.status}`)}</h1>
      </div>
      {notice ? (
        // Page content that replaced the form, not an interruption: no role="alert". After the
        // page's heading, so the headings read in order; it takes the focus all the same.
        <Alert role={undefined}>
          <CircleCheck aria-hidden />
          <div className="col-start-2 grid gap-1">
            <FocusHeading>{notice.heading}</FocusHeading>
            {notice.lead ? <AlertDescription>{notice.lead}</AlertDescription> : null}
          </div>
        </Alert>
      ) : null}
      <Card>
        <CardContent>
          <BookingFacts booking={booking} />
        </CardContent>
      </Card>

      {pending && ended ? (
        // What replaces the form when the hold runs out while the page is open: it takes the
        // focus the form had.
        <div className="grid gap-3">
          <FocusHeading>{t('heldEndedTitle')}</FocusHeading>
          <p>{t('heldEnded')}</p>
          <div>
            <Button asChild variant="outline">
              <Link href={again}>{t('chooseAnother')}</Link>
            </Button>
          </div>
        </div>
      ) : pending ? (
        <div className="grid gap-4">
          <p>
            {t.rich('heldUntil', {
              space: () => spaceLabel(booking.spaceLabel),
              time: clock(heldUntil),
              minutes: HOLD_MINUTES,
            })}
          </p>
          <p className="text-sm text-muted-foreground">{t('noPayment')}</p>
          <ClientMessages namespaces={CLIENT_NAMESPACES.booking}>
            <ConfirmBooking
              id={booking.id}
              chooseAgainHref={again}
              space={booking.spaceLabel}
              spaceLocale={booking.listing.contentLocale}
            />
            <HoldTimer
              id={booking.id}
              expiresAt={booking.holdExpiresAt}
              extensionsLeft={booking.holdExtensionsLeft}
            />
          </ClientMessages>
        </div>
      ) : null}

      {booking.status === 'confirmed' ? (
        booking.refundIfCancelled ? (
          <ClientMessages namespaces={CLIENT_NAMESPACES.booking}>
            <CancelBooking id={booking.id} refund={booking.refundIfCancelled} />
          </ClientMessages>
        ) : (
          <p className="text-muted-foreground">
            {Date.parse(booking.end) <= now ? t('ended') : t('started')}
          </p>
        )
      ) : null}

      {booking.status === 'cancelled' && booking.refund ? (
        <p>
          {booking.cancelledBy === 'owner'
            ? t('cancelledByOwner', { refund: money(booking.refund) })
            : booking.refund.amountMinor > 0
              ? t('cancelledByDriver', { refund: money(booking.refund) })
              : t('cancelledByDriverNoRefund')}
        </p>
      ) : null}

      {booking.status === 'released' ? (
        <div className="grid gap-3">
          <p>{t('releasedLead')}</p>
          <div>
            <Button asChild variant="outline">
              <Link href={again}>{t('chooseAnother')}</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
