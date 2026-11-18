import { useTranslations } from 'next-intl';

import { type ApiFailure, attempt } from './api-call';

export { attempt };
export type BookingFailure = ApiFailure;

/**
 * What the booking routes answer with (`BOOKING_ERROR_CODES` in the contracts, which this mirrors
 * so the listing page's form loads no zod; a test holds the two together).
 */
export const BOOKING_CODES = [
  'BOOKING_UNAVAILABLE',
  'LISTING_NOT_FOUND',
  'SPACE_NOT_FOUND',
  'SPACE_TAKEN',
  'LISTING_CLOSED',
  'OWN_LISTING',
  'BOOKING_NOT_FOUND',
  'BOOKING_NOT_ACTIVE',
  'BOOKING_STARTED',
  'REFUND_CHANGED',
  'HOLD_LIMIT_REACHED',
  'VEHICLE_NOT_FOUND',
  'VEHICLE_DOES_NOT_FIT',
  'PAYMENT_PROVIDER_ERROR',
] as const;
type BookingCode = (typeof BOOKING_CODES)[number];

const isBookingCode = (code: string | undefined): code is BookingCode =>
  (BOOKING_CODES as readonly (string | undefined)[]).includes(code);

/** Codes after which the driver should go back and pick a space, or times, again. */
export const CHOOSE_AGAIN = new Set<string>([
  'SPACE_TAKEN',
  'SPACE_NOT_FOUND',
  'LISTING_CLOSED',
  'BOOKING_NOT_ACTIVE',
  // The space is too small for the vehicle: another space, or another vehicle, is the way on.
  'VEHICLE_DOES_NOT_FIT',
]);

/** Translates a refusal; server text is never shown. */
export function useBookingError() {
  const t = useTranslations('BookingErrors');
  return (failure: BookingFailure): string =>
    isBookingCode(failure.code) ? t(failure.code) : t('generic');
}
