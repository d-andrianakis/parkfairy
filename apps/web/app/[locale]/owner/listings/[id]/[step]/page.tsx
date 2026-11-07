import {
  ACCOUNT_STEPS,
  type ListingStep,
  type OwnerListing,
  type OwnerOnboarding,
} from '@parkfairy/contracts';
import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { CircleAlert, Clock } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/client-messages';
import { ClosuresLink } from '@/components/owner/closures-link';
import { HoursForm } from '@/components/owner/hours-form';
import { LocationForm } from '@/components/owner/location-form';
import { PhotosStep } from '@/components/owner/photos-step';
import { PricesForm } from '@/components/owner/prices-form';
import { ProofStep } from '@/components/owner/proof-step';
import { ReviewSummary } from '@/components/owner/review-summary';
import { SpacesForm } from '@/components/owner/spaces-form';
import { StepShell } from '@/components/owner/step-shell';
import { SubmitListing } from '@/components/owner/submit-listing';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';
import { isListingStep } from '@/lib/owner';
import { loadOwnerListing, loadOwnerOnboarding } from '@/lib/owner.server';
import { requireSession } from '@/lib/session';

interface StepPageProps {
  params: Promise<{ locale: string; id: string; step: string }>;
}

export async function generateMetadata({ params }: StepPageProps): Promise<Metadata> {
  const { locale, step } = await params;
  if (!isListingStep(step)) return {};
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: 'Owner',
  });
  return { title: t(`stepNames.${step}`) };
}

/** The owner's other listings that can still take new weekly hours (decision #30). */
function draftsBesides(listing: OwnerListing, onboarding: OwnerOnboarding | null) {
  return (onboarding?.listings ?? [])
    .filter(
      (other) =>
        other.id !== listing.id &&
        (other.status === 'draft' || other.status === 'changes_requested'),
    )
    .map(({ id, name, contentLocale }) => ({ id, name, contentLocale }));
}

function StepForm({
  listing,
  step,
  onboarding,
}: {
  listing: OwnerListing;
  step: Exclude<ListingStep, 'review'>;
  onboarding: OwnerOnboarding | null;
}) {
  switch (step) {
    case 'location':
      return (
        <LocationForm listing={listing} mapboxToken={process.env.MAPBOX_PUBLIC_TOKEN || null} />
      );
    case 'spaces':
      return <SpacesForm listing={listing} />;
    case 'hours':
      return (
        <HoursForm
          listing={listing}
          otherListings={draftsBesides(listing, onboarding)}
          after={
            <div className="border-t pt-6">
              <ClosuresLink id={listing.id} lead="hoursHint" />
            </div>
          }
        />
      );
    case 'prices':
      return <PricesForm listing={listing} />;
    case 'photos':
      return <PhotosStep listing={listing} />;
    case 'proof':
      return <ProofStep listing={listing} />;
  }
}

export default async function ListingStepPage({ params }: StepPageProps) {
  const { locale, id, step } = await params;
  if (!isListingStep(step)) notFound();
  await requireSession(`/owner/listings/${id}/${step}`);

  // Only the hours step needs the owner's other listings, to offer them its week.
  const [listing, onboarding] = await Promise.all([
    loadOwnerListing(id),
    step === 'hours' ? loadOwnerOnboarding() : Promise.resolve(null),
  ]);
  if (listing === 'not-found') notFound();
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: 'Owner',
  });

  if (listing === 'unavailable') {
    return (
      <div className="mx-auto grid max-w-xl gap-4 px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{t(`stepNames.${step}`)}</h1>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('errors.generic')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { doneAccountSteps } = listing;
  const canSubmit =
    listing.progress.nextStep === 'review' &&
    doneAccountSteps.length === ACCOUNT_STEPS.length &&
    !listing.locked;

  return (
    <StepShell listing={listing} step={step}>
      {listing.locked ? (
        <>
          <Alert role={undefined}>
            <Clock aria-hidden />
            <AlertTitle className="line-clamp-none">
              {t(`dashboard.status.${listing.status}`)}
            </AlertTitle>
            <AlertDescription>{t('review.locked')}</AlertDescription>
          </Alert>
          <ClosuresLink id={listing.id} lead="stillOpen" />
          <ReviewSummary listing={listing} doneAccountSteps={doneAccountSteps} />
        </>
      ) : step === 'review' ? (
        <ClientMessages namespaces={CLIENT_NAMESPACES.owner}>
          <ReviewSummary listing={listing} doneAccountSteps={doneAccountSteps} />
          {canSubmit ? (
            <SubmitListing id={listing.id} resubmitting={listing.status === 'changes_requested'} />
          ) : null}
        </ClientMessages>
      ) : (
        <ClientMessages namespaces={CLIENT_NAMESPACES.owner}>
          <StepForm listing={listing} step={step} onboarding={onboarding} />
        </ClientMessages>
      )}
    </StepShell>
  );
}
