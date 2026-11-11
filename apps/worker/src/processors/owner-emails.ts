import {
  claimDueEmails,
  type ClaimedEmail,
  countOverdueEmails,
  enqueueListingStatusEmails,
  enqueueOnboardingReminders,
  markEmailFailed,
  markEmailSent,
  purgeSentEmails,
  releaseEmails,
} from '@parkfairy/database';
import {
  BOOKING_EMAIL_KINDS,
  OWNER_EMAIL_KINDS,
  renderBookingEmail,
  renderOwnerEmail,
  type BookingEmailKind,
  type OutgoingEmail,
  type OwnerEmailKind,
  type OwnerEmailLocale,
} from '@parkfairy/email';
import { QUEUES, type QueueProcessor } from '../queues.js';

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
 * them) would otherwise stretch a claim of 20 over minutes, so a send still going then is stopped,
 * and it and the claim's unsent rest go back to the outbox, due at once and with their try
 * returned. A shutdown stops the run the same way.
 */
export const SEND_RUN_MS = 25_000;

const OWNER_KINDS = new Set<string>(OWNER_EMAIL_KINDS);
const BOOKING_KINDS = new Set<string>(BOOKING_EMAIL_KINDS);

/** The message for an outbox row. A kind nobody knows, or a booking email without its booking, throws. */
function render(row: ClaimedEmail, webUrl: string): OutgoingEmail {
  const locale = row.locale as OwnerEmailLocale;
  const { listingName, booking } = row.payload;
  if (OWNER_KINDS.has(row.kind)) {
    return renderOwnerEmail({
      kind: row.kind as OwnerEmailKind,
      to: row.to,
      locale,
      webUrl,
      listingName,
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
  throw new Error(`Unknown email kind "${row.kind}"`);
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
                await email.transport.send(
                  { ...render(row, email.webUrl), idempotencyKey: row.id },
                  { signal: stop },
                );
                await markEmailSent(db, row.id);
                sentNow++;
              } catch (error) {
                // Stopped half way, not failed: back with the rest.
                if (stop.aborted) {
                  await handBack(due.slice(index));
                  break;
                }
                failed++;
                const reason = error instanceof Error ? error.message : 'unknown error';
                const gaveUp = await markEmailFailed(db, row, reason);
                // The id and kind only: the address must stay out of the logs.
                const details = { emailId: row.id, kind: row.kind, reason };
                if (gaveUp) logger.error(details, 'owner email given up on');
                else logger.warn(details, 'owner email not sent');
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
