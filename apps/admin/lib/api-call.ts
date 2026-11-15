import { client } from '@parkfairy/api-client';

// Same-origin: Next.js proxies /api/v1/* to the API, so the session cookie travels with requests.
client.setConfig({ baseUrl: '/api' });

/** What a refusal carries besides its code; clients translate the code, never the message. */
export interface ApiFailure {
  code?: string;
  message?: string | string[];
  /** `OWNER_DETAILS_MISSING`: the owners whose details are incomplete. */
  owners?: string[];
}

export type Outcome<T> =
  { ok: true; data: T } | { ok: false; failure: ApiFailure; status?: number };

/** Runs an API call; a network failure becomes the same kind of answer as a refusal. */
export async function attempt<T>(
  call: () => Promise<{ data?: T; error?: unknown; response?: Response }>,
): Promise<Outcome<T>> {
  try {
    const { data, error, response } = await call();
    if (error || !response?.ok) {
      return { ok: false, failure: (error ?? {}) as ApiFailure, status: response?.status };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, failure: {} };
  }
}
