import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@parkfairy/ui/components/card';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { getSession } from '@/lib/session';
import { SignUpForm } from './sign-up-form';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'SignUp' });
  return { title: t('metaTitle') };
}

export default async function SignUpPage({ params }: LocaleParams) {
  const locale = await localeFromParams(params);
  if (await getSession()) redirect({ href: '/account', locale });
  const t = await getTranslations({ locale, namespace: 'SignUp' });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t('title')}</h1>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <SignUpForm />
        <p className="text-sm text-muted-foreground">
          {t('haveAccount')}{' '}
          <Link
            href="/sign-in"
            className="text-primary underline underline-offset-4 hover:decoration-2"
          >
            {t('signInLink')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
