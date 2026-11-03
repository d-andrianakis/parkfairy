import { Button } from '@parkfairy/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@parkfairy/ui/components/card';
import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

const NEEDED = ['details', 'tax', 'proof', 'photos'] as const;
const JOURNEY = ['about', 'place', 'prices', 'review'] as const;

/** For anyone who hasn't started: what it takes, before they commit to anything. */
export function OwnerLanding({ action }: { action: ReactNode }) {
  const t = useTranslations('Owner.landing');
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8 px-4 py-12">
      <div className="grid gap-3">
        <h1 className="text-4xl font-semibold tracking-tight text-balance">{t('title')}</h1>
        <p className="text-lg text-muted-foreground">{t('lead')}</p>
      </div>
      {action}
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('needHeading')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {NEEDED.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  {t(`need.${item}`)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('stepsHeading')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid list-inside list-decimal gap-2 text-sm">
              {JOURNEY.map((item) => (
                <li key={item}>{t(`steps.${item}`)}</li>
              ))}
            </ol>
            <p className="mt-3 text-sm text-muted-foreground">{t('saveNote')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** The way in for someone signed out; back here afterwards. */
export function SignedOutActions() {
  const t = useTranslations('Owner.landing');
  return (
    <div className="flex flex-wrap gap-3">
      <Button asChild>
        <Link href="/sign-up">{t('createAccount')}</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={{ pathname: '/sign-in', query: { next: '/owner' } }}>{t('signIn')}</Link>
      </Button>
    </div>
  );
}
