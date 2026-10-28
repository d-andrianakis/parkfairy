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
import { safeRedirectPath } from '@/lib/safe-redirect';
import { getSession } from '@/lib/session';
import { SignInForm } from './sign-in-form';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'SignIn' });
  return { title: t('metaTitle') };
}

export default async function SignInPage({
  params,
  searchParams,
}: LocaleParams & { searchParams: Promise<{ next?: string | string[] }> }) {
  const locale = await localeFromParams(params);
  const { next } = await searchParams;
  const returnTo = safeRedirectPath(typeof next === 'string' ? next : undefined);
  if (await getSession()) redirect({ href: returnTo, locale });
  const t = await getTranslations({ locale, namespace: 'SignIn' });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t('title')}</h1>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <SignInForm returnTo={returnTo} />
        <p className="text-sm text-muted-foreground">
          {t('noAccount')}{' '}
          <Link
            href="/sign-up"
            className="text-primary underline underline-offset-4 hover:decoration-2"
          >
            {t('signUpLink')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
