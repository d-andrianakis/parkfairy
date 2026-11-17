import {
  type AdminOverstaysQuery,
  AdminOverstaysQuerySchema,
  OVERSTAY_STATUSES,
} from '@parkfairy/contracts';
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
import { cn } from '@parkfairy/ui/lib/utils';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';

import { MarkedText } from '@/components/marked-text';
import { MissingNotice } from '@/components/missing-notice';
import { StandingNotice } from '@/components/standing-notice';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadOverstays } from '@/lib/admin.server';
import { withClock } from '@/lib/clock';
import { requireSession } from '@/lib/session';
import { accountPageUrl } from '@/lib/site';

type Search = { status?: string | string[]; after?: string | string[] };

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Admin' });
  return { title: t('overstays.metaTitle') };
}

/** Each part of the address stands on its own: a mangled place keeps the status, and the reverse. */
function queryOf({ status, after }: Search): AdminOverstaysQuery {
  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : undefined;
  const kind = AdminOverstaysQuerySchema.shape.status.safeParse(one(status));
  const place = AdminOverstaysQuerySchema.shape.after.safeParse(one(after));
  return {
    status: kind.success ? kind.data : 'open',
    after: place.success ? place.data : undefined,
  };
}

/** What owners say about cars left past their stays (5.2c4): open reports, oldest first. */
export default async function OverstaysPage({
  params,
  searchParams,
}: LocaleParams & { searchParams: Promise<Search> }) {
  const locale = await localeFromParams(params);
  const { standing } = await requireSession('/overstays');
  if (standing !== 'staff')
    return <StandingNotice standing={standing} accountUrl={accountPageUrl(locale)} />;

  const { status, after } = queryOf(await searchParams);
  const t = await getTranslations({ locale, namespace: 'Admin' });
  const format = await getFormatter({ locale });
  const queue = await loadOverstays(status, after);
  const when = (iso: string) => (
    <time dateTime={iso}>
      {format.dateTime(
        new Date(iso),
        withClock(locale, { dateStyle: 'medium', timeStyle: 'short' }),
      )}
    </time>
  );

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t('overstays.title')}</h1>
      <p className="mb-6 max-w-prose text-muted-foreground">{t('overstays.lead')}</p>

      <nav aria-label={t('overstays.filter')} className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {OVERSTAY_STATUSES.map((value) => (
            <li key={value}>
              <Button
                asChild
                variant={value === status ? 'default' : 'outline'}
                size="sm"
                className={cn(value === status && 'font-semibold')}
              >
                <Link
                  href={{ pathname: '/overstays', query: { status: value } }}
                  aria-current={value === status ? 'true' : undefined}
                >
                  {t(`overstays.statuses.${value}`)}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      {typeof queue === 'string' ? (
        <MissingNotice reason={queue === 'not-found' ? 'unavailable' : queue} />
      ) : queue.reports.length === 0 ? (
        <p className="text-muted-foreground">{t(`overstays.empty.${status}`)}</p>
      ) : (
        <>
          <Table>
            <TableCaption className="sr-only">{t('overstays.caption', { status })}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('overstays.booking')}</TableHead>
                <TableHead scope="col">{t('overstays.listing')}</TableHead>
                <TableHead scope="col">{t('overstays.ended')}</TableHead>
                <TableHead scope="col">{t('overstays.reported')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.reports.map((row) => (
                <TableRow key={row.id}>
                  <TableHead scope="row" className="font-medium whitespace-normal">
                    <Link
                      href={`/overstays/${row.id}`}
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
                      t('overstays.unnamed')
                    )}
                  </TableCell>
                  <TableCell>{when(row.endedAt)}</TableCell>
                  <TableCell>{when(row.reportedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <nav aria-label={t('overstays.pages')} className="mt-6 flex flex-wrap gap-2">
            {after ? (
              <Button asChild variant="outline" size="sm">
                <Link href={{ pathname: '/overstays', query: { status } }}>
                  {t('overstays.first')}
                </Link>
              </Button>
            ) : null}
            {queue.next ? (
              <Button asChild variant="outline" size="sm">
                <Link href={{ pathname: '/overstays', query: { status, after: queue.next } }}>
                  {t('overstays.next')}
                </Link>
              </Button>
            ) : null}
          </nav>
        </>
      )}
    </>
  );
}
