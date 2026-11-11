import { LISTING_STEPS, type ListingStep, type OwnerListing } from '@parkfairy/contracts';
import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { Progress } from '@parkfairy/ui/components/progress';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PlaceWords } from '@/components/parking/place-words';
import { Link } from '@/i18n/navigation';
import { listingStepHref } from '@/lib/owner';
import { StepLink } from './navigation';
import { STEP_LINK, StepRow } from './step-state';

/**
 * One page for each step of a listing: where the owner is, every other step one press away, and
 * why a listing came back when it did. Steps stay open in any order: people fill in what they
 * have to hand, and Continue finds what's left.
 */
export function StepShell({
  listing,
  step,
  children,
}: {
  listing: OwnerListing;
  step: ListingStep;
  children: ReactNode;
}) {
  const t = useTranslations('Owner');
  const locale = useLocale();
  const { doneSteps, reviewNote } = listing.progress;
  const position = LISTING_STEPS.indexOf(step) + 1;
  const total = LISTING_STEPS.length;
  const progressLabel = t('step.progress', { done: doneSteps.length, total });

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="grid content-start gap-4">
        <Link
          href="/owner"
          className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('step.back')}
        </Link>
        <div className="grid gap-1">
          <p aria-hidden className="text-sm text-muted-foreground">
            {progressLabel}
          </p>
          <Progress value={(doneSteps.length / total) * 100} aria-label={progressLabel} max={100} />
        </div>
        <nav aria-label={t('step.navLabel')}>
          <ol className="grid gap-1">
            {LISTING_STEPS.map((item) => (
              <li key={item}>
                <StepLink
                  href={listingStepHref(listing.id, item)}
                  aria-current={item === step ? 'step' : undefined}
                  className={`${STEP_LINK} px-2 py-1.5 text-sm hover:bg-muted aria-[current=step]:bg-muted aria-[current=step]:font-medium forced-colors:aria-[current=step]:underline`}
                >
                  <StepRow done={doneSteps.includes(item)}>{t(`stepNames.${item}`)}</StepRow>
                </StepLink>
              </li>
            ))}
          </ol>
        </nav>
      </aside>
      <div className="grid content-start gap-6">
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">{t('step.position', { position, total })}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{t(`stepNames.${step}`)}</h1>
          <p className="text-muted-foreground">{t(`stepLeads.${step}`)}</p>
        </div>
        {reviewNote ? (
          <Alert role={undefined} variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle className="line-clamp-none">{t('review.noteHeading')}</AlertTitle>
            <AlertDescription className="whitespace-pre-line">
              {/* Staff's words, in a language nobody told us: Greek script is marked on /en. One
                  element, as the description is a grid and loose runs would each take a row. */}
              <p>
                <PlaceWords text={reviewNote} lang={locale} />
              </p>
            </AlertDescription>
          </Alert>
        ) : null}
        {children}
      </div>
    </div>
  );
}
