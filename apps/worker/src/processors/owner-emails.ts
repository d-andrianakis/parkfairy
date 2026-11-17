import {
  claimDueEmails,
  type ClaimedEmail,
  countOverdueEmails,
  type Database,
  enqueueListingStatusEmails,
  enqueueOnboardingReminders,
  hashInviteToken,
  markEmailFailed,
  markEmailSent,
  mintInviteToken,
  purgeSentEmails,
  releaseEmails,
} from '@parkfairy/database';
import {
  ACCOUNT_EMAIL_KINDS,
  type AccountEmailKind,
  BOOKING_EMAIL_KINDS,
  type BookingEmailKind,
  HANDOVER_EMAIL_KINDS,
  type HandoverEmailKind,
  type OutgoingEmail,
  OWNER_EMAIL_KINDS,
  type OwnerEmailKind,
  type OwnerEmailLocale,
  renderAccountEmail,
  renderBookingEmail,
  renderHandoverEmail,
  renderInviteEmail,
  renderOwnerEmail,
  SendStopped,
} from '@parkfairy/email';

import { type QueueProcessor, QUEUES } from '../queues.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Quiet this long after their last change, and an owner gets the one reminder. */
export const REMINDER_AFTER_DAYS = 3;
/** Long enough to look into a complaint. */
export const SENT_EMAIL_DAYS = 90;
/** The most one claim takes; Resend's limit paces the sends inside the transport. */
export const SEND_BATCH = 20;
/**
 * How long one run goes on claiming while claims come back full (a rush), so the outbox drains at
 * the transport's pace rather than a batch per run. Under the 30 s between runs, since the queue's
 * other jobs wait behind it: each claim is only as big as the pace sends in the time left.
 *
 * It is a deadline as well. A slow Resend (5 s a try, three tries, waits of up to 30 s between
 * them) would otherwise stretch a claim of 20 over minutes, so a send still going then is stopped.
 * The claim's untried rest goes back to the outbox, due at once and with its try returned, and so
 * does the send stopped before Resend answered. One stopped after a refusal (a quota's long
 * `Retry-After`) failed, and counts so: given back, a quota that never lifts would be tried every
 * run for ever, and its reason never logged. A shutdown stops the run the same way.
 */
export const SEND_RUN_MS = 25_000;

const OWNER_KINDS = new Set<string>(OWNER_EMAIL_KINDS);
const BOOKING_KINDS = new Set<string>(BOOKING_EMAIL_KINDS);
const HANDOVER_KINDS = new Set<string>(HANDOVER_EMAIL_KINDS);
const ACCOUNT_KINDS = new Set<string>(ACCOUNT_EMAIL_KINDS);

/** The message for an outbox row. A kind nobody knows, or a booking email without its booking, throws. */
function render(row: ClaimedEmail, webUrl: string): OutgoingEmail {
  const locale = row.locale as OwnerEmailLocale;
  const { listingName, contentLocale, booking, listingId } = row.payload;
  if (OWNER_KINDS.has(row.kind)) {
    return renderOwnerEmail({
      kind: row.kind as OwnerEmailKind,
      to: row.to,
      locale,
      webUrl,
      listingName,
      contentLocale,
    });
  }
  if (BOOKING_KINDS.has(row.kind)) {
    if (!booking) throw new Error(`Email "${row.kind}" has no booking`);
    return renderBookingEmail({
      kind: row.kind as BookingEmailKind,
      to: row.to,
      locale,
      webUrl,
      listingName,
      booking,
    });
  }
  if (HANDOVER_KINDS.has(row.kind)) {
    if (!listingId) throw new Error(`Email "${row.kind}" has no listing`);
    return renderHandoverEmail({
      kind: row.kind as HandoverEmailKind,
      to: row.to,
      locale,
      webUrl,
      listingId,
    });
  }
  if (ACCOUNT_KINDS.has(row.kind)) {
    return renderAccountEmail({ kind: row.kind as AccountEmailKind, to: row.to, locale, webUrl });
  }
  throw new Error(`Unknown email kind "${row.kind}"`);
}

/**
 * An outbox row's message and its idempotency key, or none when there is nothing to send. An
 * invite's link is made now (#56), so no live link waits in the outbox; each try makes a new one
 * and is a new email to Resend, never one it refuses for its key with a changed body. A try whose
 * answer was lost costs a second email, the last one's link the one that works. An invite
 * accepted or withdrawn since has nothing to send.
 */
async function message(
  db: Database,
  row: ClaimedEmail,
  webUrl: string,
): Promise<{ email: OutgoingEmail; key: string } | null> {
  if (row.kind !== 'listing-invite') return { email: render(row, webUrl), key: row.id };
  if (!row.inviteId) throw new Error('An invite email without its invite');
  const minted = await mintInviteToken(db, row.inviteId);
  if (!minted) return null;
  return {
    email: renderInviteEmail({
      to: row.to,
      locale: row.locale as OwnerEmailLocale,
      webUrl,
      token: minted.token,
      role: row.inviteRole ?? 'co_owner',
    }),
    key: `${row.id}:${hashInviteToken(minted.token).slice(0, 16)}`,
  };
}

