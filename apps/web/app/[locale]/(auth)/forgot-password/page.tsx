import { Card, CardContent, CardHeader, CardTitle } from '@parkfairy/ui/components/card';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { showsSentPanel, type SentPanelSearch } from '@/lib/email-link-params';
import { EmailLinkForm } from '../email-link-form';

export async function generateMetadata({
  params,
  searchParams,
}: LocaleParams & SentPanelSearch): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'ForgotPassword',
  });
  return { title: t(showsSentPanel(await searchParams) ? 'sentTitle' : 'metaTitle') };
}

export default async function ForgotPasswordPage({ params }: LocaleParams) {
  const locale = await localeFromParams(params);
  const t = await getTranslations({ locale, namespace: 'ForgotPassword' });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl wrap-anywhere">
          <h1>{t('title')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <EmailLinkForm purpose="reset-password" intro={t('description')} />
        <p className="text-sm text-muted-foreground">
          <Link
            href="/sign-in"
            className="text-primary underline underline-offset-4 hover:decoration-2"
          >
            {t('backToSignIn')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
