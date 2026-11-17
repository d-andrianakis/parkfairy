import type { EarningLine, OwnerEarnings } from '@parkfairy/api-client';
import { EARNINGS_MONTHS } from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@parkfairy/ui/components/table';
import { CircleAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { PlaceWords } from '@/components/parking/place-words';
import { Link } from '@/i18n/navigation';
import { EARNINGS_HREF } from '@/lib/owner-href';

interface Place {
  /** The page's own `after`, or none on the first. */
  after: string;
}

/**
 * What the signed-in owner has earned (5.1): their own part of each booking, after our commission
 * (#50, #51). The API sends only this owner's rows, so a co-owner's share is never here. Every
 * list is a real table with a caption, so a screen reader can walk it by row and column.
 */
export function EarningsView({ earnings, place }: { earnings: OwnerEarnings; place: Place }) {
  const t = useTranslations('Owner.earnings');
  const dashboard = useTranslations('Owner.dashboard');
  const format = useFormatter();
  const money = ({ amountMinor, currency }: { amountMinor: number; currency: string }) =>
    format.number(amountMinor / 100, { style: 'currency', currency });
  const day = (instant: string) => format.dateTime(new Date(instant), { dateStyle: 'medium' });
  const month = (value: string) => {
    const [year, number] = value.split('-').map(Number);
    // Mid-month, in UTC: a month's name doesn't move with any time zone.
    return format.dateTime(new Date(Date.UTC(year ?? 1970, (number ?? 1) - 1, 15)), {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };
  const listingName = (line: EarningLine['listing']) =>
    line.name ? (
      <span lang={line.contentLocale}>
        <PlaceWords text={line.name} lang={line.contentLocale} />
      </span>
    ) : (
      dashboard('untitled')
    );
  const bookingCell = (line: EarningLine) => (
    <>
      <span className="font-mono">{line.reference}</span>
      <span className="block text-muted-foreground">{listingName(line.listing)}</span>
    </>
  );

  const summary: [string, string][] = [
    [t('sent'), money(earnings.sent)],
    [t('sending'), money(earnings.sending)],
    [t('coming'), format.number(earnings.coming)],
  ];
  const first = !place.after;

  return (
    <>
      <section aria-labelledby="earnings-summary" className="grid gap-3">
        <h2 id="earnings-summary" className="sr-only">
          {t('summaryLabel')}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          {summary.map(([term, value]) => (
            <div key={term} className="grid content-start gap-1 rounded-lg border p-4">
              <dt className="text-sm text-muted-foreground">{term}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {earnings.held.account > 0 ? (
        <Alert role={undefined}>
          <CircleAlert aria-hidden />
          <AlertDescription>
            <p>{t('holdAccount', { count: earnings.held.account })}</p>
            <p>
              <Link
                href="/owner/payouts"
                className="text-primary underline underline-offset-4 hover:decoration-2"
              >
                {t('payoutsLink')}
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {earnings.held.dispute > 0 ? (
        <Alert role={undefined}>
          <CircleAlert aria-hidden />
          <AlertDescription>{t('holdDispute', { count: earnings.held.dispute })}</AlertDescription>
        </Alert>
      ) : null}

      {earnings.inProgress.length > 0 ? (
        <section aria-labelledby="earnings-in-progress" className="grid gap-3">
          <h2 id="earnings-in-progress" className="text-xl font-semibold">
            {t('inProgressTitle')}
          </h2>
          <Table>
            <TableCaption className="sr-only">{t('inProgressCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('booking')}</TableHead>
                <TableHead scope="col">{t('stayEnded')}</TableHead>
                <TableHead scope="col">{t('amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {earnings.inProgress.map((line) => (
                <TableRow key={line.id}>
                  <TableHead scope="row" className="whitespace-normal font-normal">
                    {bookingCell(line)}
                    <span className="block text-sm">{t(`holdLabel.${line.hold ?? 'none'}`)}</span>
                  </TableHead>
                  <TableCell>
                    <time dateTime={line.end}>{day(line.end)}</time>
                  </TableCell>
                  <TableCell className="tabular-nums whitespace-nowrap">
                    {money(line.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {first && earnings.months.length > 0 ? (
        <section aria-labelledby="earnings-months" className="grid gap-3">
          <h2 id="earnings-months" className="text-xl font-semibold">
            {t('monthsTitle')}
          </h2>
          <Table>
            <TableCaption className="sr-only">
              {t('monthsCaption', { count: EARNINGS_MONTHS })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('month')}</TableHead>
                <TableHead scope="col">{t('sent')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {earnings.months.map((row) => (
                <TableRow key={row.month}>
                  <TableHead scope="row" className="font-normal">
                    {month(row.month)}
                  </TableHead>
                  <TableCell className="tabular-nums whitespace-nowrap">
                    {money(row.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {first && earnings.listings.length > 0 ? (
        <section aria-labelledby="earnings-listings" className="grid gap-3">
          <h2 id="earnings-listings" className="text-xl font-semibold">
            {t('listingsTitle')}
          </h2>
          <Table>
            <TableCaption className="sr-only">{t('listingsCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('listing')}</TableHead>
                <TableHead scope="col">{t('sent')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {earnings.listings.map((row) => (
                <TableRow key={row.listing.id}>
                  <TableHead scope="row" className="whitespace-normal font-normal">
                    {listingName(row.listing)}
                  </TableHead>
                  <TableCell className="tabular-nums whitespace-nowrap">
                    {money(row.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      <section aria-labelledby="earnings-sent" className="grid gap-3">
        <h2 id="earnings-sent" className="text-xl font-semibold">
          {t('linesTitle')}
        </h2>
        {earnings.lines.length === 0 ? (
          <p>{t('empty')}</p>
        ) : (
          <Table>
            <TableCaption className="sr-only">{t('linesCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('booking')}</TableHead>
                <TableHead scope="col">{t('sentOn')}</TableHead>
                <TableHead scope="col">{t('amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {earnings.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableHead scope="row" className="whitespace-normal font-normal">
                    {bookingCell(line)}
                    <span className="block text-sm text-muted-foreground">
                      {t.rich('stayEndedOn', {
                        when: day(line.end),
                        time: (chunks) => <time dateTime={line.end}>{chunks}</time>,
                      })}
                    </span>
                  </TableHead>
                  <TableCell>
                    {line.sentAt ? <time dateTime={line.sentAt}>{day(line.sentAt)}</time> : null}
                  </TableCell>
                  <TableCell className="tabular-nums whitespace-nowrap">
                    {money(line.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!first || earnings.next ? (
          <nav aria-label={t('pagesLabel')} className="flex flex-wrap justify-between gap-2">
            {!first ? (
              <Button asChild variant="outline" size="sm">
                <Link href={EARNINGS_HREF}>{t('newest')}</Link>
              </Button>
            ) : (
              <span />
            )}
            {earnings.next ? (
              <Button asChild variant="outline" size="sm">
                <Link href={{ pathname: EARNINGS_HREF, query: { after: earnings.next } }}>
                  {t('older')}
                </Link>
              </Button>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
