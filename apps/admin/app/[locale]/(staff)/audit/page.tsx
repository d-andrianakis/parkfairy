import { AUDIT_ACTIONS, AdminAuditQuerySchema, type AdminAuditQuery } from '@parkfairy/contracts';
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
import { MarkedText, PersonName } from '@/components/marked-text';
import { MissingNotice } from '@/components/missing-notice';
import { StandingNotice } from '@/components/standing-notice';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadAudit } from '@/lib/admin.server';
import { withClock } from '@/lib/clock';
import { accountPageUrl } from '@/lib/site';
import { requireSession } from '@/lib/session';

type Search = { action?: string | string[]; after?: string | string[] };

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Admin' });
  return { title: t('audit.metaTitle') };
}

/**
 * The query the URL asks for. Each part stands on its own: a mangled place keeps the filter and a
 * mangled filter keeps the place, and either way the page is the log, not an error.
 */
function queryOf({ action, after }: Search): AdminAuditQuery {
  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : undefined;
  const kind = AdminAuditQuerySchema.shape.action.safeParse(one(action));
  const place = AdminAuditQuerySchema.shape.after.safeParse(one(after));
  return {
    action: kind.success ? kind.data : undefined,
    after: place.success ? place.data : undefined,
  };
}

export default async function AuditPage({
  params,
  searchParams,
}: LocaleParams & { searchParams: Promise<Search> }) {
  const locale = await localeFromParams(params);
  const { standing } = await requireSession('/audit');
  if (standing !== 'staff')
    return <StandingNotice standing={standing} accountUrl={accountPageUrl(locale)} />;

  const { action, after } = queryOf(await searchParams);
  const t = await getTranslations({ locale, namespace: 'Admin' });
  const format = await getFormatter({ locale });
  const log = await loadAudit(action, after);
  const query = action ? { action } : {};

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t('audit.title')}</h1>
      <p className="mb-6 text-muted-foreground">{t('audit.lead')}</p>

      <nav aria-label={t('audit.filter')} className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {[undefined, ...AUDIT_ACTIONS].map((value) => (
            <li key={value ?? 'all'}>
              <Button
                asChild
                variant={value === action ? 'default' : 'outline'}
                size="sm"
                // Wraps: the names of some actions are longer than a phone's width (WCAG 1.4.10).
                className={cn(
                  'h-auto min-h-8 py-1.5 text-start whitespace-normal',
                  value === action && 'font-semibold',
                )}
              >
                <Link
                  href={{ pathname: '/audit', query: value ? { action: value } : {} }}
                  aria-current={value === action ? 'true' : undefined}
                >
                  {value ? t(`audit.actions.${value}`) : t('audit.all')}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      {typeof log === 'string' ? (
        <MissingNotice reason={log === 'not-found' ? 'unavailable' : log} />
      ) : log.entries.length === 0 ? (
        <p className="text-muted-foreground">{t('audit.empty')}</p>
      ) : (
        <>
          <Table>
            <TableCaption className="sr-only">{t('audit.caption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('audit.when')}</TableHead>
                <TableHead scope="col">{t('audit.who')}</TableHead>
                <TableHead scope="col">{t('audit.what')}</TableHead>
                <TableHead scope="col">{t('audit.target')}</TableHead>
                <TableHead scope="col">{t('audit.details')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableHead scope="row" className="font-normal">
                    <time dateTime={entry.at}>
                      {format.dateTime(
                        new Date(entry.at),
                        withClock(locale, { dateStyle: 'medium', timeStyle: 'medium' }),
                      )}
                    </time>
                  </TableHead>
                  <TableCell className="whitespace-normal">
                    <PersonName name={entry.actor.name} lang={locale} />
                    <span className="block text-sm text-muted-foreground">{entry.actor.email}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {actionLabel(t as unknown as Translator, entry.action)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/${entry.targetType === 'user' ? 'users' : 'listings'}/${entry.targetId}`}
                      className="text-primary underline underline-offset-4 hover:decoration-2"
                    >
                      {t(entry.targetType === 'user' ? 'audit.userLink' : 'audit.listingLink')}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Details
                      details={entry.details}
                      t={t as unknown as Translator}
                      format={format}
                      locale={locale}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <nav aria-label={t('audit.pages')} className="mt-6 flex flex-wrap gap-2">
            {after ? (
              <Button asChild variant="outline" size="sm">
                <Link href={{ pathname: '/audit', query }}>{t('audit.first')}</Link>
              </Button>
            ) : null}
            {log.next ? (
              <Button asChild variant="outline" size="sm">
                <Link href={{ pathname: '/audit', query: { ...query, after: log.next } }}>
                  {t('audit.next')}
                </Link>
              </Button>
            ) : null}
          </nav>
        </>
      )}
    </>
  );
}

/** The log can hold names this catalog doesn't know, so these lookups are by name, not by type. */
interface Translator {
  (key: string): string;
  has(key: string): boolean;
}

/**
 * What was recorded, as the log has it. Names and values the app knows are put in words; any other
 * stays as written, since the log may hold more than this screen was made for.
 */
function Details({
  details,
  t,
  format,
  locale,
}: {
  details: Record<string, string | number | boolean | null>;
  t: Translator;
  format: Awaited<ReturnType<typeof getFormatter>>;
  locale: string;
}) {
  const entries = Object.entries(details);
  if (entries.length === 0) return null;
  const label = (key: string) =>
    t.has(`audit.detailKeys.${key}`) ? t(`audit.detailKeys.${key}`) : key;
  const valueOf = (key: string, value: string | number | boolean | null) => {
    if (key === 'from' && typeof value === 'string' && t.has(`status.${value}`)) {
      return t(`status.${value}`);
    }
    if (key === 'kind' && typeof value === 'string' && t.has(`proofKinds.${value}`)) {
      return t(`proofKinds.${value}`);
    }
    if (typeof value === 'boolean') return t(value ? 'audit.yes' : 'audit.no');
    if (typeof value === 'number') return format.number(value);
    if (value === null) return t('notGiven');
    // Words staff typed (a note): Greek in them is marked Greek on an English page.
    return <MarkedText text={value} lang={locale} />;
  };
  return (
    <dl className="grid gap-x-2 sm:grid-cols-[max-content_1fr]">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{label(key)}</dt>
          <dd className="min-w-0 break-words whitespace-pre-line">{valueOf(key, value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An action a newer API logs that this screen has no words for is still a line, said generally. */
function actionLabel(t: Translator, action: string): string {
  return t.has(`audit.actions.${action}`) ? t(`audit.actions.${action}`) : t('audit.unknownAction');
}
