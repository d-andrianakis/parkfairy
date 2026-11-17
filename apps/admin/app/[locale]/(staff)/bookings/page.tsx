import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ClientMessages } from '@/components/client-messages';
import { StandingNotice } from '@/components/standing-notice';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { requireSession } from '@/lib/session';
import { accountPageUrl } from '@/lib/site';

import { BookingLookupForm } from './lookup-form';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Admin' });
  return { title: t('bookings.metaTitle') };
}

/** Support's way to a booking: one reference, never a list of everyone's bookings. */
export default async function BookingsPage({ params }: LocaleParams) {
  const locale = await localeFromParams(params);
  const { standing } = await requireSession('/bookings');
  if (standing !== 'staff')
    return <StandingNotice standing={standing} accountUrl={accountPageUrl(locale)} />;

  const t = await getTranslations({ locale, namespace: 'Admin' });
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t('bookings.title')}</h1>
      <p className="mb-6 max-w-prose text-muted-foreground">{t('bookings.lead')}</p>
      <div className="max-w-md">
        <ClientMessages namespaces={CLIENT_NAMESPACES.bookingLookup}>
          <BookingLookupForm />
        </ClientMessages>
      </div>
    </>
  );
}
