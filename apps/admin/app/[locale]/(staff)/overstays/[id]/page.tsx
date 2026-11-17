import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';

import { ClientMessages } from '@/components/client-messages';
import { MarkedText, PersonName } from '@/components/marked-text';
import { MissingNotice } from '@/components/missing-notice';
import { None } from '@/components/none';
import { StandingNotice } from '@/components/standing-notice';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadOverstay } from '@/lib/admin.server';
import { withClock } from '@/lib/clock';
import { requireSession } from '@/lib/session';
import { accountPageUrl } from '@/lib/site';

import { OverstayActions } from './overstay-actions';

type Props = LocaleParams & { params: Promise<{ locale: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Admin' });
  return { title: t('overstay.metaTitle') };
}

export default async function OverstayPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const locale = await localeFromParams(params);
  const { standing } = await requireSession(`/overstays/${id}`);
  if (standing !== 'staff')
    return <StandingNotice standing={standing} accountUrl={accountPageUrl(locale)} />;

  const t = await getTranslations({ locale, namespace: 'Admin.overstay' });
  const report = await loadOverstay(id);
  if (report === 'not-found') notFound();
  if (typeof report === 'string') {
    return (
      <>
        <BackLink />
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('metaTitle')}</h1>
        <MissingNotice reason={report} />
      </>
    );
  }
  const format = await getFormatter({ locale });
  const when = (iso: string) => (
    <time dateTime={iso}>
      {format.dateTime(
        new Date(iso),
        withClock(locale, { dateStyle: 'medium', timeStyle: 'short' }),
      )}
    </time>
  );
  const { booking } = report;

  return (
    <>
      <BackLink />
      <h1 className="mb-6 text-2xl font-semibold tracking-tight break-words">
        {t('metaTitle')} <bdi>{booking.reference}</bdi>
      </h1>

      <section aria-labelledby="facts-heading" className="mb-8">
        <h2 id="facts-heading" className="mb-3 text-lg font-semibold">
          {t('facts')}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
          <Row label={t('status')}>{t(`statuses.${report.status}`)}</Row>
          <Row label={t('reportedBy')}>
            <PersonName name={report.reporter.name} lang={locale} />
          </Row>
          <Row label={t('reportedAt')}>{when(report.reportedAt)}</Row>
          <Row label={t('said')}>
            <span className="whitespace-pre-line">
              <MarkedText text={report.note} lang={locale} />
            </span>
          </Row>
        </dl>
      </section>

      <section aria-labelledby="stay-heading" className="mb-8">
        <h2 id="stay-heading" className="mb-3 text-lg font-semibold">
          {t('stay')}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
          <Row
            label={t('listing')}
            lang={booking.listing.name ? booking.listing.contentLocale : undefined}
          >
            {booking.listing.name ? (
              <MarkedText text={booking.listing.name} lang={booking.listing.contentLocale} />
            ) : (
              <None />
            )}
          </Row>
          <Row label={t('space')} lang={booking.listing.contentLocale}>
            <MarkedText text={booking.spaceLabel} lang={booking.listing.contentLocale} />
          </Row>
          <Row label={t('when')}>
            {when(booking.startsAt)} – {when(booking.endsAt)}
          </Row>
          <Row label={t('booking')}>
            <Link
              href={`/bookings/${booking.id}`}
              className="text-primary underline underline-offset-4 hover:decoration-2"
            >
              {t('openBooking', { reference: booking.reference })}
            </Link>
            <span className="block text-sm text-muted-foreground">{t('openBookingHint')}</span>
          </Row>
        </dl>
      </section>

      {report.resolution ? (
        <section aria-labelledby="closed-heading" className="mb-8">
          <h2 id="closed-heading" className="mb-3 text-lg font-semibold">
            {t('closed')}
          </h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
            <Row label={t('closedBy')}>
              <PersonName name={report.resolution.by.name} lang={locale} />
            </Row>
            <Row label={t('closedAt')}>{when(report.resolution.at)}</Row>
            <Row label={t('closedNote')}>
              <span className="whitespace-pre-line">
                <MarkedText text={report.resolution.note} lang={locale} />
              </span>
            </Row>
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="mb-3 text-lg font-semibold">
          {t('actions')}
        </h2>
        <ClientMessages namespaces={CLIENT_NAMESPACES.overstay}>
          <OverstayActions id={report.id} canResolve={report.canResolve} own={report.own} />
        </ClientMessages>
      </section>
    </>
  );
}

function BackLink() {
  const t = useTranslations('Admin.overstay');
  return (
    <p className="mb-4 text-sm">
      <Link
        href="/overstays"
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
