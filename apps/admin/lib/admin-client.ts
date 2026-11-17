'use client';

import {
  type AdminBooking,
  type AdminBookingLookupResult,
  type AdminListingReview,
  type AdminOverstay,
  type AdminUser,
  type AdminUserLookupResult,
  approveAdminListing,
  cancelAdminBooking,
  decideAdminDispute,
  lookUpAdminBooking,
  lookUpAdminUser,
  reinstateAdminListing,
  reinstateAdminUser,
  removeAdminUserTwoFactor,
  requestAdminListingChanges,
  resolveAdminOverstay,
  retryAdminBookingRefund,
  settleAdminBookingRefund,
  suspendAdminListing,
  suspendAdminUser,
} from '@parkfairy/api-client';
import { useTranslations } from 'next-intl';

import { type ApiFailure, attempt, type Outcome } from './api-call';

export const approve = (id: string): Promise<Outcome<AdminListingReview>> =>
  attempt(() => approveAdminListing({ path: { id } }));

export const requestChanges = (id: string, note: string): Promise<Outcome<AdminListingReview>> =>
  attempt(() => requestAdminListingChanges({ path: { id }, body: { note } }));

export const suspendListing = (
  id: string,
  note: string,
  cancelBookings: boolean,
): Promise<Outcome<AdminListingReview>> =>
  attempt(() => suspendAdminListing({ path: { id }, body: { note, cancelBookings } }));

export const reinstateListing = (id: string, note: string): Promise<Outcome<AdminListingReview>> =>
  attempt(() => reinstateAdminListing({ path: { id }, body: { note } }));

export const suspendUser = (id: string, note: string): Promise<Outcome<AdminUser>> =>
  attempt(() => suspendAdminUser({ path: { id }, body: { note } }));

export const reinstateUser = (id: string, note: string): Promise<Outcome<AdminUser>> =>
  attempt(() => reinstateAdminUser({ path: { id }, body: { note } }));

export const lookUpBooking = (reference: string): Promise<Outcome<AdminBookingLookupResult>> =>
  attempt(() => lookUpAdminBooking({ body: { reference } }));

export const cancelBooking = (id: string, note: string): Promise<Outcome<AdminBooking>> =>
  attempt(() => cancelAdminBooking({ path: { id }, body: { note } }));

export const retryRefund = (id: string, note: string): Promise<Outcome<AdminBooking>> =>
  attempt(() => retryAdminBookingRefund({ path: { id }, body: { note } }));

export const settleRefund = (id: string, note: string): Promise<Outcome<AdminBooking>> =>
  attempt(() => settleAdminBookingRefund({ path: { id }, body: { note } }));

export const decideDispute = (
  id: string,
  decision: 'parkfairy_bears' | 'owners_bear',
  note: string,
): Promise<Outcome<AdminBooking>> =>
  attempt(() => decideAdminDispute({ path: { id }, body: { decision, note } }));

export const resolveOverstay = (id: string, note: string): Promise<Outcome<AdminOverstay>> =>
  attempt(() => resolveAdminOverstay({ path: { id }, body: { note } }));

export const lookUpUser = (email: string): Promise<Outcome<AdminUserLookupResult>> =>
  attempt(() => lookUpAdminUser({ body: { email } }));

export const removeTwoFactor = (id: string, note: string): Promise<Outcome<AdminUser>> =>
  attempt(() => removeAdminUserTwoFactor({ path: { id }, body: { note } }));

/** The codes the admin routes answer with that the screens explain; anything else is `UNKNOWN`. */
const KNOWN_CODES = [
  'LISTING_NOT_FOUND',
  'NOT_IN_REVIEW',
  'OWN_LISTING',
  'OWNER_DETAILS_MISSING',
  'USER_NOT_FOUND',
  'OWN_ACCOUNT',
  'STAFF_ACCOUNT',
  'NO_TWO_FACTOR',
  'NOT_PUBLISHED',
  'NOT_SUSPENDED',
  'ALREADY_SUSPENDED',
  'BOOKING_NOT_FOUND',
  'NOT_CANCELLABLE',
  'REFUND_NOT_FAILED',
  'TRANSFER_MADE',
  'DISPUTE_NOT_FOUND',
  'NOT_LOST',
  'ALREADY_DECIDED',
  'OVERSTAY_NOT_FOUND',
  'ALREADY_RESOLVED',
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
