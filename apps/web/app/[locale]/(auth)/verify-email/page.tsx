import { Card, CardContent, CardHeader, CardTitle } from '@parkfairy/ui/components/card';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { usableToken } from '@/lib/email-link-params';
import { getSession } from '@/lib/session';
import { EmailLinkForm } from '../email-link-form';
import { ConfirmEmail } from './confirm-email';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'VerifyEmail',
  });
  return { title: t('requestTitle'), robots: { index: false, follow: false } };
}

/** Where the emailed link lands; without one it is a page to ask for a new link. */
export default async function VerifyEmailPage({
  params,
  searchParams,
}: LocaleParams & { searchParams: Promise<{ token?: string | string[] }> }) {
  const locale = await localeFromParams(params);
  const token = usableToken(await searchParams);
  // A session means the address is confirmed already, so asking for a link could only fail.
  if (!token && (await getSession())) redirect({ href: '/account', locale });
  const t = await getTranslations({ locale, namespace: 'VerifyEmail' });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl wrap-anywhere">
          <h1>{t('requestTitle')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {token ? (
          <ConfirmEmail token={token} />
        ) : (
          <EmailLinkForm purpose="verify-email" intro={t('requestBody')} />
        )}
      </CardContent>
    </Card>
  );
}
