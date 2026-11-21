import { ARRIVAL_INSTRUCTIONS_HOURS_AFTER } from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { Card, CardContent } from '@parkfairy/ui/components/card';
import { ArrowLeft, CalendarPlus, CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BookingFacts } from '@/components/bookings/booking-facts';
import { OfflinePass } from '@/components/bookings/offline-pass';
import { ClientMessages } from '@/components/client-messages';
import { QrCode } from '@/components/qr-code';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { Link } from '@/i18n/navigation';
import { localeFromParams } from '@/i18n/params';
import { loadBooking } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

interface PassPageProps {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: PassPageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Pass' });
  return { title: t('metaTitle') };
}

/**
 * The booking pass (5A.3): the reference large, as text and as a QR code that holds the reference
 * and nothing else, with the booking's facts (the way in once it is shown), a calendar file and an
 * opt-in copy for the car park with no signal. It is the driver's own page, like the booking: another
 * account's is the same 404. Its policy lets it register the worker (`allowsOfflinePass`).
 */
export default async function BookingPassPage({ params }: PassPageProps) {
  const locale = await localeFromParams(params);
  const { id } = await params;
  const [session, booking] = await Promise.all([
    requireSession(`/bookings/${id}/pass`),
    loadBooking(id),
  ]);
  if (booking === 'not-found') notFound();
  const t = await getTranslations({ locale, namespace: 'Pass' });
  const tBooking = await getTranslations({ locale, namespace: 'Booking' });

  if (booking === 'unavailable') {
    return (
      <div className="mx-auto grid max-w-xl gap-4 px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{t('heading')}</h1>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{tBooking('unavailable')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const back = (
    <Link
      href={`/bookings/${booking.id}`}
      className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {t('back')}
    </Link>
  );

  // A hold, a cancelled or an expired booking has no pass: it isn't a booking that stands.
  if (booking.status !== 'confirmed') {
    return (
      <div className="mx-auto grid w-full max-w-2xl content-start gap-6 px-4 py-10">
        {back}
        <h1 className="text-3xl font-semibold tracking-tight">{t('heading')}</h1>
        <p>{t('notYet')}</p>
      </div>
    );
  }

  const keepUntil = new Date(
    Date.parse(booking.end) + ARRIVAL_INSTRUCTIONS_HOURS_AFTER * 3_600_000,
  ).toISOString();

  return (
    <div className="mx-auto grid w-full max-w-2xl content-start gap-6 px-4 py-10">
      {back}
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-muted-foreground">{t('lead')}</p>
      </div>
      <Card>
        <CardContent className="grid justify-items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">{t('reference')}</p>
          <p
            className="font-mono text-3xl font-semibold tracking-wider wrap-anywhere sm:text-4xl"
            data-testid="pass-reference"
            // What marks this as the pass itself, which the worker looks for before renewing a copy.
            data-pass="reference"
          >
            {booking.reference}
          </p>
          <QrCode
            value={booking.reference}
            label={t('qrLabel', { reference: booking.reference })}
            className="size-48 rounded-md"
          />
          <p className="text-sm text-muted-foreground">{t('qrHint')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <BookingFacts booking={booking} />
        </CardContent>
      </Card>
      <div className="grid justify-items-start gap-2">
        <Button asChild variant="outline" className={WRAPPING_BUTTON}>
          {/* A file, not a page: the API answers it with the session cookie, as a download. */}
          <a
            href={`/api/v1/bookings/${booking.id}/calendar?locale=${locale}`}
            download
            aria-describedby="calendar-hint"
          >
            <CalendarPlus aria-hidden />
            {t('addToCalendar')}
          </a>
        </Button>
        <p id="calendar-hint" className="text-sm text-muted-foreground">
          {t('calendarHint')}
        </p>
      </div>
      <ClientMessages namespaces={CLIENT_NAMESPACES.pass}>
        <OfflinePass
          path={`/${locale}/bookings/${booking.id}/pass`}
          until={keepUntil}
          owner={session.user.id}
        />
      </ClientMessages>
    </div>
  );
}
