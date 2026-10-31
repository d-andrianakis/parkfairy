import 'server-only';
import type { AuthEmail, RateLimitStorage } from '@parkfairy/auth';
import { renderAuthEmail } from './render';
import type { EmailTransport } from './transport';

const HOUR_SECONDS = 60 * 60;

/**
 * Per recipient and kind. Better Auth's own limits are per client address, so without these
 * anyone with a few IPs could fill a stranger's inbox: every sign-up attempt with a taken
 * address sends the owner a notice, hence its tighter cap.
 */
export const RECIPIENT_LIMITS: Record<AuthEmail['kind'], { window: number; max: number }> = {
  'verify-email': { window: HOUR_SECONDS, max: 5 },
  'reset-password': { window: HOUR_SECONDS, max: 6 },
  'password-changed': { window: HOUR_SECONDS, max: 5 },
  'existing-account': { window: HOUR_SECONDS, max: 1 },
};

/**
 * One visitor's share of an address's reset emails. Better Auth lets a visitor ask three times
 * a minute, so without this one person could spend the whole allowance in two minutes and the
 * address's owner would then ask for a link and get nothing.
 */
export const VISITOR_SHARE = { window: HOUR_SECONDS, max: 3 };

/**
 * Per kind and clock hour, across everyone: what a flood to many addresses may spend of the
 * Resend quota and the sender's reputation. Kinds count apart, so sign-up traffic cannot stop
 * password resets. The hour is in the key because the store's window is rolling: it only ends
 * after an hour without a hit, so one key would fill up under steady traffic and stay shut.
 * Far above launch traffic; raise them with the Resend plan.
 */
export const SITE_LIMITS: Record<AuthEmail['kind'], { window: number; max: number }> = {
  'verify-email': { window: HOUR_SECONDS, max: 600 },
  'reset-password': { window: HOUR_SECONDS, max: 600 },
  'password-changed': { window: HOUR_SECONDS, max: 600 },
  'existing-account': { window: HOUR_SECONDS, max: 200 },
};

/**
 * One inbox, however the address is written: `+tags` reach the same mailbox nearly everywhere,
 * and Gmail also ignores dots and has two domains. Only for counting: mail goes to the address
 * as typed.
 */
export function recipientKey(address: string): string {
  const lower = address.toLowerCase();
  const at = lower.lastIndexOf('@');
  const local = lower.slice(0, at).split('+')[0] ?? '';
  const domain = lower.slice(at + 1);
  return domain === 'gmail.com' || domain === 'googlemail.com'
    ? `${local.replaceAll('.', '')}@gmail.com`
    : `${local}@${domain}`;
}

export interface EmailDeliveryOptions {
  transport: EmailTransport;
  limits: RateLimitStorage;
  /** Runs work after the response is sent (`after` from next/server). */
  schedule: (work: () => Promise<void>) => void;
  /** Gets the kind and a reason, never the address or link: those would put live tokens in logs. */
  onFailure?: (kind: AuthEmail['kind'], reason: string) => void;
}

/**
 * Better Auth's `sendEmail`: returns immediately, so timing never says whether an email went
 * out. Nobody is waiting by then, so a failure is only logged; the person can ask again.
 */
export function createEmailDelivery({
  transport,
  limits,
  schedule,
  onFailure = (kind, reason) => console.error('Email not delivered', { kind, reason }),
}: EmailDeliveryOptions) {
  return (email: AuthEmail): void => {
    schedule(async () => {
      try {
        const recipient = `email:${email.kind}:${recipientKey(email.to)}`;
        // First, so what it drops doesn't spend the recipient's allowance.
        if (
          email.visitor &&
          !(await limits.consume(`${recipient}:from:${email.visitor}`, VISITOR_SHARE)).allowed
        ) {
          onFailure(email.kind, 'visitor share reached');
          return;
        }
        if (!(await limits.consume(recipient, RECIPIENT_LIMITS[email.kind])).allowed) {
          onFailure(email.kind, 'recipient limit reached');
          return;
        }
        // Second, so emails the recipient cap drops don't spend everyone's budget.
        const hour = Math.floor(Date.now() / (HOUR_SECONDS * 1000));
        const site = `email:${email.kind}:hour:${hour}`;
        if (!(await limits.consume(site, SITE_LIMITS[email.kind])).allowed) {
          onFailure(email.kind, 'site limit reached');
          return;
        }
        await transport.send(renderAuthEmail(email));
      } catch (error) {
        onFailure(email.kind, error instanceof Error ? error.message : 'unknown error');
      }
    });
  };
}
