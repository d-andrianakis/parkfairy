import { client } from '@parkfairy/api-client';

// Same-origin: Next.js proxies /api/v1/* to the API, so the session cookie travels with requests.
client.setConfig({ baseUrl: '/api' });

/** What a refusal carries besides its code; clients translate the code, never the message. */
export interface ApiFailure {
  code?: string;
  message?: string | string[];
  /** Steps a submission still needs. */
  missing?: string[];
  /** How many bookings closing that time, or removing those spaces, would strand. */
  bookings?: number;
  /** `REFUND_CHANGED`: what cancelling gives back now. */
  refund?: { amountMinor: number; currency: string };
}

export type Outcome<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

/**
 * Runs an API call; a network failure becomes the same kind of answer as a refusal. On its own, so
 * the listing page's space picker can use it without the owner area's error texts.
 */
export async function attempt<T>(
  call: () => Promise<{ data?: T; error?: unknown; response?: Response }>,
): Promise<Outcome<T>> {
  try {
    const { data, error, response } = await call();
    if (error || !response?.ok) return { ok: false, failure: (error ?? {}) as ApiFailure };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, failure: {} };
  }
}
