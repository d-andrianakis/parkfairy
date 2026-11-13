import { Button } from '@parkfairy/ui/components/button';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { InviteAcceptance, KeepInviteToken } from '@/components/owner/invite-acceptance';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { INVITE_PATH } from '@/lib/owner-href';
import { getLayoutSession } from '@/lib/session';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

interface InvitePageProps {
  params: Promise<{ locale: string }>;
}

async function translations(locale: string) {
  return getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: 'Owner',
  });
}

export async function generateMetadata({ params }: InvitePageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await translations(locale);
  return { title: t('invite.title') };
}

/**
 * Where an invite's email leads (#56). Its token is after `#`, which only the browser sees: signed
 * in, the page reads it and asks the API what it is; signed out, it keeps it for the tab and asks
 * the person to sign in (or sign up) with the address invited, then comes back here.
 */
export default async function InvitePage({ params }: InvitePageProps) {
  const { locale } = await params;
  const t = await translations(locale);
  const session = await getLayoutSession();
  return (
    <div className="mx-auto grid w-full max-w-xl content-start gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{t('invite.title')}</h1>
      {session ? (
        <InviteAcceptance />
      ) : (
        <div className="grid gap-4">
          <KeepInviteToken />
          <p>{t('invite.signedOut')}</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild className={WRAPPING_BUTTON}>
              <Link href={{ pathname: '/sign-in', query: { next: INVITE_PATH } }}>
                {t('invite.signIn')}
              </Link>
            </Button>
            <Button asChild variant="outline" className={WRAPPING_BUTTON}>
              <Link href={{ pathname: '/sign-up', query: { next: INVITE_PATH } }}>
                {t('invite.signUp')}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
