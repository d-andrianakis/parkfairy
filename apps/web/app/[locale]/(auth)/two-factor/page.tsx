import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@parkfairy/ui/components/card';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { TwoFactorForm } from './two-factor-form';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'TwoFactor',
  });
  return { title: t('metaTitle') };
}

export default async function TwoFactorPage({ params }: LocaleParams) {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'TwoFactor',
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t('title')}</h1>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <TwoFactorForm />
      </CardContent>
    </Card>
  );
}
