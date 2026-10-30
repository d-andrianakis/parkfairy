import { Button } from '@parkfairy/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@parkfairy/ui/components/card';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { usableToken } from '@/lib/email-link-params';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { ResetPasswordForm } from './reset-password-form';

interface ResetPasswordProps extends LocaleParams {
  searchParams: Promise<{
    token?: string | string[];
    error?: string | string[];
    done?: string | string[];
  }>;
}

/** The form moves here once the password is saved; nothing about it needs a secret. */
function pageState(search: Awaited<ResetPasswordProps['searchParams']>) {
  if (search.done !== undefined) return 'done';
  return usableToken(search) ? 'form' : 'invalid';
}

export async function generateMetadata({
  params,
  searchParams,
}: ResetPasswordProps): Promise<Metadata> {
  const t = await getTranslations({
    locale: await localeFromParams(params),
    namespace: 'ResetPassword',
  });
  const titles = { done: 'doneTitle', form: 'metaTitle', invalid: 'invalidTitle' } as const;
  // The URL holds a live token, so no indexing (next.config.ts also sends no Referer from here).
  return {
    title: t(titles[pageState(await searchParams)]),
    robots: { index: false, follow: false },
  };
}

export default async function ResetPasswordPage({ params, searchParams }: ResetPasswordProps) {
  const locale = await localeFromParams(params);
  const search = await searchParams;
  const state = pageState(search);
  const token = usableToken(search);
  const t = await getTranslations({ locale, namespace: 'ResetPassword' });

  if (state === 'done') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl wrap-anywhere">
            <h1>{t('doneTitle')}</h1>
          </CardTitle>
          <CardDescription>{t('doneBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className={WRAPPING_BUTTON}>
            <Link href="/sign-in">{t('signIn')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl wrap-anywhere">
            <h1>{t('invalidTitle')}</h1>
          </CardTitle>
          <CardDescription>{t('invalidBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className={WRAPPING_BUTTON}>
            <Link href="/forgot-password">{t('requestNew')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl wrap-anywhere">
          <h1>{t('title')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm token={token} />
      </CardContent>
    </Card>
  );
}
