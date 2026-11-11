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
import { ClientMessages } from '@/components/client-messages';
import { PersonName } from '@/components/parking/place-words';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { ApiIdentity } from './api-identity';
import { Providers } from './providers';
import { SignOutButton } from './sign-out-button';
import { TwoFactorSettings } from './two-factor-settings';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Account' });
  return { title: t('metaTitle') };
}

export default async function AccountPage({ params }: LocaleParams) {
  const locale = await localeFromParams(params);
  const session = await requireSession('/account');
  const t = await getTranslations({ locale, namespace: 'Account' });
  const tTwoFactor = await getTranslations({ locale, namespace: 'TwoFactorSettings' });

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-12">
      <ClientMessages namespaces={CLIENT_NAMESPACES.account}>
        <Providers>
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                <h1>
                  {t.rich('greeting', {
                    name: session.user.name,
                    person: () => <PersonName name={session.user.name} lang={locale} />,
                  })}
                </h1>
              </CardTitle>
              {/* Email addresses have no break points; let them wrap on narrow screens. */}
              <CardDescription className="wrap-anywhere">
                {t('signedInAs', { email: session.user.email })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ApiIdentity />
            </CardContent>
            <CardFooter>
              <SignOutButton />
            </CardFooter>
          </Card>
          <Card>
            <CardHeader>
              {/* leading-snug: the Greek heading wraps on phones, and accents need the room. */}
              <CardTitle className="leading-snug">
                <h2>{tTwoFactor('heading')}</h2>
              </CardTitle>
              <CardDescription>{tTwoFactor('intro')}</CardDescription>
            </CardHeader>
            <CardContent>
              <TwoFactorSettings
                enabled={session.user.twoFactorEnabled === true}
                email={session.user.email}
              />
            </CardContent>
          </Card>
        </Providers>
      </ClientMessages>
    </div>
  );
}
