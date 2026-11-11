import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Stable across retries of one email; without it each send gets its own. */
  idempotencyKey?: string;
}

export interface SendOptions {
  /**
   * Stops the send where it is (the request, a wait between tries) and rejects with `SendStopped`.
   * Whether Resend got the email is then unknown; sending it again under the same idempotency key
   * is safe.
   */
  signal?: AbortSignal | undefined;
}

/**
 * A send its caller stopped. `failure` is what Resend answered before that, if it answered: a
 * send stopped while waiting out a refusal (a 429 with a long `Retry-After`) failed, and its
 * caller should count it so, or a quota that never lifts would be tried for ever.
 */
export class SendStopped extends Error {
  constructor(readonly failure: string | undefined) {
    super(failure ? `Stopped after: ${failure}` : 'Stopped before any answer');
    this.name = 'SendStopped';
  }
}

export interface EmailTransport {
  /** Resolves once the email is accepted; rejects with a reason that holds no address or link. */
  send(email: OutgoingEmail, options?: SendOptions): Promise<void>;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [500, 2_000];
/**
 * Resend's default limit is 2 requests a second for the whole account, whoever sends; check
 * `ratelimit-limit` on a real send. Two senders share it, the web app (account emails) and the
 * worker (everything else), so each takes one a second unless told otherwise (`intervalMs`, the
 * worker's `EMAIL_SENDS_PER_SECOND`). Raise both with Resend's limit.
 */
const SEND_INTERVAL_MS = 1_000;
/** Longest `Retry-After` honoured: a quota hours away would only hold the process open. */
const MAX_RETRY_AFTER_MS = 30_000;

/** Worth another try: rate limits, Resend's own failures and "same key still in progress". */
const isRetryable = (status: number) => status === 409 || status === 429 || status >= 500;

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : 0;
}

/**
 * Resend's error name, for telling an unverified domain from a bad key in the logs. Only that:
 * its `message` can echo the address.
 */
async function errorName(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { name?: unknown } | null;
  return typeof body?.name === 'string' && /^[a-z_]+$/.test(body.name) ? ` ${body.name}` : '';
}

/**
 * Resend's REST API (a single call, so no SDK). Sends run after the response, so a few retries
 * cost nobody any waiting; the idempotency key stops a retry after a lost answer from
 * delivering the email twice. Calls are spaced out, because a burst over Resend's limit would
 * lose emails, and the password-changed notice has nobody to ask for it again.
 */
export function resendTransport({
  apiKey,
  from,
  fetchFn = fetch,
  wait = (ms, signal) => sleep(ms, undefined, { signal }),
  timeoutMs = REQUEST_TIMEOUT_MS,
  intervalMs = SEND_INTERVAL_MS,
}: {
  apiKey: string;
  from: string;
  fetchFn?: typeof fetch;
  /** Rejects once `signal` is aborted. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
  timeoutMs?: number;
  /** The least time between two calls of this sender. */
  intervalMs?: number;
}): EmailTransport {
  let nextSlot = 0;
  /** Waits for this call's turn; each call books the next free slot. */
  async function turn(signal?: AbortSignal) {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + intervalMs;
    if (slot > now) await wait(slot - now, signal);
  }

  return {
    async send({ to, subject, text, html, idempotencyKey = randomUUID() }, { signal } = {}) {
      let failure = '';
      let retryAfter = 0;
      // However it was stopped (in a wait, at the call, during it), the caller learns the same.
      const stopped = () => new SendStopped(failure || undefined);
      for (const delay of [0, ...RETRY_DELAYS_MS]) {
        try {
          if (delay) await wait(Math.max(delay, retryAfter), signal);
          await turn(signal);
        } catch (error) {
          if (signal?.aborted) throw stopped();
          throw error;
        }
        // An abort between the turn and the call (the wait passed undisturbed) still stops it.
        if (signal?.aborted) throw stopped();
        try {
          const response = await fetchFn(RESEND_ENDPOINT, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${apiKey}`,
              'content-type': 'application/json',
              'idempotency-key': idempotencyKey,
            },
            body: JSON.stringify({ from, to: [to], subject, text, html }),
            signal: signal
              ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
              : AbortSignal.timeout(timeoutMs),
          });
          if (response.ok) {
            await response.body?.cancel(); // an unread body would hold the connection
            return;
          }
          failure = `Resend answered ${response.status}${await errorName(response)}`;
          if (!isRetryable(response.status)) break;
          retryAfter = retryAfterMs(response);
        } catch (error) {
          // Stopped by whoever sent it: no more tries.
          if (signal?.aborted) throw stopped();
          failure = error instanceof Error ? error.name : 'Network error';
        }
      }
      throw new Error(failure);
    },
  };
}

/**
 * Writes each email to a file instead of sending it, for local work and the smoke suite
 * (`parseServerEnv` allows this only on a loopback origin). The rename makes a file appear
 * complete, so a reader never sees half of one.
 */
export function outboxTransport(directory: string): EmailTransport {
  return {
    async send(email, { signal } = {}) {
      if (signal?.aborted) throw new SendStopped(undefined);
      await mkdir(directory, { recursive: true });
      const name = `${Date.now()}-${randomUUID()}.json`;
      const partial = join(directory, `${name}.partial`);
      await writeFile(partial, JSON.stringify(email, null, 2));
      await rename(partial, join(directory, name));
    },
  };
}
