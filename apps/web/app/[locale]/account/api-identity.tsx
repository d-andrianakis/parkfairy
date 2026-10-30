'use client';

import { getMeOptions } from '@parkfairy/api-client/react-query';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { LOCALE_ENDONYMS } from '@/i18n/locales';

/** Shows the identity the API derives from the session cookie, proving the cross-service session. */
export function ApiIdentity() {
  const t = useTranslations('Account');
  const format = useFormatter();
  const { data: me, isPending, isError } = useQuery(getMeOptions());

  if (isError) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertDescription>{t('apiError')}</AlertDescription>
      </Alert>
    );
  }

  // The layout is there from the first render and the values fill in, so nothing below
  // moves when the API answers (one line of "checking" used to grow to ten on a phone).
  return (
    <section aria-labelledby="api-identity-heading" className="grid gap-3">
      <h2 id="api-identity-heading" className="text-sm font-medium">
        {t('apiHeading')}
      </h2>
      <p role="status" className="sr-only">
        {isPending ? t('checking') : ''}
      </p>
      {/* Terms stack above their values on phones: Greek terms are too long for two columns. */}
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr] sm:gap-y-2 max-sm:[&>dd]:mb-2 [&>dd]:min-h-5">
        <dt className="text-muted-foreground">{t('userId')}</dt>
        <dd className="font-mono break-all" data-testid="api-user-id">
          {me?.id}
        </dd>
        <dt className="text-muted-foreground">{t('role')}</dt>
        <dd>{me ? t('roleName', { role: me.role }) : null}</dd>
        <dt className="text-muted-foreground">{t('preferredLanguage')}</dt>
        <dd lang={me?.locale} data-testid="api-user-locale">
          {me ? LOCALE_ENDONYMS[me.locale] : null}
        </dd>
        <dt className="text-muted-foreground">{t('twoFactor')}</dt>
        <dd data-testid="api-two-factor">
          {me ? t('twoFactorStatus', { enabled: String(me.twoFactorEnabled) }) : null}
        </dd>
        <dt className="text-muted-foreground">{t('memberSince')}</dt>
        <dd>
          {me ? (
            <time dateTime={me.createdAt}>
              {format.dateTime(new Date(me.createdAt), { dateStyle: 'long' })}
            </time>
          ) : null}
        </dd>
      </dl>
    </section>
  );
}
