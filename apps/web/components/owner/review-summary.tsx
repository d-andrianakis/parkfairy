import {
  ACCOUNT_STEPS,
  LISTING_STEPS,
  type AccountStep,
  type ListingStep,
  type OwnerListing,
} from '@parkfairy/contracts';
import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { CircleAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { OpeningHours, useWallTime } from '@/components/parking/opening-hours';
import { ACCOUNT_STEP_HREF, listingStepHref } from '@/lib/owner';
import { StepLink } from './navigation';

function Section({
  title,
  href,
  editLabel,
  children,
}: {
  title: string;
  href: string | null;
  editLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{title}</h2>
        {href ? (
          <StepLink
            href={href}
            className="text-sm text-primary underline underline-offset-4 hover:decoration-2"
          >
            {editLabel}
          </StepLink>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Everything staff will see, with a way back to each part. */
export function ReviewSummary({
  listing,
  doneAccountSteps,
}: {
  listing: OwnerListing;
  doneAccountSteps: readonly AccountStep[];
}) {
  const t = useTranslations('Owner');
  const tAreas = useTranslations('Areas');
  const format = useFormatter();
  const money = (minor: number) =>
    format.number(minor / 100, { style: 'currency', currency: 'EUR' });
  const time = useWallTime();
  const { location, prices, progress, locked } = listing;
  const edit = (step: ListingStep) => (locked ? null : listingStepHref(listing.id, step));
  const editLabel = (step: ListingStep) => t('review.edit', { step: t(`stepNames.${step}`) });

  const missing: { step: ListingStep | AccountStep; href: string }[] = [
    ...ACCOUNT_STEPS.filter((step) => !doneAccountSteps.includes(step)).map((step) => ({
      step,
      href: ACCOUNT_STEP_HREF[step],
    })),
    ...LISTING_STEPS.filter((step) => step !== 'review' && !progress.doneSteps.includes(step)).map(
      (step) => ({ step, href: listingStepHref(listing.id, step) }),
    ),
  ];

  return (
    <div className="grid gap-4">
      {!locked && missing.length > 0 ? (
        <Alert role={undefined} variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle className="line-clamp-none">{t('review.missingHeading')}</AlertTitle>
          <AlertDescription>
            <ul className="grid gap-1">
              {missing.map(({ step, href }) => (
                <li key={step}>
                  <StepLink href={href} className="underline underline-offset-4">
                    {t(`stepNames.${step}`)}
                  </StepLink>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Section
        title={t('stepNames.location')}
        href={edit('location')}
        editLabel={editLabel('location')}
      >
        <p lang={location.name ? location.contentLocale : undefined} className="font-medium">
          {location.name ?? t('review.notSet')}
        </p>
        <p
          lang={location.address ? location.contentLocale : undefined}
          className="text-sm text-muted-foreground"
        >
          {location.address ?? t('review.notSet')}
        </p>
        {location.areaId ? (
          <p className="text-sm text-muted-foreground">{tAreas(location.areaId)}</p>
        ) : null}
      </Section>

      <Section title={t('stepNames.spaces')} href={edit('spaces')} editLabel={editLabel('spaces')}>
        <p className="text-sm">{t('review.spaces', { count: listing.spaces.length })}</p>
      </Section>

      <Section title={t('stepNames.hours')} href={edit('hours')} editLabel={editLabel('hours')}>
        {listing.openingHours.length > 0 ? (
          <OpeningHours periods={listing.openingHours} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('review.notSet')}</p>
        )}
      </Section>

      <Section title={t('stepNames.prices')} href={edit('prices')} editLabel={editLabel('prices')}>
        {prices.hourlyRateMinor === null ? (
          <p className="text-sm text-muted-foreground">{t('review.notSet')}</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            <li>{t('review.hourly', { price: money(prices.hourlyRateMinor) })}</li>
            {prices.dailyMaxMinor !== null ? (
              <li>{t('review.dailyMax', { price: money(prices.dailyMaxMinor) })}</li>
            ) : null}
            {prices.weekendRateMinor !== null ? (
              <li>{t('review.weekend', { price: money(prices.weekendRateMinor) })}</li>
            ) : null}
            {prices.night ? (
              <li>
                {t('review.night', {
                  price: money(prices.night.rateMinor),
                  from: time(prices.night.from),
                  to: time(prices.night.to),
                })}
              </li>
            ) : null}
            {prices.datedPrices.length > 0 ? (
              <li>{t('review.dated', { count: prices.datedPrices.length })}</li>
            ) : null}
            {prices.longStayDiscounts.map(({ minDays, percent }) => (
              <li key={minDays}>{t('review.longStay', { days: minDays, percent })}</li>
            ))}
            {prices.cancellationPolicy ? (
              <li>
                {t('review.policy', {
                  policy: t(`prices.policies.${prices.cancellationPolicy}.label`),
                })}
              </li>
            ) : null}
          </ul>
        )}
      </Section>

      <Section title={t('stepNames.photos')} href={edit('photos')} editLabel={editLabel('photos')}>
        <p className="text-sm">{t('review.photos', { count: listing.photos.length })}</p>
      </Section>

      <Section title={t('stepNames.proof')} href={edit('proof')} editLabel={editLabel('proof')}>
        <p className="text-sm">{t('review.proofs', { count: listing.proofs.length })}</p>
      </Section>
    </div>
  );
}
