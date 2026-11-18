import { HOLD_MINUTES } from '@parkfairy/contracts/validation';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Badge } from '@parkfairy/ui/components/badge';
import { Button } from '@parkfairy/ui/components/button';
import { Card, CardContent } from '@parkfairy/ui/components/card';
import { ArrowLeft, CircleAlert, CircleCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';

import { BookingFacts } from '@/components/bookings/booking-facts';
import { CancelBooking } from '@/components/bookings/cancel-booking';
import { ConfirmBooking } from '@/components/bookings/confirm-booking';
import { HoldTimer } from '@/components/bookings/hold-timer';
import { PaymentPending } from '@/components/bookings/payment-pending';
import { RebookStay } from '@/components/bookings/rebook-stay';
import { TidyPaymentReturn } from '@/components/bookings/tidy-payment-return';
import { ClientMessages } from '@/components/client-messages';
import { FocusHeading } from '@/components/focus-heading';
import { placeTag } from '@/components/parking/place-words';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { timeOptions } from '@/i18n/formats';
import { Link } from '@/i18n/navigation';
import { localeFromParams } from '@/i18n/params';
import { listingStayHref } from '@/lib/booking-links';
import { loadBooking, loadVehicles } from '@/lib/bookings.server';
import { stripePublishableKey } from '@/lib/payments.server';
import { canRebook } from '@/lib/rebook';
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
  const again = listingStayHref(booking.listing.slug, booking.start, booking.end);
  const notice =
    (done === 'confirmed' || done === 'paid') && booking.status === 'confirmed'
      ? { heading: t('confirmed'), lead: t('confirmedLead') }
      : done === 'cancelled' && booking.status === 'cancelled'
        ? { heading: t('cancelledNotice'), lead: null }
        : null;
  // Paid, and the bank still deciding: whether or not the hold runs, the money is on its way. Or
  // back from the bank before Stripe's webhook: what happened is asked at once.
  const returned = done === 'paid' && booking.payment === 'pending';
  const processing =
    (booking.payment === 'processing' || returned) && booking.status !== 'confirmed';
  const refunded = booking.payment === 'refunded' || booking.payment === 'refunding';
  /** What the page is about: the booking, or the money where that says more. */
  const state = refunded
    ? ('refunded' as const)
    : processing
      ? ('processing' as const)
      : booking.status;
  const unpaid = done === 'unpaid' && booking.payment === 'pending' && booking.status === 'held';
  // The driver's saved vehicles, for the form that asks which car (5A.2); the form works without them.
  const vehicles = pending && !ended && !refunded && !processing ? await loadVehicles() : null;
  // Called off at Stripe an hour after the hold ended (4.2): said, so nobody wonders if it went.
  const canceledNote = booking.payment === 'canceled' ? <p>{t('paymentCanceled')}</p> : null;

  return (
    <div className="mx-auto grid w-full max-w-2xl content-start gap-6 px-4 py-10">
      {done === 'paid' ? <TidyPaymentReturn /> : null}
      <Link
        href="/bookings"
        className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('allBookings')}
      </Link>
      <div className="grid gap-2">
        <div>
          <Badge variant="outline">{t(`status.${state}`)}</Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{t(`title.${state}`)}</h1>
      </div>
      {notice ? (
        // Page content that replaced the form, not an interruption: no role="alert". After the
        // page's heading, so the headings read in order; it takes the focus all the same. Keyed:
        // a page whose query alone changes keeps its components, and a reused heading wouldn't
        // take the focus or say anything for the next thing done.
        <Alert key={done === 'cancelled' ? 'cancelled' : 'confirmed'} role={undefined}>
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

      {refunded ? (
        // A payment that came too late for the space, or for a hold let go (decision #3).
        <Alert key="refunded" role={undefined}>
          <CircleAlert aria-hidden />
          <div className="col-start-2 grid gap-1">
            {done === 'paid' ? (
              <FocusHeading>
                {booking.payment === 'refunded' ? t('paymentRefunded') : t('paymentRefunding')}
              </FocusHeading>
            ) : (
              <h2 className="font-medium">
                {booking.payment === 'refunded' ? t('paymentRefunded') : t('paymentRefunding')}
              </h2>
            )}
            <AlertDescription>{t('paymentRefundedLead')}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      {refunded && booking.status !== 'confirmed' ? (
        <div>
          <Button asChild variant="outline">
            <Link href={again}>{t('chooseAnother')}</Link>
          </Button>
        </div>
      ) : null}

      {processing ? (
        <ClientMessages namespaces={CLIENT_NAMESPACES.booking}>
          <PaymentPending id={booking.id} focus={done === 'paid'} now={returned} />
        </ClientMessages>
      ) : pending && ended && !refunded ? (
        // What replaces the form when the hold runs out while the page is open: it takes the
        // focus the form had.
        <div className="grid gap-3">
          <FocusHeading>{t('heldEndedTitle')}</FocusHeading>
          {canceledNote}
          <p>{t('heldEnded')}</p>
          <div>
            <Button asChild variant="outline">
              <Link href={again}>{t('chooseAnother')}</Link>
            </Button>
          </div>
        </div>
      ) : pending && !refunded ? (
        <div className="grid gap-4">
          {unpaid ? (
            // Back from the bank, not paid after all: said, and the form is there to pay again.
            <Alert key="unpaid" role={undefined} variant="destructive">
              <CircleAlert aria-hidden />
              <div className="col-start-2 grid gap-1">
                <FocusHeading>{t('paymentUnpaid')}</FocusHeading>
                <AlertDescription>{t('paymentUnpaidLead')}</AlertDescription>
              </div>
            </Alert>
          ) : null}
          <p>
            {t.rich('heldUntil', {
              space: placeTag(booking.spaceLabel, booking.listing.contentLocale),
              time: clock(heldUntil),
              minutes: HOLD_MINUTES,
              checkout: booking.checkout,
            })}
          </p>
          {booking.checkout === 'confirm' ? (
            <p className="text-sm text-muted-foreground">{t('noPayment')}</p>
          ) : null}
          <ClientMessages namespaces={CLIENT_NAMESPACES.booking}>
            <ConfirmBooking
              id={booking.id}
              chooseAgainHref={again}
              space={booking.spaceLabel}
              spaceLocale={booking.listing.contentLocale}
              checkout={booking.checkout}
              vehicles={vehicles ?? []}
              initialVehicleId={booking.vehicleId}
              payment={
                booking.checkout === 'payment'
                  ? { publishableKey: stripePublishableKey(), amount: money(booking.total) }
                  : null
              }
            />
            <HoldTimer
              id={booking.id}
              expiresAt={booking.holdExpiresAt}
              extensionsLeft={booking.holdExtensionsLeft}
              checkout={booking.checkout}
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

      {canRebook(booking, new Date(now)) ? (
        <RebookStay booking={booking} now={new Date(now)} />
      ) : null}

      {booking.status === 'cancelled' && booking.refund ? (
        <div className="grid gap-2">
          <p>
            {booking.cancelledBy === 'owner'
              ? t('cancelledByOwner', { refund: money(booking.refund) })
              : booking.refund.amountMinor > 0
                ? t('cancelledByDriver', { refund: money(booking.refund) })
                : t('cancelledByDriverNoRefund')}
          </p>
          {/* Sent to Stripe as it was cancelled (4.2): where it goes, and how long it takes. */}
          {booking.payment === 'succeeded' && booking.refund.amountMinor > 0 ? (
            <p className="text-sm text-muted-foreground">{t('refundToCard')}</p>
          ) : null}
        </div>
      ) : null}

      {booking.status === 'released' && !refunded && !processing ? (
        <div className="grid gap-3">
          {done === 'unpaid' ? (
            // Back from a payment that didn't go: what replaced the page's own heading, focused.
            <FocusHeading>{t('paymentUnpaid')}</FocusHeading>
          ) : null}
          {canceledNote}
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
