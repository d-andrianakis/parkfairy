import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ClientMessages } from '@/components/client-messages';
import { VehiclesManager } from '@/components/vehicles/vehicles-manager';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadVehicles } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'Vehicles',
  });
  return { title: t('metaTitle') };
}

/** The driver's saved vehicles (5A.2): private, and what the booking page offers instead of typing a plate. */
export default async function VehiclesPage({ params }: LocaleParams) {
  const locale = await localeFromParams(params);
  await requireSession('/account/vehicles');
  const vehicles = await loadVehicles();
  const t = await getTranslations({ locale, namespace: 'Vehicles' });

  return (
    <div className="mx-auto grid w-full max-w-2xl content-start gap-6 px-4 py-10">
      <Link
        href="/account"
        className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      {vehicles === null ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('unavailable')}</AlertDescription>
        </Alert>
      ) : (
        <ClientMessages namespaces={CLIENT_NAMESPACES.vehicles}>
          <VehiclesManager initial={vehicles} />
        </ClientMessages>
      )}
    </div>
  );
}
