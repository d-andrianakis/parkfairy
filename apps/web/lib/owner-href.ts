import type { ListingStep } from '@parkfairy/contracts';

/** On its own because `./owner` loads the contracts, and the dashboard's buttons need no zod. */
export const listingStepHref = (id: string, step: ListingStep) => `/owner/listings/${id}/${step}`;
