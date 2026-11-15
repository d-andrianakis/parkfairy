import { isValidationMessage } from '@parkfairy/contracts/validation';
import { useTranslations } from 'next-intl';
import type { ApiFailure, Outcome } from './api-call';
import { useValidationMessage } from './use-validation-message';

export { attempt, type Outcome } from './api-call';
export type OwnerFailure = ApiFailure;

const KNOWN_CODES = [
  'ALREADY_INVITED',
  'ALREADY_OWNER',
  'BOOKING_NOT_FOUND',
  'BOOKING_STARTED',
  'FILE_TOO_LARGE',
  'FILE_TYPE_NOT_ALLOWED',
  'INVITE_EXPIRED',
  'INVITE_FOR_ANOTHER_ACCOUNT',
  'INVITE_NOT_FOUND',
  'LISTING_INCOMPLETE',
  'LISTING_LOCKED',
  'LISTING_NOT_FOUND',
  'NOTHING_TO_COPY',
  'OWNER_DETAILS_MISSING',
  'OWNER_NOT_FOUND',
  'PAYMENTS_UNAVAILABLE',
  'PAYMENT_PROVIDER_ERROR',
  'PAYOUTS_NOT_STARTED',
  'PHOTOS_CHANGED',
  'PHOTO_DUPLICATE',
  'PHOTO_TOO_SMALL',
  'PHOTO_UNREADABLE',
  'PRIMARY_CANNOT_LEAVE',
  'PRIMARY_ONLY',
  'PROFILE_HAS_SHARE',
  'PROFILE_INCOMPLETE',
  'PROFILE_REQUIRED',
  'SHARES_MISMATCH',
  'TOO_MANY_INVITES',
  'TOO_MANY_LISTINGS',
  'TOO_MANY_OWNERS',
  'TOO_MANY_PHOTOS',
  'TOO_MANY_PROOFS',
  'UPLOADS_BUSY',
] as const;
type KnownCode = (typeof KNOWN_CODES)[number];

const isKnownCode = (code: string | undefined): code is KnownCode =>
  (KNOWN_CODES as readonly (string | undefined)[]).includes(code);

/** Translates a refusal; server text is never shown. */
export function useOwnerError() {
  const t = useTranslations('Owner.errors');
  const validation = useValidationMessage();
  return (failure: OwnerFailure): string => {
    const first = Array.isArray(failure.message) ? failure.message[0] : failure.message;
    if (failure.code === 'VALIDATION_FAILED' && isValidationMessage(first)) {
      return validation(first) ?? t('generic');
    }
    if (failure.code === 'LISTING_BOOKED' || failure.code === 'SPACES_BOOKED') {
      return t(failure.code, { count: failure.bookings ?? 1 });
    }
    if (failure.code === 'TOO_MANY_INVITES') {
      return t(failure.code, { limit: failure.limit === 'day' ? 'day' : 'address' });
    }
    return isKnownCode(failure.code) ? t(failure.code) : t('generic');
  };
}

/**
 * Uploads one file. XMLHttpRequest, not fetch, because only it reports how far an upload has got,
 * and a photo from a phone can take a while. The body is the file itself; the API reads it after
 * its guards, and the browser adds the Origin header they check.
 */
export function uploadFile<T>(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
  headers: Record<string, string> = {},
): Promise<Outcome<T>> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.responseType = 'json';
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = ({ lengthComputable, loaded, total }) => {
      if (lengthComputable) onProgress(Math.round((loaded / total) * 100));
    };
    request.onload = () => {
      const body = request.response as unknown;
      resolve(
        request.status >= 200 && request.status < 300
          ? { ok: true, data: body as T }
          : { ok: false, failure: (body ?? {}) as OwnerFailure },
      );
    };
    request.onerror = () => resolve({ ok: false, failure: {} });
    request.send(file);
  });
}
