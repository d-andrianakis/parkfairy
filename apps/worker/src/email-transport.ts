import { resolve } from 'node:path';
import { outboxTransport, resendTransport, type EmailTransport } from '@parkfairy/email';
import type { Env } from './env.js';

type EmailEnv = Pick<
  Env,
  'RESEND_API_KEY' | 'EMAIL_FROM' | 'EMAIL_OUTBOX_DIR' | 'EMAIL_SENDS_PER_SECOND'
>;

/** Without a key emails become files, which loadEnv allows on this machine only. */
export function chooseEmailTransport(env: EmailEnv): EmailTransport {
  return env.RESEND_API_KEY && env.EMAIL_FROM
    ? resendTransport({
        apiKey: env.RESEND_API_KEY,
        from: env.EMAIL_FROM,
        intervalMs: Math.ceil(1000 / env.EMAIL_SENDS_PER_SECOND),
      })
    : outboxTransport(env.EMAIL_OUTBOX_DIR ?? resolve(process.cwd(), '../../.emails'));
}
