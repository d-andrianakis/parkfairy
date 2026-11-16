import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { DisputeReason } from '@/components/dispute-reason';
import { MarkedText, PersonName } from '@/components/marked-text';
import { MissingNotice } from '@/components/missing-notice';
import { None } from '@/components/none';
import { StandingNotice } from '@/components/standing-notice';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadBooking } from '@/lib/admin.server';
import { withClock } from '@/lib/clock';
import { accountPageUrl } from '@/lib/site';
import { requireSession } from '@/lib/session';
import { BookingActions } from './booking-actions';

type Props = LocaleParams & { params: Promise<{ locale: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Admin' });
  return { title: t('booking.metaTitle') };
}

export default async function BookingPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const locale = await localeFromParams(params);
  const { standing } = await requireSession(`/bookings/${id}`);
  if (standing !== 'staff')
    return <StandingNotice standing={standing} accountUrl={accountPageUrl(locale)} />;

  const t = await getTranslations({ locale, namespace: 'Admin.booking' });
  const booking = await loadBooking(id);
  if (booking === 'not-found') notFound();
  if (typeof booking === 'string') {
    return (
      <>
        <BackLink />
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('metaTitle')}</h1>
        <MissingNotice reason={booking} />
      </>
    );
  }
  const format = await getFormatter({ locale });
  const money = (amount: { amountMinor: number; currency: string }) =>
    format.number(amount.amountMinor / 100, { style: 'currency', currency: amount.currency });
  const when = (iso: string) => (
    <time dateTime={iso}>
      {format.dateTime(
        new Date(iso),
        withClock(locale, { dateStyle: 'medium', timeStyle: 'short' }),
      )}
    </time>
  );
  const contentLocale = booking.listing.contentLocale;

  return (
    <>
      <BackLink />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          {t('metaTitle')} <bdi>{booking.reference}</bdi>
        </h1>
      </div>

      <section aria-labelledby="facts-heading" className="mb-8">
        <h2 id="facts-heading" className="mb-3 text-lg font-semibold">
          {t('facts')}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
          <Row label={t('status')}>{t(`statuses.${booking.status}`)}</Row>
          <Row label={t('listing')} lang={booking.listing.name ? contentLocale : undefined}>
            {booking.listing.name ? (
              <MarkedText text={booking.listing.name} lang={contentLocale} />
            ) : (
              <None />
            )}
            {booking.listing.address ? (
              <span className="block text-sm text-muted-foreground">
                <MarkedText text={booking.listing.address} lang={contentLocale} />
              </span>
            ) : null}
          </Row>
          <Row label={t('space')} lang={contentLocale}>
            <MarkedText text={booking.spaceLabel} lang={contentLocale} />
          </Row>
          <Row label={t('when')}>
            {when(booking.startsAt)} – {when(booking.endsAt)}
          </Row>
          <Row label={t('driver')}>
            <PersonName name={booking.driver.name} lang={locale} />
            <span className="block text-sm text-muted-foreground">
              <bdi>{booking.driver.email}</bdi>
            </span>
            <Link
              href={`/users/${booking.driver.id}`}
              className="text-sm text-primary underline underline-offset-4 hover:decoration-2"
            >
              {t('openAccount')}
            </Link>
          </Row>
          <Row label={t('plate')}>
            {booking.vehiclePlate ? <bdi>{booking.vehiclePlate}</bdi> : <None />}
          </Row>
          <Row label={t('total')}>{money(booking.total)}</Row>
          <Row label={t('payment')}>
            {booking.paymentStatus ? t(`paymentStatuses.${booking.paymentStatus}`) : t('notPaid')}
          </Row>
          <Row label={t('refund')}>
            {booking.refund.status
              ? t('refundLine', {
                  status: t(`refundStatuses.${booking.refund.status}`),
                  amount: booking.refund.amount ? money(booking.refund.amount) : '',
                  count: booking.refund.attempts,
                })
              : t('none')}
          </Row>
          <Row label={t('payout')}>
            {booking.transferStatus
              ? t(`transferStatuses.${booking.transferStatus}`)
              : t('noPayout')}
          </Row>
          {booking.cancelledBy && booking.cancelledAt ? (
            <Row label={t('cancelled')}>
              {t(`cancellers.${booking.cancelledBy}`)} · {when(booking.cancelledAt)}
            </Row>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="disputes-heading" className="mb-8">
        <h2 id="disputes-heading" className="mb-3 text-lg font-semibold">
          {t('disputes')}
        </h2>
        {booking.disputes.length === 0 ? (
          <p className="text-muted-foreground">{t('noDisputes')}</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {booking.disputes.map((dispute) => (
              <li key={dispute.id} className="rounded-lg border p-4">
                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,max-content)_minmax(0,1fr)]">
                  <Row label={t('dispute.status')}>{t(`disputeStatuses.${dispute.status}`)}</Row>
                  <Row label={t('dispute.reason')}>
                    <DisputeReason reason={dispute.reason} />
                  </Row>
                  <Row label={t('dispute.amount')}>{money(dispute.amount)}</Row>
                  {dispute.dueBy ? <Row label={t('dispute.due')}>{when(dispute.dueBy)}</Row> : null}
                  <Row label={t('dispute.submissions')}>{format.number(dispute.submissions)}</Row>
                  {dispute.status === 'lost' ? (
                    <Row label={t('dispute.decision')}>
                      {dispute.decision
                        ? t(`decisions.${dispute.decision}`)
                        : t('dispute.undecided')}
                    </Row>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="mb-3 text-lg font-semibold">
          {t('actions')}
        </h2>
        <ClientMessages namespaces={CLIENT_NAMESPACES.booking}>
          <BookingActions
            id={booking.id}
            total={booking.total}
            refund={booking.refund.amount}
            canCancel={booking.canCancel}
            canRetryRefund={booking.canRetryRefund}
            canSettleRefund={booking.canSettleRefund}
            disputes={booking.disputes.map((dispute) => ({
              id: dispute.id,
              amount: dispute.amount,
              canDecide: dispute.canDecide,
              payoutHeld: dispute.payoutHeld,
            }))}
          />
        </ClientMessages>
      </section>
    </>
  );
}

function BackLink() {
  const t = useTranslations('Admin.booking');
  return (
    <p className="mb-4 text-sm">
      <Link
        href="/bookings"
        className="text-primary underline underline-offset-4 hover:decoration-2"
      >
        {t('back')}
      </Link>
    </p>
  );
}

function Row({
  label,
  lang,
  children,
}: {
  label: string;
  lang?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd lang={lang} className="min-w-0 break-words">
        {children}
      </dd>
    </>
  );
}
