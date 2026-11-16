import { Badge } from '@parkfairy/ui/components/badge';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { PersonName } from '@/components/marked-text';
import { MissingNotice } from '@/components/missing-notice';
import { StandingNotice } from '@/components/standing-notice';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadUser } from '@/lib/admin.server';
import { withClock } from '@/lib/clock';
import { accountPageUrl } from '@/lib/site';
import { requireSession } from '@/lib/session';
import { AccountModerationPanel } from './account-moderation-panel';
import { RemoveTwoFactorPanel } from './remove-two-factor-panel';

type Props = LocaleParams & { params: Promise<{ locale: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Admin' });
  return { title: t('user.metaTitle') };
}

export default async function UserPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const locale = await localeFromParams(params);
  const { standing } = await requireSession(`/users/${id}`);
  if (standing !== 'staff')
    return <StandingNotice standing={standing} accountUrl={accountPageUrl(locale)} />;

  const t = await getTranslations({ locale, namespace: 'Admin' });
  const user = await loadUser(id);
  if (user === 'not-found') notFound();
  if (typeof user === 'string') {
    return (
      <>
        <BackLink />
        <MissingNotice reason={user} />
      </>
    );
  }
  const format = await getFormatter({ locale });

  return (
    <>
      <BackLink />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          <PersonName name={user.name} lang={locale} />
        </h1>
        {user.role === 'admin' ? <Badge variant="secondary">{t('user.roles.admin')}</Badge> : null}
      </div>

      <section aria-labelledby="facts-heading" className="mb-8">
        <h2 id="facts-heading" className="mb-3 text-lg font-semibold">
          {t('user.facts')}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
          <Row label={t('user.name')}>
            <PersonName name={user.name} lang={locale} />
          </Row>
          <Row label={t('user.email')}>
            <bdi>{user.email}</bdi>
          </Row>
          <Row label={t('user.role')}>{t(`user.roles.${user.role}`)}</Row>
          <Row label={t('user.verified')}>{t(user.emailVerified ? 'user.yes' : 'user.no')}</Row>
          <Row label={t('user.status')}>
            {user.suspended ? (
              <Badge variant="destructive">{t('user.suspended')}</Badge>
            ) : (
              t('user.active')
            )}
          </Row>
          <Row label={t('user.twoFactor')}>{t(user.twoFactorEnabled ? 'user.on' : 'user.off')}</Row>
          <Row label={t('user.language')}>
            {/* Each language in its own words, as the language switcher has them (WCAG 3.1.2). */}
            <span lang={user.locale}>{t(`user.locales.${user.locale}`)}</span>
          </Row>
          <Row label={t('user.created')}>
            <time dateTime={user.createdAt}>
              {format.dateTime(
                new Date(user.createdAt),
                withClock(locale, { dateStyle: 'medium', timeStyle: 'short' }),
              )}
            </time>
          </Row>
        </dl>
      </section>

      <section aria-labelledby="security-heading">
        <h2 id="security-heading" className="mb-3 text-lg font-semibold">
          {t('user.security')}
        </h2>
        <ClientMessages namespaces={CLIENT_NAMESPACES.account}>
          <RemoveTwoFactorPanel
            id={user.id}
            own={user.own}
            staff={user.role === 'admin'}
            twoFactorEnabled={user.twoFactorEnabled}
            canRemove={user.canRemoveTwoFactor}
          />
        </ClientMessages>
      </section>

      <section aria-labelledby="suspension-heading" className="mt-8">
        <h2 id="suspension-heading" className="mb-3 text-lg font-semibold">
          {t('user.moderation')}
        </h2>
        <ClientMessages namespaces={CLIENT_NAMESPACES.account}>
          <AccountModerationPanel
            id={user.id}
            own={user.own}
            staff={user.role === 'admin'}
            canSuspend={user.canSuspend}
            canReinstate={user.canReinstate}
            liveListings={user.liveListings}
          />
        </ClientMessages>
      </section>
    </>
  );
}

function BackLink() {
  const t = useTranslations('Admin.user');
  return (
    <p className="mb-4 text-sm">
      <Link href="/users" className="text-primary underline underline-offset-4 hover:decoration-2">
        {t('back')}
      </Link>
    </p>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
