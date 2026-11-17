import { parseBookingsCursor } from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { EarningsView } from '@/components/owner/earnings-view';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadOwnerEarnings } from '@/lib/bookings.server';
import { EARNINGS_HREF } from '@/lib/owner-href';
import { requireSession } from '@/lib/session';

interface EarningsPageProps extends LocaleParams {
  searchParams: Promise<{ after?: string | string[] }>;
}

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'Owner.earnings',
  });
  return { title: t('metaTitle') };
}

/** Where the list of parts sent starts: after a place a page gave out, or the first page. */
async function placeOf(searchParams: EarningsPageProps['searchParams']): Promise<string> {
  const { after } = await searchParams;
  return typeof after === 'string' && parseBookingsCursor(after) !== null ? after : '';
}

/**
 * What the signed-in owner has earned (5.1): their own part of each booking, after commission.
 * The API reads it for the person signed in; nothing here chooses whose it is.
 */
export default async function OwnerEarningsPage({ params, searchParams }: EarningsPageProps) {
  const locale = await localeFromParams(params);
  await requireSession(EARNINGS_HREF);
  const after = await placeOf(searchParams);
  const earnings = await loadOwnerEarnings(after);
  const t = await getTranslations({ locale, namespace: 'Owner' });

  return (
    <div className="mx-auto grid w-full max-w-3xl content-start gap-6 px-4 py-10">
      <Link
        href="/owner"
        className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('step.back')}
      </Link>
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('earnings.title')}</h1>
        <p className="text-muted-foreground">{t('earnings.lead')}</p>
      </div>
      {earnings ? (
        <EarningsView earnings={earnings} place={{ after }} />
      ) : (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('earnings.unavailable')}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
