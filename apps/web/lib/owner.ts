import {
  ACCOUNT_STEPS,
  LISTING_STEPS,
  type AccountStep,
  type ListingStep,
  type OwnerListingProgress,
  type OwnerOnboarding,
} from '@parkfairy/contracts';
import { listingStepHref } from './owner-href';

export { listingStepHref };

/** Where each step lives. */
export const ACCOUNT_STEP_HREF: Record<AccountStep, string> = {
  profile: '/owner/profile',
  tax: '/owner/tax',
};

export function isListingStep(value: string): value is ListingStep {
  return (LISTING_STEPS as readonly string[]).includes(value);
}

export type NextAction =
  | { kind: 'account'; step: AccountStep; href: string }
  | { kind: 'listing'; step: ListingStep; href: string; listing: OwnerListingProgress }
  | { kind: 'newListing' }
  | { kind: 'done' };

/**
 * What Continue opens. A listing sent back comes first, because a person is waiting on it. Then
 * the account, whose steps every listing needs, then the draft touched last (the API sorts by
 * that). With nothing open, an owner with no listing is invited to add one.
 */
export function nextOwnerAction({ doneAccountSteps, listings }: OwnerOnboarding): NextAction {
  const open = (status: OwnerListingProgress['status']) =>
    listings.find((listing) => listing.status === status && listing.nextStep !== null);

  const asAction = (listing: OwnerListingProgress): NextAction | null =>
    listing.nextStep
      ? {
          kind: 'listing',
          step: listing.nextStep,
          href: listingStepHref(listing.id, listing.nextStep),
          listing,
        }
      : null;

  const sentBack = open('changes_requested');
  if (sentBack) return asAction(sentBack) ?? { kind: 'done' };
  const accountStep = ACCOUNT_STEPS.find((step) => !doneAccountSteps.includes(step));
  if (accountStep) {
    return { kind: 'account', step: accountStep, href: ACCOUNT_STEP_HREF[accountStep] };
  }
  const draft = open('draft');
  if (draft) return asAction(draft) ?? { kind: 'done' };
  return listings.length === 0 ? { kind: 'newListing' } : { kind: 'done' };
}

/** The account's confirmed address counts as done: every owner starts with one step behind them. */
const ACCOUNT_CONFIRMED = 1;

export interface SetupProgress {
  done: number;
  total: number;
  percent: number;
}

/** Overall progress for one listing: the account's steps and that listing's. */
export function setupProgress(
  doneAccountSteps: readonly AccountStep[],
  listing: OwnerListingProgress | undefined,
): SetupProgress {
  const total = ACCOUNT_CONFIRMED + ACCOUNT_STEPS.length + LISTING_STEPS.length;
  const done = ACCOUNT_CONFIRMED + doneAccountSteps.length + (listing?.doneSteps.length ?? 0);
  return { done, total, percent: Math.round((done / total) * 100) };
}
