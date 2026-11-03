import {
  ACCOUNT_STEPS,
  LISTING_STEPS,
  ListingLocationInputSchema,
  OwnerProfileInputSchema,
  type AccountStep,
  type ListingLocationInput,
  type ListingStatus,
  type ListingStep,
} from '@parkfairy/contracts';

/**
 * Progress is worked out from what is saved, never stored, so it can't drift: a step is done
 * when its data would pass, and clearing a field reopens the step.
 */

export interface ProfileFacts {
  kind: 'individual' | 'business' | null;
  firstName: string | null;
  lastName: string | null;
  legalName: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  hasTaxId: boolean;
  hasBirthDate: boolean;
  hasRegistrationNumber: boolean;
}

export function doneAccountSteps(profile: ProfileFacts | undefined): AccountStep[] {
  if (!profile) return [];
  const done: Record<AccountStep, boolean> = {
    profile: OwnerProfileInputSchema.safeParse(profile).success,
    tax:
      profile.kind !== null &&
      profile.hasTaxId &&
      (profile.kind === 'business' ? profile.hasRegistrationNumber : profile.hasBirthDate),
  };
  return ACCOUNT_STEPS.filter((step) => done[step]);
}

export interface ListingFacts {
  status: ListingStatus;
  location: Partial<ListingLocationInput>;
  hourlyRateMinor: number | null;
  cancellationPolicy: string | null;
  spaces: number;
  openingPeriods: number;
  photos: number;
  proofs: number;
}

export const isEditable = (status: ListingStatus) =>
  status === 'draft' || status === 'changes_requested';

export function doneListingSteps(facts: ListingFacts): ListingStep[] {
  const done: Record<ListingStep, boolean> = {
    location: ListingLocationInputSchema.safeParse(facts.location).success,
    spaces: facts.spaces > 0,
    hours: facts.openingPeriods > 0,
    prices: facts.hourlyRateMinor !== null && facts.cancellationPolicy !== null,
    photos: facts.photos > 0,
    proof: facts.proofs > 0,
    review: !isEditable(facts.status),
  };
  return LISTING_STEPS.filter((step) => done[step]);
}

/** Where Continue goes: the first step not done, or nowhere once staff have it. */
export function nextListingStep(
  status: ListingStatus,
  done: readonly ListingStep[],
): ListingStep | null {
  if (!isEditable(status)) return null;
  return LISTING_STEPS.find((step) => !done.includes(step)) ?? null;
}

/** Everything a submission needs, on the listing and on the account. */
export function missingForSubmit(
  listingDone: readonly ListingStep[],
  accountDone: readonly AccountStep[],
): (ListingStep | AccountStep)[] {
  return [
    ...ACCOUNT_STEPS.filter((step) => !accountDone.includes(step)),
    ...LISTING_STEPS.filter((step) => step !== 'review' && !listingDone.includes(step)),
  ];
}
