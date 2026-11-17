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
import { safeRedirectPath } from '@/lib/safe-redirect';

import { TwoFactorForm } from './two-factor-form';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'TwoFactor',
  });
  return { title: t('metaTitle') };
}

export default async function TwoFactorPage({
  params,
  searchParams,
}: LocaleParams & { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const returnTo = safeRedirectPath(typeof next === 'string' ? next : undefined);
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'TwoFactor',
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t('title')}</h1>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <TwoFactorForm returnTo={returnTo} />
      </CardContent>
    </Card>
  );
}
