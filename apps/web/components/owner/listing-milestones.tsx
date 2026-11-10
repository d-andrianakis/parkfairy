import {
  LISTING_MILESTONES,
  photoUrl,
  PHOTO_WIDTHS,
  type OwnerListingProgress,
} from '@parkfairy/contracts';
import { Badge } from '@parkfairy/ui/components/badge';
import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@parkfairy/ui/components/card';
import { CalendarCheck, CalendarX, CircleAlert, ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PlaceWords } from '@/components/parking/place-words';
import { Link } from '@/i18n/navigation';
import { listingStepHref } from '@/lib/owner';
import { closuresHref, ownerBookingsHref } from '@/lib/owner-href';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { DeleteDraftButton } from './listing-actions';
import { StepLink } from './navigation';
import { STEP_LINK, StepRow } from './step-state';

/** What happens after the owner's part; nothing here can be pressed yet. */
function AfterSubmission({ listing }: { listing: OwnerListingProgress }) {
  const t = useTranslations('Owner.dashboard');
  const reviewed = listing.status === 'published';
  const reviewing = listing.status === 'in_review';
  return (
    <div>
      <h3 className="text-sm font-medium">{t('milestones.approval')}</h3>
      <ul className="mt-1 grid gap-1">
        <li className="flex items-center gap-2 py-1 text-sm">
          <StepRow done={reviewed}>
            {reviewing ? t('checks.reviewing') : t('checks.review')}
          </StepRow>
        </li>
        <li className="flex items-center gap-2 py-1 text-sm">
          <StepRow done={reviewed}>{t('checks.live')}</StepRow>
        </li>
        <li className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <StepRow done={false}>{t('checks.payouts')}</StepRow>
        </li>
      </ul>
    </div>
  );
}

/** One listing's journey: its milestones, each with the steps inside it. */
export function ListingMilestones({ listing }: { listing: OwnerListingProgress }) {
  const t = useTranslations('Owner');
  const name = listing.name ?? t('dashboard.untitled');
  const nameLang = listing.name ? listing.contentLocale : undefined;
  const cover = listing.coverPhoto;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start gap-4">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- stored sizes, no optimiser
            <img
              src={photoUrl(cover.key, PHOTO_WIDTHS[0])}
              alt=""
              width={96}
              height={64}
              loading="lazy"
              className="h-16 w-24 rounded-md object-cover"
              style={{ backgroundColor: cover.color }}
            />
          ) : (
            <div className="grid h-16 w-24 place-content-center rounded-md bg-muted">
              <ImageOff aria-hidden className="size-5 text-muted-foreground" />
            </div>
          )}
          <div className="grid min-w-0 flex-1 gap-1">
            <CardTitle className="text-lg leading-snug">
              <h2 lang={nameLang}>
                {nameLang ? <PlaceWords text={name} lang={nameLang} /> : name}
              </h2>
            </CardTitle>
            <CardDescription>
              <Badge variant={listing.status === 'changes_requested' ? 'destructive' : 'secondary'}>
                {t(`dashboard.status.${listing.status}`)}
              </Badge>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        {listing.reviewNote ? (
          <Alert role={undefined} variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle className="line-clamp-none">{t('review.noteHeading')}</AlertTitle>
            <AlertDescription className="whitespace-pre-line">
              {listing.reviewNote}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {LISTING_MILESTONES.map((milestone) => {
            const done = milestone.steps.filter((step) => listing.doneSteps.includes(step));
            return (
              <div key={milestone.id}>
                <h3 className="text-sm font-medium">
                  {t(`dashboard.milestones.${milestone.id}`)}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {t('dashboard.milestoneCount', {
                      done: done.length,
                      total: milestone.steps.length,
                    })}
                  </span>
                </h3>
                <ul className="mt-1 grid gap-1">
                  {milestone.steps.map((step) => (
                    <li key={step}>
                      <StepLink
                        href={listingStepHref(listing.id, step)}
                        className={`${STEP_LINK} py-1 text-sm underline-offset-4 hover:underline`}
                      >
                        <StepRow done={listing.doneSteps.includes(step)}>
                          {t(`stepNames.${step}`)}
                        </StepRow>
                      </StepLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <AfterSubmission listing={listing} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            {listing.status === 'published' && listing.slug ? (
              <Button asChild variant="outline" size="sm" className={WRAPPING_BUTTON}>
                <Link href={`/parking/${listing.slug}`}>{t('dashboard.viewLive', { name })}</Link>
              </Button>
            ) : null}
            {/* Once sent in: a listing staff sent back may have bookings from when it was live. */}
            {listing.status !== 'draft' ? (
              <Button asChild variant="outline" size="sm" className={WRAPPING_BUTTON}>
                <Link href={ownerBookingsHref(listing.id)}>
                  <CalendarCheck aria-hidden />
                  <span>
                    {t.rich('dashboard.bookings', {
                      name,
                      listing: (chunks) => <span lang={nameLang}>{chunks}</span>,
                    })}
                  </span>
                </Link>
              </Button>
            ) : null}
            {/* Whatever the status: closures need no review (decision #24). */}
            <Button asChild variant="outline" size="sm" className={WRAPPING_BUTTON}>
              <Link href={closuresHref(listing.id)}>
                <CalendarX aria-hidden />
                {/* One flex item: the button's gap would otherwise open around the name. */}
                <span>
                  {t.rich('dashboard.closures', {
                    name,
                    // The owner's name for it, read in the language they wrote it in.
                    listing: (chunks) => <span lang={nameLang}>{chunks}</span>,
                  })}
                </span>
              </Link>
            </Button>
          </div>
          {listing.status === 'draft' ? (
            <DeleteDraftButton id={listing.id} name={listing.name} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
