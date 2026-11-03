import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountStepShell } from '@/components/owner/account-step-shell';
import { TaxForm } from '@/components/owner/tax-form';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadOwnerProfile } from '@/lib/owner.server';
import { requireSession } from '@/lib/session';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Owner' });
  return { title: t('stepNames.tax') };
}

export default async function OwnerTaxPage({ params }: LocaleParams) {
  const locale = await localeFromParams(params);
  await requireSession('/owner/tax');
  const t = await getTranslations({ locale, namespace: 'Owner.tax' });
  const profile = await loadOwnerProfile();

  return (
    <AccountStepShell step="tax" available={profile !== null}>
      {profile?.kind ? <TaxForm profile={profile} nextHref="/owner" /> : null}
      {profile && !profile.kind ? (
        <div className="grid gap-4">
          <Alert role={undefined}>
            <CircleAlert aria-hidden />
            <AlertDescription>{t('needsProfile')}</AlertDescription>
          </Alert>
          <div>
            <Button asChild>
              <Link href="/owner/profile">{t('toProfile')}</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </AccountStepShell>
  );
}
