import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@parkfairy/ui/components/card';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { requireSession } from '@/lib/session';
import { ApiIdentity } from './api-identity';
import { SignOutButton } from './sign-out-button';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Account' });
  return { title: t('metaTitle') };
}

export default async function AccountPage({ params }: LocaleParams) {
  const locale = await localeFromParams(params);
  const session = await requireSession('/account');
  const t = await getTranslations({ locale, namespace: 'Account' });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t('greeting', { name: session.user.name })}</h1>
          </CardTitle>
          <CardDescription>{t('signedInAs', { email: session.user.email })}</CardDescription>
        </CardHeader>
        <CardContent>
          <ApiIdentity />
        </CardContent>
        <CardFooter>
          <SignOutButton />
        </CardFooter>
      </Card>
    </div>
  );
}
