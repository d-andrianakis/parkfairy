import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { ArrowLeft, CircleAlert, CircleCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FocusHeading } from '@/components/focus-heading';
import { PayoutButton } from '@/components/owner/payout-button';
import { Link } from '@/i18n/navigation';
import { localeFromParams } from '@/i18n/params';
import { loadOwnerPayouts } from '@/lib/owner.server';
import { requireSession } from '@/lib/session';

interface PayoutsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ link?: string | string[] }>;
}

export async function generateMetadata({ params }: PayoutsPageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Owner' });
  return { title: t('payouts.metaTitle') };
}

/**
 * Where the owner's payouts stand, and the way to Stripe to set them up (decision #48). Stripe
 * sends the owner back here: `?link=returned` when they finished or stopped, `?link=expired` when
 * the link ran out and they need a new one. Either way the page says where things stand now.
 */
export default async function PayoutsPage({ params, searchParams }: PayoutsPageProps) {
  const locale = await localeFromParams(params);
  await requireSession('/owner/payouts');
  const [t, payouts, { link }] = await Promise.all([
    getTranslations({ locale, namespace: 'Owner' }),
    loadOwnerPayouts(),
    searchParams,
  ]);
  const back = typeof link === 'string' ? link : undefined;

  return (
    <div className="mx-auto grid w-full max-w-2xl content-start gap-6 px-4 py-10">
      <Link
        href="/owner"
        className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('step.back')}
      </Link>
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('payouts.title')}</h1>
        <p className="text-muted-foreground">{t('payouts.lead')}</p>
      </div>
      {!payouts ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('errors.generic')}</AlertDescription>
        </Alert>
      ) : !payouts.available ? (
        <Alert>
          <CircleAlert aria-hidden />
          <AlertDescription>{t('errors.PAYMENTS_UNAVAILABLE')}</AlertDescription>
        </Alert>
      ) : (
        <>
          {back === 'returned' || back === 'expired' ? (
            // Back from Stripe: said, and the focus here, so a screen reader starts from it.
            <Alert key={back} role={undefined}>
              {back === 'returned' ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
              <AlertTitle className="line-clamp-none">
                <FocusHeading>
                  {back === 'returned' ? t('payouts.returned') : t('payouts.expired')}
                </FocusHeading>
              </AlertTitle>
            </Alert>
          ) : null}
          <p>{t(`payouts.status.${payouts.status}`)}</p>
          {payouts.status === 'pending' ? null : (
            <PayoutButton
              kind={
                payouts.status === 'none'
                  ? 'start'
                  : payouts.status === 'restricted'
                    ? 'continue'
                    : 'dashboard'
              }
            />
          )}
        </>
      )}
    </div>
  );
}
