import type { ListingStep } from '@parkfairy/contracts';

/** On its own because `./owner` loads the contracts, and the dashboard's buttons need no zod. */
export const listingStepHref = (id: string, step: ListingStep) => `/owner/listings/${id}/${step}`;

/** Closures and special hours: a page of its own, not a step. */
export const closuresHref = (id: string) => `/owner/listings/${id}/closures`;

/** A listing's bookings (decision #34), where the owner calls one off. */
export const ownerBookingsHref = (id: string) => `/owner/listings/${id}/bookings`;
