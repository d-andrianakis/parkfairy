import { Button } from '@parkfairy/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@parkfairy/ui/components/card';
import { Progress } from '@parkfairy/ui/components/progress';
import { useTranslations } from 'next-intl';
import type { NextAction, SetupProgress } from '@/lib/owner';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { NewListingButton } from './listing-actions';
import { StepLink } from './navigation';

/** The first thing on the dashboard: how far along, and the one thing to do next. */
export function ContinueCard({
  action,
  progress,
}: {
  action: NextAction;
  progress: SetupProgress;
}) {
  const t = useTranslations('Owner');
  const label = t('dashboard.progress', { done: progress.done, total: progress.total });

  const heading = {
    account: t('dashboard.next.heading'),
    listing: t('dashboard.next.heading'),
    newListing: t('dashboard.next.firstListing'),
    done: t('dashboard.next.allDone'),
  }[action.kind];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{heading}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1">
          <p aria-hidden className="text-sm text-muted-foreground">
            {label}
          </p>
          <Progress value={progress.percent} aria-label={label} />
        </div>
        {action.kind === 'account' || action.kind === 'listing' ? (
          <div>
            <Button asChild className={WRAPPING_BUTTON}>
              <StepLink href={action.href}>
                {t('dashboard.next.continue', { step: t(`stepNames.${action.step}`) })}
              </StepLink>
            </Button>
          </div>
        ) : null}
        {action.kind === 'newListing' ? (
          <NewListingButton label={t('dashboard.addListing')} />
        ) : null}
        {action.kind === 'done' ? (
          <p className="text-sm text-muted-foreground">{t('dashboard.next.waiting')}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
