'use client';

import {
  approveAdminListing,
  requestAdminListingChanges,
  type AdminListingReview,
} from '@parkfairy/api-client';
import { useTranslations } from 'next-intl';
import { attempt, type ApiFailure, type Outcome } from './api-call';

export const approve = (id: string): Promise<Outcome<AdminListingReview>> =>
  attempt(() => approveAdminListing({ path: { id } }));

export const requestChanges = (id: string, note: string): Promise<Outcome<AdminListingReview>> =>
  attempt(() => requestAdminListingChanges({ path: { id }, body: { note } }));

/** The codes the admin routes answer with that the screens explain; anything else is `UNKNOWN`. */
const KNOWN_CODES = [
  'LISTING_NOT_FOUND',
  'NOT_IN_REVIEW',
  'OWN_LISTING',
  'OWNER_DETAILS_MISSING',
  'MFA_REQUIRED',
  'INVALID_ORIGIN',
] as const;

type KnownCode = (typeof KNOWN_CODES)[number];

export function adminErrorKey(
  failure: ApiFailure,
  status?: number,
): KnownCode | 'SESSION_ENDED' | 'TOO_MANY_REQUESTS' | 'UNKNOWN' {
  if (failure.code && (KNOWN_CODES as readonly string[]).includes(failure.code)) {
    return failure.code as KnownCode;
  }
  // No code, no session: it ended (a week, or signed out elsewhere), and trying again won't help.
  if (status === 401) return 'SESSION_ENDED';
  return status === 429 ? 'TOO_MANY_REQUESTS' : 'UNKNOWN';
}

/** Translates a refusal for display, naming the owners where the code does. */
export function useAdminError() {
  const t = useTranslations('AdminErrors');
  return (failure: ApiFailure, status?: number): string => {
    const key = adminErrorKey(failure, status);
    return t(key, { owners: (failure.owners ?? []).join(', ') });
  };
}