/**
 * Emails owed to people: owners' about their listings, and both sides' about bookings (written to
 * the outbox by the API in the booking's own transaction). The sweeps turn what happened to
 * listings into outbox rows, and the sender drains them all.
 * Every job is safe to repeat: rows carry a dedupe key, and the outbox id is the idempotency key.
 */
export const ownerEmailsProcessor: QueueProcessor = {
  queue: QUEUES.email,
  concurrency: 1,
  // One job at a time over every worker process: two senders would each go at the pace and
  // together pass Resend's limit, which is the account's.
  globalConcurrency: 1,
  schedules: [
    { id: 'enqueue-listing-status-emails', everyMs: MINUTE_MS },
    { id: 'enqueue-onboarding-reminders', everyMs: 60 * MINUTE_MS },
    { id: 'send-owner-emails', everyMs: 30_000 },
    { id: 'purge-sent-emails', everyMs: DAY_MS },
  ],
  async process(job, { db, logger, email, signal }) {
    switch (job.name) {
      case 'enqueue-listing-status-emails': {
        const queued = await enqueueListingStatusEmails(db);
        if (queued > 0) logger.info({ queued }, 'listing status emails queued');
        return { queued };
      }
      case 'enqueue-onboarding-reminders': {
        const before = new Date(Date.now() - REMINDER_AFTER_DAYS * DAY_MS);
        const queued = await enqueueOnboardingReminders(db, before);
        if (queued > 0) logger.info({ queued }, 'onboarding reminders queued');
        return { queued };
      }
      case 'send-owner-emails': {
        const started = Date.now();
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(new Error('Send run over')), SEND_RUN_MS);
        const stop = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
        // Checked by the clock as well, which a send that took long has moved on.
        const over = () => stop.aborted || Date.now() - started >= SEND_RUN_MS;
        let [sent, failed, handedBack] = [0, 0, 0];
        const handBack = async (rows: ClaimedEmail[]) => {
          await releaseEmails(db, rows);
          handedBack += rows.length;
        };
        const fail = async (row: ClaimedEmail, reason: string) => {
          failed++;
          const gaveUp = await markEmailFailed(db, row, reason);
          // The id and kind only: the address must stay out of the logs.
          const details = { emailId: row.id, kind: row.kind, reason };
          if (gaveUp) logger.error(details, 'owner email given up on');
          else logger.warn(details, 'owner email not sent');
        };
        try {
          for (;;) {
            const left = SEND_RUN_MS - (Date.now() - started);
            const size = Math.min(SEND_BATCH, Math.floor((left / 1000) * email.sendsPerSecond));
            if (size < 1 || over()) break;
            const due = await claimDueEmails(db, size);
            let sentNow = 0;
            for (const [index, row] of due.entries()) {
              // Out of time or shutting down: this one and the rest go back untried.
              if (over()) {
                await handBack(due.slice(index));
                break;
              }
              try {
                const out = await message(db, row, email.webUrl);
                if (out) {
                  await email.transport.send(
                    { ...out.email, idempotencyKey: out.key },
                    { signal: stop },
                  );
                }
                await markEmailSent(db, row.id);
                sentNow++;
              } catch (error) {
                if (error instanceof SendStopped) {
                  // Stopped before Resend answered: not tried, back with the rest. Stopped after
                  // a refusal: failed, and the rest go back.
                  if (error.failure) await fail(row, error.failure);
                  await handBack(due.slice(error.failure ? index + 1 : index));
                  break;
                }
                await fail(row, error instanceof Error ? error.message : 'unknown error');
              }
            }
            sent += sentNow;
            // A short claim: the outbox is empty for now, and the next run is 30 s away. Nothing
            // sent: Resend is failing, and the rest wait for their next run rather than each spend
            // a try now.
            if (due.length < size || sentNow === 0 || handedBack > 0) break;
          }
        } finally {
          clearTimeout(timer);
        }
        if (handedBack > 0) {
          const shuttingDown = signal?.aborted ?? false;
          logger.warn({ handedBack, shuttingDown }, 'unsent emails handed back for the next run');
        }
        const overdue = await countOverdueEmails(db, new Date(Date.now() - DAY_MS));
        if (overdue > 0) logger.error({ overdue }, 'owner emails waiting for over a day');
        return { sent, failed, handedBack };
      }
      case 'purge-sent-emails': {
        const purged = await purgeSentEmails(db, new Date(Date.now() - SENT_EMAIL_DAYS * DAY_MS));
        logger.info({ purged }, 'old sent emails purged');
        return { purged };
      }
      default:
        throw new Error(`Unknown email job "${job.name}"`);
    }
  },
};
