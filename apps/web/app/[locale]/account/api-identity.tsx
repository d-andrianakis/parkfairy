'use client';

import { getMeOptions } from '@parkfairy/api-client/react-query';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { LOCALE_ENDONYMS } from '@/i18n/locales';

/** Shows the identity the API derives from the session cookie, proving the cross-service session. */
export function ApiIdentity() {
  const t = useTranslations('Account');
  const format = useFormatter();
  const { data: me, isPending, isError } = useQuery(getMeOptions());

  if (isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('checking')}
      </p>
    );
  }
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('apiError')}
      </p>
    );
  }

  return (
    <section aria-labelledby="api-identity-heading" className="grid gap-3">
      <h2 id="api-identity-heading" className="text-sm font-medium">
        {t('apiHeading')}
      </h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('userId')}</dt>
        <dd className="font-mono break-all" data-testid="api-user-id">
          {me.id}
        </dd>
        <dt className="text-muted-foreground">{t('role')}</dt>
        <dd>{t('roleName', { role: me.role })}</dd>
        <dt className="text-muted-foreground">{t('preferredLanguage')}</dt>
        <dd lang={me.locale} data-testid="api-user-locale">
          {LOCALE_ENDONYMS[me.locale]}
        </dd>
        <dt className="text-muted-foreground">{t('twoFactor')}</dt>
        <dd>{t('twoFactorStatus', { enabled: String(me.twoFactorEnabled) })}</dd>
        <dt className="text-muted-foreground">{t('memberSince')}</dt>
        <dd>
          <time dateTime={me.createdAt}>
            {format.dateTime(new Date(me.createdAt), { dateStyle: 'long' })}
          </time>
        </dd>
      </dl>
    </section>
  );
}
