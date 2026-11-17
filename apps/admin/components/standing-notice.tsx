import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { useTranslations } from 'next-intl';

import type { Standing } from '@/lib/session';

/**
 * What a signed-in account that isn't staff, or has no second factor yet, sees instead of data.
 * Where to enrol is the public site's account page (`accountUrl`): it is there, reviewed, and this
 * origin serves no account changes.
 */
export function StandingNotice({
  standing,
  accountUrl,
}: {
  standing: Exclude<Standing, 'staff'>;
  accountUrl: string;
}) {
  const t = useTranslations('Admin.standing');
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{t(`${standing}.title`)}</h1>
      <Alert role="note">
        <AlertTitle className="line-clamp-none">{t(`${standing}.alertTitle`)}</AlertTitle>
        <AlertDescription>
          <p>{t(`${standing}.text`)}</p>
          {standing === 'no-second-factor' ? (
            <p>
              <a
                href={accountUrl}
                className="text-primary underline underline-offset-4 hover:decoration-2"
              >
                {t('enrolLink')}
              </a>
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
    </div>
  );
}
