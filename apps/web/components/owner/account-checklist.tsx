import { ACCOUNT_STEPS, type AccountStep } from '@parkfairy/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@parkfairy/ui/components/card';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ACCOUNT_STEP_HREF } from '@/lib/owner';
import { STEP_LINK, StepRow } from './step-state';

/** Once per owner, however many listings follow. */
export function AccountChecklist({ done }: { done: readonly AccountStep[] }) {
  const t = useTranslations('Owner');
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('dashboard.milestones.account')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1">
          <li className="flex items-center gap-2 py-1 text-sm">
            <StepRow done>{t('stepNames.account')}</StepRow>
          </li>
          {ACCOUNT_STEPS.map((step) => (
            <li key={step}>
              <Link
                href={ACCOUNT_STEP_HREF[step]}
                className={`${STEP_LINK} py-1 text-sm underline-offset-4 hover:underline`}
              >
                <StepRow done={done.includes(step)}>{t(`stepNames.${step}`)}</StepRow>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
