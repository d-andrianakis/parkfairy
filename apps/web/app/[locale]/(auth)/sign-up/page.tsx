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
import { showsSentPanel, type SentPanelSearch } from '@/lib/email-link-params';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { getSession } from '@/lib/session';
import { SignUpForm } from './sign-up-form';

export async function generateMetadata({
  params,
  searchParams,
}: LocaleParams & SentPanelSearch): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'SignUp' });
  return { title: t(showsSentPanel(await searchParams) ? 'sentTitle' : 'metaTitle') };
}

/**
 * `?next=` comes from signing in (a driver sent there to book) and goes back with the link to it,
 * so the stay they chose survives creating an account (3.1). The emailed link can't carry it: links
 * in emails are rebuilt without anything a request said (memory.md).
 */
export default async function SignUpPage({
  params,
  searchParams,
}: LocaleParams & { searchParams: Promise<{ next?: string | string[] }> }) {
  const locale = await localeFromParams(params);
  const { next } = await searchParams;
  const returnTo = safeRedirectPath(typeof next === 'string' ? next : undefined);
  if (await getSession()) redirect({ href: returnTo, locale });
  const t = await getTranslations({ locale, namespace: 'SignUp' });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t('title')}</h1>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <SignUpForm />
        <p className="text-sm text-muted-foreground">
          {t('haveAccount')}{' '}
          <Link
            href={{
              pathname: '/sign-in',
              query: typeof next === 'string' ? { next: returnTo } : {},
            }}
            className="text-primary underline underline-offset-4 hover:decoration-2"
          >
            {t('signInLink')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
