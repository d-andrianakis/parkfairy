import type { AdminPaymentItem } from '@parkfairy/api-client';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@parkfairy/ui/components/table';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { DisputeReason } from '@/components/dispute-reason';
import { MarkedText } from '@/components/marked-text';
import { MissingNotice } from '@/components/missing-notice';
import { None } from '@/components/none';
import { StandingNotice } from '@/components/standing-notice';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadPayments } from '@/lib/admin.server';
import { withClock } from '@/lib/clock';
import { accountPageUrl } from '@/lib/site';
import { requireSession } from '@/lib/session';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Admin' });
  return { title: t('payments.metaTitle') };
}

type Kind = 'lost' | 'open' | 'failed';

/** What needs support in money (5.2c3): three short lists, each row a way into its booking. */
export default async function PaymentsPage({ params }: LocaleParams) {
  const locale = await localeFromParams(params);
  const { standing } = await requireSession('/payments');
  if (standing !== 'staff')
    return <StandingNotice standing={standing} accountUrl={accountPageUrl(locale)} />;

  const t = await getTranslations({ locale, namespace: 'Admin' });
  const format = await getFormatter({ locale });
  const payments = await loadPayments();
  if (typeof payments === 'string') {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('payments.title')}</h1>
        <MissingNotice reason={payments === 'not-found' ? 'unavailable' : payments} />
      </>
    );
  }
  const when = (iso: string | null) =>
    iso ? (
      <time dateTime={iso}>
        {format.dateTime(
          new Date(iso),
          withClock(locale, { dateStyle: 'medium', timeStyle: 'short' }),
        )}
      </time>
    ) : (
      <None />
    );
  const money = (amount: { amountMinor: number; currency: string }) =>
    format.number(amount.amountMinor / 100, { style: 'currency', currency: amount.currency });

  const lists: { kind: Kind; items: AdminPaymentItem[]; more: boolean }[] = [
    { kind: 'lost', items: payments.lostDisputes, more: payments.more.lostDisputes },
    { kind: 'open', items: payments.openDisputes, more: payments.more.openDisputes },
    { kind: 'failed', items: payments.failedRefunds, more: payments.more.failedRefunds },
  ];

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t('payments.title')}</h1>
      <p className="mb-8 max-w-prose text-muted-foreground">{t('payments.lead')}</p>
      {lists.map(({ kind, items, more }) => (
        <section key={kind} aria-labelledby={`${kind}-heading`} className="mb-10">
          <h2 id={`${kind}-heading`} className="mb-1 text-lg font-semibold">
            {t(`payments.${kind}.heading`)}
          </h2>
          <p className="mb-3 max-w-prose text-sm text-muted-foreground">
            {t(`payments.${kind}.hint`)}
          </p>
          {items.length === 0 ? (
            <p className="text-muted-foreground">{t(`payments.${kind}.empty`)}</p>
          ) : (
            <>
              <Table>
                <TableCaption className="sr-only">{t(`payments.${kind}.caption`)}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t('payments.booking')}</TableHead>
                    <TableHead scope="col">{t('payments.listing')}</TableHead>
                    <TableHead scope="col">{t('payments.amount')}</TableHead>
                    {kind === 'failed' ? (
                      <TableHead scope="col">{t('payments.retries')}</TableHead>
                    ) : (
                      <>
                        <TableHead scope="col">{t('payments.status')}</TableHead>
                        <TableHead scope="col">{t('payments.reason')}</TableHead>
                      </>
                    )}
                    <TableHead scope="col">
                      {kind === 'open' ? t('payments.due') : t('payments.since')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.disputeId ?? row.bookingId}>
                      <TableHead scope="row" className="font-medium whitespace-normal">
                        <Link
                          href={`/bookings/${row.bookingId}`}
                          className="text-primary underline underline-offset-4 hover:decoration-2"
                        >
                          <bdi>{row.reference}</bdi>
                        </Link>
                      </TableHead>
                      <TableCell
                        lang={row.listingName ? row.contentLocale : undefined}
                        className="whitespace-normal"
                      >
                        {row.listingName ? (
                          <MarkedText text={row.listingName} lang={row.contentLocale} />
                        ) : (
                          t('payments.unnamed')
                        )}
                      </TableCell>
                      <TableCell>{money(row.amount)}</TableCell>
                      {kind === 'failed' ? (
                        <TableCell>{format.number(row.attempts)}</TableCell>
                      ) : (
                        <>
                          <TableCell className="whitespace-normal">
                            {row.disputeStatus ? (
                              t(`booking.disputeStatuses.${row.disputeStatus}`)
                            ) : (
                              <None />
                            )}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {row.reason ? <DisputeReason reason={row.reason} /> : <None />}
                          </TableCell>
                        </>
                      )}
                      <TableCell>{when(kind === 'open' ? row.dueBy : row.at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {more ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('payments.more', { max: items.length })}
                </p>
              ) : null}
            </>
          )}
        </section>
      ))}
    </>
  );
}
