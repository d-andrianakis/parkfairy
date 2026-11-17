import {
  ADMIN_LISTING_STATUSES,
  type AdminQueueQuery,
  AdminQueueQuerySchema,
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

import { MissingNotice } from '@/components/missing-notice';
import { None } from '@/components/none';
import { StandingNotice } from '@/components/standing-notice';
import { StatusBadge } from '@/components/status-badge';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadQueue } from '@/lib/admin.server';
import { withClock } from '@/lib/clock';
import { requireSession } from '@/lib/session';
import { accountPageUrl } from '@/lib/site';

type Search = { status?: string | string[]; after?: string | string[] };

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Admin' });
  return { title: t('queue.metaTitle') };
}

/**
 * The query the URL asks for. Each part stands on its own: a mangled place keeps the status and a
 * mangled status keeps the place, and either way the page is a queue, not an error.
 */
function queryOf({ status, after }: Search): AdminQueueQuery {
  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : undefined;
  const kind = AdminQueueQuerySchema.shape.status.safeParse(one(status));
  const place = AdminQueueQuerySchema.shape.after.safeParse(one(after));
  return {
    status: kind.success ? kind.data : 'in_review',
    after: place.success ? place.data : undefined,
  };
}

export default async function QueuePage({
  params,
  searchParams,
}: LocaleParams & { searchParams: Promise<Search> }) {
  const locale = await localeFromParams(params);
  const { session, standing } = await requireSession('/listings');
  if (standing !== 'staff')
    return <StandingNotice standing={standing} accountUrl={accountPageUrl(locale)} />;

  const { status, after } = queryOf(await searchParams);
  const t = await getTranslations({ locale, namespace: 'Admin' });
  const format = await getFormatter({ locale });
  const queue = await loadQueue(status, after);

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t('queue.title')}</h1>
      <p className="mb-6 text-muted-foreground">{t('queue.lead', { name: session.user.name })}</p>

      <nav aria-label={t('queue.filter')} className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {ADMIN_LISTING_STATUSES.map((value) => (
            <li key={value}>
              <Button
                asChild
                variant={value === status ? 'default' : 'outline'}
                size="sm"
                className={cn(value === status && 'font-semibold')}
              >
                <Link
                  href={{ pathname: '/listings', query: { status: value } }}
                  aria-current={value === status ? 'true' : undefined}
                >
                  {t(`status.${value}`)}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      {typeof queue === 'string' ? (
        <MissingNotice reason={queue === 'not-found' ? 'unavailable' : queue} />
      ) : queue.listings.length === 0 ? (
        <p className="text-muted-foreground">{t('queue.empty')}</p>
      ) : (
        <>
          <Table>
            <TableCaption className="sr-only">
              {t('queue.caption', { status: t(`status.${status}`) })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('queue.listing')}</TableHead>
                <TableHead scope="col">{t('queue.address')}</TableHead>
                <TableHead scope="col">{t('queue.owner')}</TableHead>
                <TableHead scope="col">{t('queue.sentIn')}</TableHead>
                <TableHead scope="col">{t('queue.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.listings.map((listing) => (
                <TableRow key={listing.id}>
                  <TableHead scope="row" className="font-medium whitespace-normal">
                    <Link
                      href={`/listings/${listing.id}`}
                      lang={listing.name ? listing.contentLocale : undefined}
                      className="text-primary underline underline-offset-4 hover:decoration-2"
                    >
                      {listing.name ?? t('queue.unnamed')}
                    </Link>
                  </TableHead>
                  <TableCell
                    lang={listing.address ? listing.contentLocale : undefined}
                    className="whitespace-normal"
                  >
                    {listing.address ?? <None />}
                  </TableCell>
                  <TableCell className="whitespace-normal">{listing.owner ?? <None />}</TableCell>
                  <TableCell>
                    {listing.submittedAt ? (
                      <time dateTime={listing.submittedAt}>
                        {format.dateTime(
                          new Date(listing.submittedAt),
                          withClock(locale, { dateStyle: 'medium', timeStyle: 'short' }),
                        )}
                      </time>
                    ) : (
                      <None />
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={listing.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <nav aria-label={t('queue.pages')} className="mt-6 flex flex-wrap gap-2">
            {after ? (
              <Button asChild variant="outline" size="sm">
                <Link href={{ pathname: '/listings', query: { status } }}>{t('queue.first')}</Link>
              </Button>
            ) : null}
            {queue.next ? (
              <Button asChild variant="outline" size="sm">
                <Link href={{ pathname: '/listings', query: { status, after: queue.next } }}>
                  {t('queue.next')}
                </Link>
              </Button>
            ) : null}
          </nav>
        </>
      )}
    </>
  );
}
