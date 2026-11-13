import type { ListingStep } from '@parkfairy/contracts';

/** On its own because `./owner` loads the contracts, and the dashboard's buttons need no zod. */
export const listingStepHref = (id: string, step: ListingStep) => `/owner/listings/${id}/${step}`;

/** Closures and special hours: a page of its own, not a step. */
export const closuresHref = (id: string) => `/owner/listings/${id}/closures`;

/** A listing's bookings (decision #34), where the owner calls one off. */
export const ownerBookingsHref = (id: string) => `/owner/listings/${id}/bookings`;

/** A listing's owners and their shares (#53–#56), and invites to join them. */
export const ownersHref = (id: string) => `/owner/listings/${id}/owners`;

/** Where an invite's email leads; its token comes after `#`, so no server sees it. */
export const INVITE_PATH = '/owner/invite';
