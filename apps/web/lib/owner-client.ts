import { client } from '@parkfairy/api-client';
import { isValidationMessage } from '@parkfairy/contracts/validation';
import { useTranslations } from 'next-intl';
import { useValidationMessage } from './use-validation-message';

// Same-origin: Next.js proxies /api/v1/* to the API, so the session cookie travels with requests.
client.setConfig({ baseUrl: '/api' });

export interface OwnerFailure {
  code?: string;
  message?: string | string[];
  /** Steps a submission still needs. */
  missing?: string[];
}

export type Outcome<T> = { ok: true; data: T } | { ok: false; failure: OwnerFailure };

/** Runs an API call; a network failure becomes the same kind of answer as a refusal. */
export async function attempt<T>(
  call: () => Promise<{ data?: T; error?: unknown; response?: Response }>,
): Promise<Outcome<T>> {
  try {
    const { data, error, response } = await call();
    if (error || !response?.ok) return { ok: false, failure: (error ?? {}) as OwnerFailure };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, failure: {} };
  }
}

const KNOWN_CODES = [
  'FILE_TOO_LARGE',
  'FILE_TYPE_NOT_ALLOWED',
  'LISTING_INCOMPLETE',
  'LISTING_LOCKED',
  'LISTING_NOT_FOUND',
  'PHOTOS_CHANGED',
  'PHOTO_DUPLICATE',
  'PHOTO_TOO_SMALL',
  'PHOTO_UNREADABLE',
  'PROFILE_INCOMPLETE',
  'TOO_MANY_LISTINGS',
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
