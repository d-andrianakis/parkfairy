import { Button } from '@parkfairy/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@parkfairy/ui/components/card';
import { Landmark } from 'lucide-react';
import type { OwnerPayouts } from '@parkfairy/contracts';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/**
 * The dashboard's word on payouts (decision #48): drivers can book an owner's parking once they
 * are set up, so it says where they stand and the way there. Nothing where payouts can't be set up
 * at all (no Stripe here, #47), or when the API can't say.
 */
export async function PayoutsCard({
  locale,
  payouts,
}: {
  locale: 'el' | 'en';
  payouts: OwnerPayouts | null;
}) {
  const t = await getTranslations({ locale, namespace: 'Owner' });
  if (!payouts?.available) return null;
  const done = payouts.status === 'active';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg leading-snug">
          <Landmark aria-hidden className="size-5" />
          <h2>{t('payouts.title')}</h2>
        </CardTitle>
        <CardDescription>{t(`payouts.status.${payouts.status}`)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          asChild
          variant={done ? 'outline' : 'default'}
          size="sm"
          className={WRAPPING_BUTTON}
        >
          <Link href="/owner/payouts">
            {done || payouts.status === 'pending'
              ? t('dashboard.payoutsSee')
              : t('dashboard.payoutsSetUp')}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
